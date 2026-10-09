import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './store.js';
import { AppError } from './store.js';
import { capabilityConfig } from './model-capabilities.js';
import { modelSettingKeys, readModelSettings, saveModelSetting } from './model-settings.js';
import { modelCompatibility } from './model-registry.js';
import { copyProfile } from './copy-provider.js';
import { imageProfile } from './image-provider.js';
import { recordedStructuredRun } from './ai-inference-runs.js';
import { keywordIntelligence } from './keyword-intelligence.js';
import { briefAiSchema, briefContentSchema, briefJsonSchema, listingCandidateSchema, listingContentSchema, listingJsonSchema, type BriefContent } from '../../packages/contracts/product-intelligence.js';
import { listingQualityIssues, listingFactReferences } from '../../packages/contracts/listing-quality.js';
import { productFacts } from '../../packages/contracts/content-template.js';
import { spuFacts } from './content-service.js';

const uuid = z.string().uuid();
const now = () => new Date().toISOString();
const parse = <T>(value: unknown) => JSON.parse(String(value)) as T;
const runChoice = z.object({ model: z.string().trim().min(1).max(120).optional() }).strict();
type Row = Record<string,unknown>;

function briefRow(row: Row) {
  return { id:String(row.id),projectId:String(row.project_id),version:Number(row.version),status:String(row.status),sourceRunId:row.source_inference_run_id ? String(row.source_inference_run_id) : null,content:parse<BriefContent>(row.content_data),citations:parse<unknown>(row.citations_data),createdAt:String(row.created_at),confirmedAt:row.confirmed_at ? String(row.confirmed_at) : null };
}
function listingRow(row: Row) {
  return { id:String(row.id),skuId:String(row.sku_id),channel:String(row.channel),version:Number(row.version),status:String(row.status),sourceRunId:row.source_inference_run_id ? String(row.source_inference_run_id) : null,title:String(row.title),keywords:parse<string[]>(row.keywords_data),suggestions:parse<unknown>(row.suggestions_data),factRefs:parse<string[]>(row.fact_refs_data),createdAt:String(row.created_at),confirmedAt:row.confirmed_at ? String(row.confirmed_at) : null };
}
function projectOpportunity(store: Store, projectId: string) {
  const project = store.db.prepare('SELECT id,name,project_type,category_id,brief_data FROM product_projects WHERE id=?').get(projectId);
  if (!project) throw new AppError('NOT_FOUND','产品项目不存在',404);
  if (project.project_type !== 'NEW_PRODUCT') throw new AppError('PROJECT_TYPE_MISMATCH','正式产品企划仅用于新品/机会型项目',409);
  const opportunity = store.db.prepare(`SELECT o.* FROM product_opportunities o JOIN project_evidence pe ON pe.evidence_id=o.evidence_id
    WHERE pe.project_id=? AND o.status='READY' ORDER BY o.updated_at DESC LIMIT 1`).get(projectId);
  if (!opportunity) throw new AppError('OPPORTUNITY_REQUIRED','请先关联已审核市场机会',409);
  const evidence = store.db.prepare(`SELECT me.id,me.normalized_data FROM opportunity_entries oe JOIN market_entries me ON me.id=oe.entry_id
    WHERE oe.opportunity_id=? AND oe.role='SUPPORTING' ORDER BY me.row_number LIMIT 8`).all(String(opportunity.id));
  if (!evidence.length) throw new AppError('EVIDENCE_REQUIRED','该机会缺少可追溯的支撑商品',409);
  const analysis = parse<{ batch?: {id:string;name:string;platform:string};stats?:{includedCount:number;price?:{minimum:number;median:number;maximum:number}|null;sellingPoints?:Array<{term:string;count:number}>};risks?:string[];missingEvidence?:string[] }>(opportunity.analysis_data);
  if (!analysis.batch?.id) throw new AppError('BATCH_REFERENCE_MISSING','市场机会缺少来源批次',409);
  const ids = evidence.map(row=>String(row.id));
  const marketFacts: BriefContent['marketFacts'] = [{text:`来源批次纳入 ${analysis.stats?.includedCount ?? ids.length} 条有效样本。`,batchId:analysis.batch.id,evidenceEntryIds:ids}];
  if (analysis.stats?.price) marketFacts.push({text:`来源批次有价格记录的样本价格区间为 ${analysis.stats.price.minimum}–${analysis.stats.price.maximum} 元，中位数 ${analysis.stats.price.median} 元。`,batchId:analysis.batch.id,evidenceEntryIds:ids});
  if (analysis.stats?.sellingPoints?.[0]) marketFacts.push({text:`来源批次程序归类的卖点“${analysis.stats.sellingPoints[0].term}”覆盖 ${analysis.stats.sellingPoints[0].count} 条样本。`,batchId:analysis.batch.id,evidenceEntryIds:ids});
  return { project,opportunity,analysis,evidence:evidence.map(row=>({id:String(row.id),data:parse<{title:string;price:number|null;specification:string;sellingPoints:string;packaging:string}>(row.normalized_data)})),marketFacts };
}
function verifyBriefCitations(content: BriefContent, allowed: Set<string>) {
  const suggestions = content.suggestions;
  const cited = [suggestions.marketOpportunity,suggestions.targetUserAndScene,suggestions.priceBand,suggestions.specification,...suggestions.coreSellingPoints,suggestions.differentiation,suggestions.productDesign,...suggestions.risks];
  if (cited.some(item=>item.evidenceIds.some(id=>!allowed.has(id)))) throw new AppError('INVALID_AI_EVIDENCE','企划引用了未纳入该机会的商品证据',409);
}
function confirmedProductFacts(store: Store, skuId: string) {
  const sku = store.product(skuId);
  const facts = productFacts(sku,undefined,spuFacts(store,sku)).filter(fact=>fact.confirmed && fact.type !== 'asset').map(fact=>({id:fact.id,type:fact.type,value:fact.value}));
  if (!facts.some(fact=>fact.type==='product_name') || !facts.some(fact=>fact.type==='spec')) throw new AppError('FACTS_REQUIRED','商品名称或规格尚未确认',409);
  return { sku,facts };
}
function ensureComparableBatch(store: Store, skuId: string, batchId: string) {
  const source=store.db.prepare('SELECT collection_profile FROM market_research_jobs WHERE market_batch_id=?').get(batchId);
  if (!source) return;
  const product=store.db.prepare('SELECT c.code category_code FROM products p JOIN spus s ON s.id=p.spu_id JOIN categories c ON c.id=s.category_id WHERE p.id=?').get(skuId);
  const expected=source.collection_profile==='facial_cleanser'?'facial-cleanser':'shampoo';
  if (product && product.category_code!==expected) throw new AppError('CATEGORY_MISMATCH','市场样本品类与商品品类不一致，请选择同品类批次',409);
}
function listingQuality(store: Store, row: Row) {
  const listing = listingRow(row), sku=store.product(listing.skuId);
  const facts=productFacts(sku,undefined,spuFacts(store,sku)).filter(fact=>fact.confirmed&&fact.type!=='asset');
  const parsed = listingContentSchema.safeParse(listing.suggestions);
  const qualityIssues=parsed.success ? listingQualityIssues({candidate:parsed.data,facts,product:sku,title:listing.title,titleFactIds:parsed.data.confirmedTitleFactIds??parsed.data.titles[0]!.sourceFactIds,keywords:listing.keywords}) : [{path:'content',code:'CITED_CONTENT_REQUIRED',message:'该历史版本缺少逐项事实引用；保留查看，重新生成后才能确认'}];
  if(parsed.success) {
    const entries=new Set(parsed.data.sourceBatchId?store.db.prepare('SELECT id FROM market_entries WHERE batch_id=?').all(parsed.data.sourceBatchId).map(row=>String(row.id)):[]);
    if(parsed.data.suggestedKeywords.some(item=>!item.sourceFactIds.length&&!item.marketEntryIds.length || item.marketEntryIds.some(id=>!entries.has(id)))) qualityIssues.push({path:'suggestedKeywords',code:'INVALID_MARKET_REFERENCE',message:'关键词需引用来源批次商品或已确认商品事实'});
  }
  return {...listing,qualityIssues};
}

export function registerProductIntelligence(app: FastifyInstance, store: Store) {
  app.get('/api/model-settings',async()=>{
    const overrides=readModelSettings(store.directory),capabilities=['TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION','SYSTEM_REASONING'].map(value=>capabilityConfig(value as Parameters<typeof capabilityConfig>[0]));
    const currentModels=Object.fromEntries(capabilities.map(item=>[item.capability,overrides[item.capability]??item.model]));
    currentModels.TEXT_EMBEDDING=overrides.TEXT_EMBEDDING??'text-embedding-v4';
    currentModels.PRODUCT_BRIEF=overrides.PRODUCT_BRIEF??currentModels.TEXT_REASONING!;
    currentModels.SEO_REASONING=overrides.SEO_REASONING??currentModels.TEXT_REASONING!;
    currentModels.COPY_GENERATION=overrides.COPY_GENERATION??copyProfile()?.model??'';
    currentModels.IMAGE_GENERATION=overrides.IMAGE_GENERATION??imageProfile('quality')?.model??currentModels.IMAGE_GENERATION!;
    return {overrides,capabilities,currentModels};
  });
  app.put('/api/model-settings/:capability',async request=>{
    const {capability}=z.object({capability:z.enum(modelSettingKeys)}).parse(request.params);
    const {model}=z.object({model:z.string().trim().regex(/^[a-zA-Z0-9._-]{1,120}$/).nullable()}).strict().parse(request.body);
    if(capability==='COPY_GENERATION'||capability==='IMAGE_GENERATION'){
      const operation=capability==='COPY_GENERATION'?'copy':'image';
      const active=store.db.prepare("SELECT t.id FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.operation=? AND t.state IN ('queued','running','waiting_external','saving_result') LIMIT 1").get(operation);
      if(active)throw new AppError('MODEL_TASK_ACTIVE','此功能仍有任务正在执行；完成后再更换模型，避免影响已提交任务',409);
    }
    return {overrides:saveModelSetting(capability,model,store.directory),compatibility:model?modelCompatibility(model):null};
  });
  const idOf = (params: unknown) => z.object({id:uuid}).parse(params).id;
  app.get('/api/model-capabilities',async()=>['TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION','SYSTEM_REASONING'].map(value=>capabilityConfig(value as Parameters<typeof capabilityConfig>[0])));
  app.get('/api/ai-inference-runs',async request=>{
    const query=z.object({subjectType:z.enum(['project','sku','batch']),subjectId:uuid,taskType:z.enum(['keyword_normalization','product_brief','seo_listing']).optional()}).parse(request.query);
    return store.db.prepare('SELECT id,task_type,capability,provider,model,model_version,input_fingerprint,output_data,status,latency_ms,error_code,human_evaluation,adopted_at,created_at FROM ai_inference_runs WHERE subject_type=? AND subject_id=? AND (? IS NULL OR task_type=?) ORDER BY created_at DESC LIMIT 30').all(query.subjectType,query.subjectId,query.taskType??null,query.taskType??null).map(row=>({id:String(row.id),taskType:String(row.task_type),capability:String(row.capability),provider:String(row.provider),model:String(row.model),modelVersion:row.model_version?String(row.model_version):null,inputFingerprint:String(row.input_fingerprint),output:row.output_data?parse<unknown>(row.output_data):null,status:String(row.status),latencyMs:Number(row.latency_ms),errorCode:row.error_code?String(row.error_code):null,humanEvaluation:row.human_evaluation?parse<unknown>(row.human_evaluation):null,adoptedAt:row.adopted_at?String(row.adopted_at):null,createdAt:String(row.created_at)}));
  });
  app.post('/api/ai-inference-runs/:id/evaluation',async request=>{
    const id=idOf(request.params),input=z.object({schemaValid:z.boolean(),evidenceValid:z.boolean(),unsupportedClaims:z.boolean(),humanDecision:z.enum(['PREFER','DO_NOT_USE','NEEDS_REVIEW']),note:z.string().trim().max(500)}).strict().parse(request.body);
    const run=store.db.prepare('SELECT id,status FROM ai_inference_runs WHERE id=?').get(id);
    if(!run)throw new AppError('NOT_FOUND','模型运行记录不存在',404);
    store.db.prepare('UPDATE ai_inference_runs SET human_evaluation=? WHERE id=?').run(JSON.stringify(input),id);
    return {id,evaluation:input};
  });
  app.get('/api/market/batches/:id/keyword-intelligence',async request=>keywordIntelligence(store,idOf(request.params)));
  app.post('/api/market/batches/:id/keyword-normalization',async (request,reply)=>{
    const batchId=idOf(request.params),choice=runChoice.parse(request.body),intelligence=keywordIntelligence(store,batchId);
    const sourceTerms=intelligence.rawTerms.slice(0,30).map(item=>item.term);
    const validator=z.object({groups:z.array(z.object({canonical:z.string().trim().min(1).max(40),sourceTerms:z.array(z.string().trim().min(1).max(40)).min(1).max(10),explanation:z.string().trim().min(1).max(200)}).strict()).max(20)}).strict();
    const jsonSchema={type:'object',additionalProperties:false,required:['groups'],properties:{groups:{type:'array',items:{type:'object',additionalProperties:false,required:['canonical','sourceTerms','explanation'],properties:{canonical:{type:'string'},sourceTerms:{type:'array',items:{type:'string'}},explanation:{type:'string'}}}}}};
    const run=await recordedStructuredRun(store,{task:'keyword_normalization',subjectType:'batch',subjectId:batchId,input:{batch:intelligence.batch,sourceTerms},requestedModel:choice.model,outputName:'keyword_normalization',jsonSchema,validator,systemPrompt:'仅将输入的 sourceTerms 归并为语义相近的表达，不新增关键词，不输出频次或趋势。sourceTerms 只能原样引用输入词；归并是 AI 候选，不会改写程序统计。严格 JSON。'});
    const allowed=new Set(sourceTerms);
    if(run.output.groups.some(group=>group.sourceTerms.some(term=>!allowed.has(term))))throw new AppError('INVALID_AI_EVIDENCE','归并结果包含来源批次以外的词',409);
    return reply.code(201).send({runId:run.id,model:run.model,groups:run.output.groups,scopeNote:intelligence.scopeNote});
  });
  app.get('/api/product-projects/:id/product-briefs',async request=>store.db.prepare('SELECT * FROM product_briefs WHERE project_id=? ORDER BY version DESC').all(idOf(request.params)).map(briefRow));
  app.post('/api/product-projects/:id/product-briefs/generate',async (request,reply)=>{
    const projectId=idOf(request.params),choice=runChoice.parse(request.body),source=projectOpportunity(store,projectId);
    const allowed=new Set(source.evidence.map(item=>item.id));
    const input={project:{id:projectId,name:String(source.project.name),confirmedInput:parse<unknown>(source.project.brief_data)},opportunity:{id:String(source.opportunity.id),title:String(source.opportunity.title),summary:String(source.opportunity.summary),risks:source.analysis.risks??[],missingData:source.analysis.missingEvidence??[]},batch:source.analysis.batch,marketFacts:source.marketFacts,supportingProducts:source.evidence};
    const run=await recordedStructuredRun(store,{task:'product_brief',subjectType:'project',subjectId:projectId,input,requestedModel:choice.model,outputName:'product_brief',jsonSchema:briefJsonSchema,validator:briefAiSchema,systemPrompt:'为新品项目输出产品企划建议。marketFacts 是当前有限样本的程序事实，不得重算、扩展为全市场判断，不能把竞品成分或功效当作本产品事实。能由 supportingProducts 直接支持的判断引用真实 id；目标用户和产品设计等纯建议若无直接证据，evidenceIds 留空，并在 pendingValidation 列出待验证事项。不得给无证据建议伪造引用。只输出严格 JSON。'});
    const content=briefContentSchema.parse({marketFacts:source.marketFacts,suggestions:run.output,scopeNote:`仅代表来源批次 ${source.analysis.batch!.name} 的有限样本；产品设计方向均为待人工确认建议。`});
    verifyBriefCitations(content,allowed);
    const time=now(),id=randomUUID();
    store.transaction(()=>{
      const version=Number(store.db.prepare('SELECT coalesce(max(version),0)+1 value FROM product_briefs WHERE project_id=?').get(projectId)!.value);
      store.db.prepare('INSERT INTO product_briefs VALUES (?,?,?,?,?,?,?,?,?)').run(id,projectId,version,'DRAFT',run.id,JSON.stringify(content),JSON.stringify({opportunityId:String(source.opportunity.id),batchId:source.analysis.batch!.id,evidenceId:String(source.opportunity.evidence_id),entryIds:[...allowed]}),time,null);
    });
    return reply.code(201).send(briefRow(store.db.prepare('SELECT * FROM product_briefs WHERE id=?').get(id)!));
  });
  app.post('/api/product-briefs/:id/confirm',async request=>{
    const id=idOf(request.params),input=z.object({content:briefContentSchema}).strict().parse(request.body);
    const row=store.db.prepare('SELECT * FROM product_briefs WHERE id=?').get(id);
    if (!row || row.status!=='DRAFT') throw new AppError('BRIEF_NOT_DRAFT','只能确认待审核的企划版本',409);
    const original=briefRow(row),source=projectOpportunity(store,original.projectId);
    if (JSON.stringify(input.content.marketFacts)!==JSON.stringify(original.content.marketFacts)) throw new AppError('MARKET_FACTS_IMMUTABLE','程序统计事实不能由编辑器改写',409);
    verifyBriefCitations(input.content,new Set(source.evidence.map(item=>item.id)));
    const time=now();
    store.transaction(()=>{
      store.db.prepare("UPDATE product_briefs SET status='SUPERSEDED' WHERE project_id=? AND status='CONFIRMED'").run(original.projectId);
      store.db.prepare("UPDATE product_briefs SET status='CONFIRMED',content_data=?,confirmed_at=? WHERE id=?").run(JSON.stringify(input.content),time,id);
      store.db.prepare('UPDATE ai_inference_runs SET adopted_at=?,human_evaluation=? WHERE id=?').run(time,JSON.stringify({decision:'ADOPTED',businessObject:'product_brief',businessObjectId:id}),original.sourceRunId);
      store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(),original.projectId,null,null,'PRODUCT_BRIEF_CONFIRMED',`确认产品企划 v${original.version}`,time);
    });
    return briefRow(store.db.prepare('SELECT * FROM product_briefs WHERE id=?').get(id)!);
  });
  app.get('/api/products/:id/listing-contents',async request=>{
    const skuId=idOf(request.params),query=z.object({channel:z.string().trim().min(1).max(40).default('taobao')}).parse(request.query);
    store.product(skuId);
    return store.db.prepare('SELECT * FROM listing_contents WHERE sku_id=? AND channel=? ORDER BY version DESC').all(skuId,query.channel).map(row=>listingQuality(store,row));
  });
  app.get('/api/products/:id/comparable-market-batches',async request=>{
    const skuId=idOf(request.params);
    store.product(skuId);
    const product=store.db.prepare('SELECT c.code category_code FROM products p JOIN spus s ON s.id=p.spu_id JOIN categories c ON c.id=s.category_id WHERE p.id=?').get(skuId);
    const profile=product?.category_code==='facial-cleanser'?'facial_cleanser':product?.category_code==='shampoo'?'shampoo':null;
    const rows=store.db.prepare(`SELECT b.id,b.name,b.platform FROM market_batches b LEFT JOIN market_research_jobs j ON j.market_batch_id=b.id WHERE ($profile IS NULL OR j.collection_profile=$profile OR (j.id IS NULL AND $profile='shampoo')) ORDER BY b.imported_at DESC`).all({profile});
    return rows.map(row=>({id:String(row.id),name:String(row.name),platform:String(row.platform)}));
  });
  app.get('/api/products/:id/seo-context',async request=>{
    const skuId=idOf(request.params),query=z.object({batchId:uuid}).parse(request.query);
    ensureComparableBatch(store,skuId,query.batchId);
    const {sku,facts}=confirmedProductFacts(store,skuId),intelligence=keywordIntelligence(store,query.batchId);
    const currentTitle=`${sku.name} ${sku.specification}`;
    const comparison=intelligence.keywords.slice(0,12).map(item=>({term:item.term,productCount:item.productCount,sampleSize:intelligence.sampleSize,sourceEntryIds:item.sourceEntryIds,representativeEntries:item.representativeEntries,confirmedFactIds:facts.filter(fact=>fact.value.includes(item.term)).map(fact=>fact.id)}));
    return {sku:{id:sku.id,name:sku.name,brand:sku.brand,specification:sku.specification},facts,keywordIntelligence:intelligence,comparison,
      objectiveChecks:{productNamePresent:currentTitle.includes(sku.name),brandPresent:!sku.brand || currentTitle.toLowerCase().includes(sku.brand.toLowerCase()),specificationPresent:currentTitle.toLowerCase().includes(sku.specification.toLowerCase()),duplicateTerms:[],unsupportedClaimRisk:/(防脱|生发|治疗|根治)/u.test(currentTitle)},
      scopeNote:'仅按已确认商品事实和当前样本检查；没有可靠搜索量、趋势或平台标题长度数据。'};
  });
  app.post('/api/products/:id/listing-contents/generate',async (request,reply)=>{
    const skuId=idOf(request.params),input=z.object({batchId:uuid,channel:z.literal('taobao'),model:z.string().trim().min(1).max(120).optional()}).strict().parse(request.body);
    ensureComparableBatch(store,skuId,input.batchId);
    const {sku,facts}=confirmedProductFacts(store,skuId),intelligence=keywordIntelligence(store,input.batchId);
    const run=await recordedStructuredRun(store,{task:'seo_listing',subjectType:'sku',subjectId:skuId,requestedModel:input.model,outputName:'seo_listing',jsonSchema:listingJsonSchema,validator:listingCandidateSchema,
      input:{channel:input.channel,currentTitle:`${sku.name} ${sku.specification}`,confirmedFacts:facts,marketSample:{batch:intelligence.batch,sampleSize:intelligence.sampleSize,keywords:intelligence.keywords.slice(0,12).map(item=>({term:item.term,count:item.productCount,titleCount:item.titleCount,representativeEntryIds:item.representativeEntries.map(entry=>entry.id)})),scopeNote:intelligence.scopeNote}},
      systemPrompt:'只基于 confirmedFacts 改写淘宝商品标题和 Listing 建议。市场关键词仅说明有限样本的用词，不证明本 SKU 有相应功效。标题必须完整包含已确认商品名、品牌与规格。sellingPoints 按优先顺序输出 1–5 条各最多80字的卖点，事实不足不得凑满五条；detailSuggestions 输出1–8条各最多600字的详情文案。标题、每条卖点和详情都必须引用真正支持该表达的 sourceFactIds。每项关键词引用事实 ID 或样本商品 ID；不得新增防脱、生发、治疗、认证、效果时长等未确认主张。风险和待核实内容放在 risks，不混入广告文案。只输出 JSON，不要虚构平台标题长度规则或搜索量。'});
    const first=run.output.titles[0]!;
    const id=randomUUID(),time=now();
    store.transaction(()=>{
      const version=Number(store.db.prepare('SELECT coalesce(max(version),0)+1 value FROM listing_contents WHERE sku_id=? AND channel=?').get(skuId,input.channel)!.value);
      store.db.prepare('INSERT INTO listing_contents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,skuId,input.channel,version,'DRAFT',run.id,first.text,JSON.stringify(run.output.suggestedKeywords.filter(item=>item.sourceFactIds.length).map(item=>item.term)),JSON.stringify({...run.output,sourceBatchId:input.batchId,scopeNote:intelligence.scopeNote}),JSON.stringify(listingFactReferences(run.output)),time,null);
    });
    return reply.code(201).send(listingQuality(store,store.db.prepare('SELECT * FROM listing_contents WHERE id=?').get(id)!));
  });
  app.post('/api/listing-contents/:id/confirm',async request=>{
    const id=idOf(request.params),input=z.object({title:z.string().trim().min(1).max(160),titleFactIds:z.array(z.string().min(1).max(120)).min(1).max(20),keywords:z.array(z.string().trim().min(1).max(40)).max(20),suggestions:listingContentSchema}).strict().parse(request.body);
    const row=store.db.prepare('SELECT * FROM listing_contents WHERE id=?').get(id);
    if (!row || row.status!=='DRAFT') throw new AppError('LISTING_NOT_DRAFT','只能确认待审核的 Listing 版本',409);
    const original=listingRow(row),{sku,facts}=confirmedProductFacts(store,original.skuId);
    const source=listingContentSchema.safeParse(original.suggestions);
    if (!source.success) throw new AppError('CITED_CONTENT_REQUIRED','旧草稿缺少逐项事实引用，请重新生成后再确认',409);
    const suggestions={...input.suggestions,sourceBatchId:source.data.sourceBatchId,scopeNote:source.data.scopeNote,confirmedTitleFactIds:input.titleFactIds};
    const issues=listingQualityIssues({candidate:suggestions,facts,product:sku,title:input.title,titleFactIds:input.titleFactIds,keywords:input.keywords});
    const batch=suggestions.sourceBatchId;
    const entries=new Set(batch ? store.db.prepare('SELECT id FROM market_entries WHERE batch_id=?').all(batch).map(row=>String(row.id)) : []);
    if(suggestions.suggestedKeywords.some(item=>!item.sourceFactIds.length&&!item.marketEntryIds.length || item.marketEntryIds.some(id=>!entries.has(id)))) issues.push({path:'suggestedKeywords',code:'INVALID_MARKET_REFERENCE',message:'关键词需引用当前来源批次商品或已确认商品事实'});
    if (issues.length) throw new AppError('LISTING_QUALITY_FAILED',issues.map(issue=>`${issue.path}：${issue.message}`).join('；'),409);
    const time=now();
    store.transaction(()=>{
      store.db.prepare("UPDATE listing_contents SET status='SUPERSEDED' WHERE sku_id=? AND channel=? AND status='CONFIRMED'").run(original.skuId,original.channel);
      store.db.prepare("UPDATE listing_contents SET status='CONFIRMED',title=?,keywords_data=?,suggestions_data=?,fact_refs_data=?,confirmed_at=? WHERE id=?").run(input.title,JSON.stringify(input.keywords),JSON.stringify(suggestions),JSON.stringify([...new Set([...input.titleFactIds,...listingFactReferences(suggestions)])]),time,id);
      store.db.prepare('UPDATE ai_inference_runs SET adopted_at=?,human_evaluation=? WHERE id=?').run(time,JSON.stringify({decision:'ADOPTED',businessObject:'listing_content',businessObjectId:id}),original.sourceRunId);
    });
    return listingQuality(store,store.db.prepare('SELECT * FROM listing_contents WHERE id=?').get(id)!);
  });
}
