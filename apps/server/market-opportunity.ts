import { opportunityReviewSchema } from "../../packages/contracts/market-learning.js";
import { retrieveMarketHistory } from "./market-learning.js";
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, type Store } from './store.js';
import { analyzeMarketEntry, candidateReason, hydrateMarketRow, sourceMetadataSchema, type Batch, type Entry, type MarketMatch, type Review } from '../../packages/contracts/market.js';
import { analyzeOpportunity, opportunityInputSchema, opportunityPreviewInputSchema, opportunityProjectInputSchema, type OpportunityPreview, type ProductOpportunity } from '../../packages/contracts/market-opportunity.js';
import { marketOpportunityPromptVersion, runMarketAiAnalysis, type MarketAiRunner } from './market-ai-service.js';
import { jdCollectionProfiles, type JdCollectionProfile } from '../../packages/contracts/jd-collection-profiles.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

const batchRow = (row: Row): Batch => ({ id: String(row.id), name: String(row.name), source: String(row.source), platform: String(row.platform), periodStart: String(row.period_start), periodEnd: String(row.period_end), metricName: String(row.metric_name), metricUnit: String(row.metric_unit), importedAt: String(row.imported_at), count: Number(row.count ?? 0) });
function marketEntry(store: Store, row: Row): Entry {
  const id = String(row.id);
  const reviews = store.db.prepare('SELECT * FROM market_reviews WHERE entry_id=? ORDER BY rowid DESC').all(id).map(review => ({ id: String(review.id), entryId: id, relatedEntryId: review.related_entry_id ? String(review.related_entry_id) : null, verdict: String(review.verdict) as Review['verdict'], reason: String(review.reason), evidence: String(review.evidence), reviewer: String(review.reviewer), createdAt: String(review.created_at) }));
  return { id, batchId: String(row.batch_id), rowNumber: Number(row.row_number), raw: parse<string[]>(row.raw_data), data: hydrateMarketRow(parse<Partial<Entry['data']>>(row.normalized_data)), sourceProductId: row.source_product_id === null ? null : String(row.source_product_id), sourceMetadata: sourceMetadataSchema.parse(parse(row.source_metadata)), reviews };
}
export function previewMarketOpportunity(store: Store, input: z.infer<typeof opportunityPreviewInputSchema>, currentPoolAnalysis=false): OpportunityPreview {
  const current = store.db.prepare('SELECT b.*,(SELECT count(*) FROM market_entries e WHERE e.batch_id=b.id) count FROM market_batches b WHERE b.id=?').get(input.batchId);
  if (!current) throw new AppError('NOT_FOUND', '导入批次不存在', 404);
  const currentBatch=batchRow(current), placeholders=input.entryIds.map(()=>'?').join(',');
  const selectedRows=store.db.prepare(`SELECT * FROM market_entries WHERE batch_id=? AND id IN (${placeholders}) ORDER BY row_number`).all(input.batchId,...input.entryIds);
  if(selectedRows.length!==input.entryIds.length) throw new AppError('ENTRY_OWNERSHIP','所选记录不属于当前榜单批次',409);
  const researchJob=store.db.prepare('SELECT source_platform,collection_profile FROM market_research_jobs WHERE market_batch_id=?').get(input.batchId) as Row|undefined;
  const priorRows=currentPoolAnalysis ? [] : researchJob
    ? store.db.prepare(`SELECT e.*,b.id previous_batch_id,b.name previous_batch_name,b.source previous_source,b.platform previous_platform,b.period_start previous_period_start,b.period_end previous_period_end,b.metric_name previous_metric_name,b.metric_unit previous_metric_unit,b.imported_at previous_imported_at FROM market_entries e JOIN market_batches b ON b.id=e.batch_id JOIN market_research_jobs j ON j.market_batch_id=b.id WHERE b.id<>$currentId AND b.period_end<=$periodEnd AND j.source_platform=$sourcePlatform AND j.collection_profile=$profile ORDER BY b.period_end,e.row_number`).all({currentId:input.batchId,periodEnd:currentBatch.periodEnd,sourcePlatform:String(researchJob.source_platform),profile:String(researchJob.collection_profile)})
    : store.db.prepare(`SELECT e.*,b.id previous_batch_id,b.name previous_batch_name,b.source previous_source,b.platform previous_platform,b.period_start previous_period_start,b.period_end previous_period_end,b.metric_name previous_metric_name,b.metric_unit previous_metric_unit,b.imported_at previous_imported_at FROM market_entries e JOIN market_batches b ON b.id=e.batch_id WHERE b.id<>? AND b.period_end<=? AND b.platform=? AND NOT EXISTS (SELECT 1 FROM market_research_jobs j WHERE j.market_batch_id=b.id) ORDER BY b.period_end,e.row_number`).all(input.batchId,currentBatch.periodEnd,currentBatch.platform);
  const previous=priorRows.map(row=>({batch:batchRow({...row,id:row.previous_batch_id,name:row.previous_batch_name,source:row.previous_source,platform:row.previous_platform,period_start:row.previous_period_start,period_end:row.previous_period_end,metric_name:row.previous_metric_name,metric_unit:row.previous_metric_unit,imported_at:row.previous_imported_at}),entry:marketEntry(store,row)}));
  const analyzed=selectedRows.map(row=>{const value=marketEntry(store,row);const matches:MarketMatch[]=previous.flatMap(item=>{const reason=candidateReason(value.data,item.entry.data);return reason?[{entryId:item.entry.id,batchId:item.batch.id,title:item.entry.data.title,shop:item.entry.data.shop,reason}]:[]});const analysis=analyzeMarketEntry(value,matches);return {...value,analysis:currentPoolAnalysis?{...analysis,signal:'confirmed' as const}:analysis};});
  return analyzeOpportunity(currentBatch,analyzed,researchJob?.source_platform==='jd'?'jd_union_jingfen':'other',researchJob?.collection_profile==='facial_cleanser'?'facial_cleanser':'shampoo');
}

export async function createMarketResearchOpportunities(store: Store, batchId: string, categoryId: string|null, jobId: string, analyzeWithAi: MarketAiRunner) {
  const existing=store.db.prepare("SELECT id FROM product_opportunities WHERE json_extract(analysis_data,'$.marketResearchJobId')=? ORDER BY created_at").all(jobId).map(row=>String(row.id));
  if(existing.length) return existing;
  const entryIds=store.db.prepare('SELECT id FROM market_entries WHERE batch_id=? ORDER BY row_number').all(batchId).map(row=>String(row.id));
  const analysis=previewMarketOpportunity(store,{batchId,entryIds},true);
  if(!analysis.included.length) throw new AppError('NO_SUPPORTING_EVIDENCE','当前批次没有可用于分析的有效商品证据',409);
  const historyRetrieval=await retrieveMarketHistory(store,analysis,categoryId);
  const ai=await analyzeWithAi(analysis,{historyRetrieval}), time=now(), createdIds:string[]=[];
  store.transaction(()=>{for(const candidate of ai.output.opportunities){const opportunityId=randomUUID(),evidenceId=randomUUID();createdIds.push(opportunityId);const keywords=candidate.selling_points.map(item=>({term:item.term,sourceEntryIds:item.evidence_record_ids}));const missingEvidence=[...new Set([...analysis.missingEvidence,...ai.output.missing_data,...candidate.missing_data])];const storedAnalysis={...analysis,replicability:candidate.replicability,replicabilityReason:candidate.replicability_reason,risks:candidate.risks.map(item=>item.text),missingEvidence,ai:ai.output,textSignals:ai.textSignals,modelMetadata:ai.metadata,marketResearchJobId:jobId,historyRetrieval};const sourceUrl=analysis.included.find(item=>candidate.evidence_record_ids.includes(item.id)&&item.data.url)?.data.url||null;const rawContent=JSON.stringify({type:'ai_product_opportunity_candidate',opportunityId,createdAt:time,analysis:storedAnalysis,selectedKeywords:keywords});store.db.prepare('INSERT INTO market_evidence VALUES (?,?,?,?,?,?,?)').run(evidenceId,candidate.name,'AI竞品机会候选',sourceUrl,candidate.summary,rawContent,time);store.db.prepare('INSERT INTO product_opportunities VALUES (?,?,?,?,?,?,?,?,?,?)').run(opportunityId,evidenceId,categoryId,candidate.name,'DRAFT',candidate.summary,JSON.stringify(keywords),JSON.stringify(storedAnalysis),time,time);const insert=store.db.prepare('INSERT INTO opportunity_entries VALUES (?,?,?,?,?)');analysis.included.forEach(item=>insert.run(opportunityId,item.id,candidate.evidence_record_ids.includes(item.id)?'SUPPORTING':'COMPARISON',candidate.evidence_record_ids.includes(item.id)?'AI候选引用证据':'参与分析但未作为核心依据',time));analysis.excluded.forEach(item=>insert.run(opportunityId,item.id,'EXCLUDED',item.exclusionReason,time));}});
  return createdIds;
}

export function registerMarketOpportunities(app: FastifyInstance, store: Store, analyzeWithAi: MarketAiRunner = runMarketAiAnalysis) {
  const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  const batch = (id: string): Batch => {
    const row = store.db.prepare('SELECT b.*,(SELECT count(*) FROM market_entries e WHERE e.batch_id=b.id) count FROM market_batches b WHERE b.id=?').get(id);
    if (!row) throw new AppError('NOT_FOUND', '导入批次不存在', 404);
    return batchRow(row);
  };
  const entry = (row: Row): Entry => {
    const id = String(row.id);
    const reviews = store.db.prepare('SELECT * FROM market_reviews WHERE entry_id=? ORDER BY rowid DESC').all(id).map(review => ({ id: String(review.id), entryId: id, relatedEntryId: review.related_entry_id ? String(review.related_entry_id) : null, verdict: String(review.verdict) as Review['verdict'], reason: String(review.reason), evidence: String(review.evidence), reviewer: String(review.reviewer), createdAt: String(review.created_at) }));
    return { id, batchId: String(row.batch_id), rowNumber: Number(row.row_number), raw: parse<string[]>(row.raw_data), data: hydrateMarketRow(parse<Partial<Entry['data']>>(row.normalized_data)), sourceProductId: row.source_product_id === null ? null : String(row.source_product_id), sourceMetadata: sourceMetadataSchema.parse(parse(row.source_metadata)), reviews };
  };
  function preview(input: z.infer<typeof opportunityPreviewInputSchema>): OpportunityPreview {
    return previewMarketOpportunity(store,input);
    /* legacy body retained unreachable during this refactor */
    const currentBatch = batch(input.batchId);
    const placeholders = input.entryIds.map(() => '?').join(',');
    const selectedRows = store.db.prepare(`SELECT * FROM market_entries WHERE batch_id=? AND id IN (${placeholders}) ORDER BY row_number`).all(input.batchId, ...input.entryIds);
    if (selectedRows.length !== input.entryIds.length) throw new AppError('ENTRY_OWNERSHIP', '所选记录不属于当前榜单批次', 409);
    const priorRows = store.db.prepare(`SELECT e.*,b.id previous_batch_id,b.name previous_batch_name,b.source previous_source,b.platform previous_platform,b.period_start previous_period_start,b.period_end previous_period_end,b.metric_name previous_metric_name,b.metric_unit previous_metric_unit,b.imported_at previous_imported_at
      FROM market_entries e JOIN market_batches b ON b.id=e.batch_id WHERE b.id<>? AND b.period_end<=? ORDER BY b.period_end,e.row_number`).all(input.batchId, currentBatch.periodEnd);
    const previous = priorRows.map(row => ({ batch: batchRow({ ...row, id: row.previous_batch_id, name: row.previous_batch_name, source: row.previous_source, platform: row.previous_platform, period_start: row.previous_period_start, period_end: row.previous_period_end, metric_name: row.previous_metric_name, metric_unit: row.previous_metric_unit, imported_at: row.previous_imported_at }), entry: entry(row) }));
    const analyzed = selectedRows.map(row => {
      const value = entry(row);
      const matches: MarketMatch[] = previous.flatMap(item => { const reason = candidateReason(value.data, item.entry.data); return reason ? [{ entryId: item.entry.id, batchId: item.batch.id, title: item.entry.data.title, shop: item.entry.data.shop, reason }] : []; });
      return { ...value, analysis: analyzeMarketEntry(value, matches) };
    });
    return analyzeOpportunity(currentBatch, analyzed);
  }
  const opportunityRow = (row: Row): ProductOpportunity => {
    const linkedProjects = store.db.prepare('SELECT p.id,p.name,p.status FROM product_projects p JOIN project_evidence pe ON pe.project_id=p.id WHERE pe.evidence_id=? ORDER BY pe.created_at DESC').all(String(row.evidence_id)).map(project => ({ id: String(project.id), name: String(project.name), status: String(project.status) as ProductOpportunity['linkedProjects'][number]['status'] }));
    return { id: String(row.id), evidenceId: String(row.evidence_id), categoryId: row.category_id ? String(row.category_id) : null, title: String(row.title), status: String(row.status) as ProductOpportunity['status'], summary: String(row.summary), keywords: parse<ProductOpportunity['keywords']>(row.keywords_data), analysis: parse<ProductOpportunity['analysis']>(row.analysis_data), linkedProjectCount: linkedProjects.length, linkedProjects, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  };
  const opportunity = (id: string): ProductOpportunity => {
    const row = store.db.prepare(`SELECT o.*,(SELECT count(*) FROM project_evidence pe WHERE pe.evidence_id=o.evidence_id) linked_project_count FROM product_opportunities o WHERE o.id=?`).get(id);
    if (!row) throw new AppError('NOT_FOUND', '产品机会不存在', 404);
    return opportunityRow(row);
  };

  app.post('/api/market/opportunity-preview', async request => preview(opportunityPreviewInputSchema.parse(request.body)));
  app.get('/api/market/batches/:id/opportunity-overview', async request => {
    const batchId = idOf(request.params);
    const entryIds = store.db.prepare('SELECT id FROM market_entries WHERE batch_id=? ORDER BY row_number').all(batchId).map(row => String(row.id));
    if (!entryIds.length) throw new AppError('NO_ENTRIES', '当前批次没有商品记录', 409);
    const isResearchBatch=!!store.db.prepare('SELECT id FROM market_research_jobs WHERE market_batch_id=?').get(batchId);
    return previewMarketOpportunity(store,{batchId,entryIds},isResearchBatch);
  });
  app.get('/api/product-opportunities', async () => store.db.prepare(`SELECT o.*,(SELECT count(*) FROM project_evidence pe WHERE pe.evidence_id=o.evidence_id) linked_project_count FROM product_opportunities o ORDER BY o.updated_at DESC,o.rowid DESC`).all().map(opportunityRow));
  app.get('/api/product-opportunities/:id', async request => opportunity(idOf(request.params)));
  app.post('/api/product-opportunities/:id/projects', async (request, reply) => {
    const opportunityId = idOf(request.params);
    const input = opportunityProjectInputSchema.parse(request.body);
    const key = z.string().uuid().parse(request.headers['idempotency-key']);
    const value = opportunity(opportunityId);
    if (value.status !== 'READY') throw new AppError('OPPORTUNITY_NOT_READY', '请先审核通过该产品机会', 409);
    if (value.categoryId && input.categoryId && value.categoryId !== input.categoryId) throw new AppError('CATEGORY_MISMATCH', '项目类目必须与机会一致', 409);
    const categoryId = value.categoryId ?? input.categoryId;
    if (!categoryId) throw new AppError('CATEGORY_REQUIRED', '该机会没有类目，请为项目选择类目', 409);
    if (!store.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('NOT_FOUND', '类目不存在', 404);
    const scope = 'opportunity-project:create';
    const requestHash = createHash('sha256').update(JSON.stringify({ opportunityId, categoryId, name: input.name, scope: input.scope, projectType: input.projectType })).digest('hex');
    const result = store.transaction(() => {
      const previous = store.db.prepare('SELECT request_hash,resource_id FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
      if (previous) {
        if (String(previous.request_hash) !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '这次创建请求的内容已改变，请重新开始创建', 409);
        return { projectId: String(previous.resource_id), created: false };
      }
      const projectId = randomUUID(), time = now();
      const source = value.analysis.batch;
      const notes = `市场来源：${source.platform} · ${source.name}（${source.periodStart} 至 ${source.periodEnd}）。机会判断及风险详见已关联市场证据。`;
      store.db.prepare('INSERT INTO product_projects (id,category_id,name,status,brief_data,checklist_data,created_at,updated_at,project_type) VALUES (?,?,?,?,?,?,?,?,?)').run(projectId, categoryId, input.name, 'DRAFT', JSON.stringify({ objective: input.scope, positioning: '', constraints: [], notes }), JSON.stringify({ formulaConfirmed: false, packagingConfirmed: false, contentCompleted: false }), time, time, input.projectType);
      store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, 'DRAFT', 'PROJECT_CREATED', '由已审核市场机会建立产品项目', time);
      store.db.prepare('INSERT INTO project_evidence VALUES (?,?,?,?)').run(projectId, value.evidenceId, '作为项目立项依据', time);
      store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, null, 'OPPORTUNITY_LINKED', `关联市场机会：${value.title}`, time);
      store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, requestHash, projectId, time);
      return { projectId, created: true };
    });
    return reply.code(result.created ? 201 : 200).send({ ...result, opportunityId, evidenceId: value.evidenceId, batchId: value.analysis.batch.id });
  });
  app.post('/api/product-opportunities', async (request, reply) => {
    const input = opportunityInputSchema.parse(request.body), analysis = preview(input);
    if (!analysis.included.length) throw new AppError('NO_SUPPORTING_EVIDENCE', '所选记录均为老品、疑似换链接或证据待核对，不能形成产品机会', 409);
    if (input.categoryId && !store.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId)) throw new AppError('NOT_FOUND', '类目不存在', 404);
    const research=store.db.prepare('SELECT collection_profile FROM market_research_jobs WHERE market_batch_id=?').get(input.batchId);
    if (research) {
      const config=jdCollectionProfiles[String(research.collection_profile) as JdCollectionProfile];
      const categoryId=config&&store.db.prepare('SELECT id FROM categories WHERE code=?').get(config.categoryCode)?.id;
      if (!categoryId || input.categoryId!==String(categoryId)) throw new AppError('CATEGORY_MISMATCH','产品机会须使用来源研究对应的真实品类',409);
    }
    const supporting = new Set(analysis.included.map(item => item.id));
    for (const keyword of input.keywords) if (keyword.sourceEntryIds.some(id => !supporting.has(id))) throw new AppError('INVALID_FACT_REFERENCE', `关键词“${keyword.term}”引用了未纳入分析的商品`, 409);
    const time = now(), id = randomUUID(), evidenceId = randomUUID();
    const missingEvidence = [...new Set([...analysis.missingEvidence, ...input.missingEvidence])];
    const storedAnalysis = { ...analysis, replicability: input.replicability, replicabilityReason: input.replicabilityReason, risks: input.risks, missingEvidence };
    const sourceUrl = analysis.included.find(item => item.data.url)?.data.url || null;
    const rawContent = JSON.stringify({ type: 'product_opportunity', opportunityId: id, createdAt: time, analysis: storedAnalysis, selectedKeywords: input.keywords });
    store.transaction(() => {
      store.db.prepare('INSERT INTO market_evidence VALUES (?,?,?,?,?,?,?)').run(evidenceId, input.title, '竞品榜单机会分析', sourceUrl, input.summary, rawContent, time);
      store.db.prepare('INSERT INTO product_opportunities VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, evidenceId, input.categoryId, input.title, input.status, input.summary, JSON.stringify(input.keywords), JSON.stringify(storedAnalysis), time, time);
      const insert = store.db.prepare('INSERT INTO opportunity_entries VALUES (?,?,?,?,?)');
      analysis.included.forEach(item => insert.run(id, item.id, 'SUPPORTING', `纳入：${item.analysis.signal}`, time));
      analysis.excluded.forEach(item => insert.run(id, item.id, 'EXCLUDED', item.exclusionReason, time));
    });
    return reply.code(201).send(opportunity(id));
  });
  app.post('/api/market/ai-analysis', async (request, reply) => {
    const input = opportunityPreviewInputSchema.extend({ categoryId: z.string().uuid().nullable() }).parse(request.body);
    const analysis = preview(input);
    if (!analysis.included.length) throw new AppError('NO_SUPPORTING_EVIDENCE', '所选记录没有可用于分析的有效商品证据', 409);
    if (input.categoryId && !store.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId)) throw new AppError('NOT_FOUND', '类目不存在', 404);
    const historyRetrieval=await retrieveMarketHistory(store,analysis,input.categoryId);
    const ai = await analyzeWithAi(analysis,{historyRetrieval}), time = now(), createdIds: string[] = [];
    store.transaction(() => {
      for (const candidate of ai.output.opportunities) {
        const opportunityId = randomUUID(), evidenceId = randomUUID(); createdIds.push(opportunityId);
        const keywords = candidate.selling_points.map(item => ({ term: item.term, sourceEntryIds: item.evidence_record_ids }));
        const missingEvidence = [...new Set([...analysis.missingEvidence, ...ai.output.missing_data, ...candidate.missing_data])];
        const storedAnalysis = { ...analysis, replicability: candidate.replicability, replicabilityReason: candidate.replicability_reason, risks: candidate.risks.map(item => item.text), missingEvidence, ai: ai.output, textSignals: ai.textSignals, modelMetadata: ai.metadata, historyRetrieval };
        const sourceUrl = analysis.included.find(item => candidate.evidence_record_ids.includes(item.id) && item.data.url)?.data.url || null;
        const rawContent = JSON.stringify({ type: 'ai_product_opportunity_candidate', opportunityId, createdAt: time, analysis: storedAnalysis, selectedKeywords: keywords });
        store.db.prepare('INSERT INTO market_evidence VALUES (?,?,?,?,?,?,?)').run(evidenceId, candidate.name, 'AI竞品机会候选', sourceUrl, candidate.summary, rawContent, time);
        store.db.prepare('INSERT INTO product_opportunities VALUES (?,?,?,?,?,?,?,?,?,?)').run(opportunityId, evidenceId, input.categoryId, candidate.name, 'DRAFT', candidate.summary, JSON.stringify(keywords), JSON.stringify(storedAnalysis), time, time);
        const insert = store.db.prepare('INSERT INTO opportunity_entries VALUES (?,?,?,?,?)');
        analysis.included.forEach(item => insert.run(opportunityId, item.id, candidate.evidence_record_ids.includes(item.id) ? 'SUPPORTING' : 'COMPARISON', candidate.evidence_record_ids.includes(item.id) ? 'AI候选引用证据' : '参与分析但未作为核心依据', time));
        analysis.excluded.forEach(item => insert.run(opportunityId, item.id, 'EXCLUDED', item.exclusionReason, time));
      }
    });
    return reply.code(201).send(createdIds.map(opportunity));
  });
  app.post('/api/product-opportunities/:id/review', async (request, reply) => {
    const id = idOf(request.params), input = opportunityReviewSchema.parse(request.body);
    const current = opportunity(id);
    if (current.status !== 'DRAFT') throw new AppError('OPPORTUNITY_ALREADY_REVIEWED', '该机会候选已经完成审核', 409);
    if (!current.analysis.modelMetadata) throw new AppError('NOT_AI_CANDIDATE', '该记录不是 AI 机会候选', 409);
    if (current.analysis.modelMetadata.promptVersion !== marketOpportunityPromptVersion) throw new AppError('STALE_AI_CANDIDATE', '该候选使用旧版分析规则，需要重新分析后再审核', 409);
    const reviewedAt = now(), status = input.decision === 'APPROVED' ? 'READY' : 'REJECTED';
    const analysis = { ...current.analysis, review: { ...input, reviewedAt } };
    store.transaction(() => {
      store.db.prepare('UPDATE product_opportunities SET status=?,analysis_data=?,updated_at=? WHERE id=?').run(status, JSON.stringify(analysis), reviewedAt, id);
      const evidence = store.db.prepare('SELECT raw_content FROM market_evidence WHERE id=?').get(current.evidenceId);
      const raw = evidence ? parse<Record<string,unknown>>(evidence.raw_content) : {};
      store.db.prepare('UPDATE market_evidence SET raw_content=? WHERE id=?').run(JSON.stringify({ ...raw, review: { ...input, reviewedAt } }), current.evidenceId);
    });
    return reply.code(200).send(opportunity(id));
  });
  app.post('/api/product-projects/:id/opportunities', async (request, reply) => {
    const projectId = idOf(request.params), input = z.object({ opportunityId: z.string().uuid(), note: z.string().trim().max(1000) }).strict().parse(request.body);
    const project = store.db.prepare('SELECT id,category_id FROM product_projects WHERE id=?').get(projectId); if (!project) throw new AppError('NOT_FOUND', '产品项目不存在', 404);
    const value = opportunity(input.opportunityId); if (value.status !== 'READY') throw new AppError('OPPORTUNITY_NOT_READY', '产品机会需要先标记为可立项，才能加入产品项目', 409);
    if (project.category_id && value.categoryId && String(project.category_id) !== value.categoryId) throw new AppError('CATEGORY_MISMATCH', '产品机会与产品项目类目不一致', 409);
    let linked = false;
    store.transaction(() => {
      const result = store.db.prepare('INSERT OR IGNORE INTO project_evidence VALUES (?,?,?,?)').run(projectId, value.evidenceId, input.note, now());
      linked = Number(result.changes) === 1;
      if (linked) store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, null, 'OPPORTUNITY_LINKED', input.note || `加入产品机会：${value.title}`, now());
    });
    return reply.code(linked ? 201 : 200).send({ linked, projectId, opportunityId: value.id, evidenceId: value.evidenceId });
  });
}
