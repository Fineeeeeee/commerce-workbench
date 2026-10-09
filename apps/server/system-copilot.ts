import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordedStructuredRun } from './ai-inference-runs.js';
import { AppError, type Store } from './store.js';
import { currentWorkQueue, taskCandidates } from './work-queue.js';
import { workEntitySchema, workPrioritySchema } from '../../packages/contracts/work-queue.js';

type Row=Record<string,unknown>;
const str=(value:unknown)=>String(value??'');
const count=(store:Store,sql:string)=>Number(store.db.prepare(sql).get()!.n);
const fact=z.object({text:z.string().max(240),sourceRef:z.string().max(120)}).strict();
const judgement=z.object({text:z.string().max(300),sourceRefs:z.array(z.string().max(120)).max(8)}).strict();
const recommendation=z.object({workItemId:z.string().max(120),why:z.string().max(400),urgency:z.string().max(200),sourceRefs:z.array(z.string().max(120)).max(8)}).strict();
const health=z.object({projectId:z.string().uuid(),assessment:z.string().max(300),risk:z.string().max(240),nextStep:z.string().max(240)}).strict();
const recommendSchema=z.object({facts:z.array(fact).max(8),inferences:z.array(judgement).max(8),recommendations:z.array(recommendation).max(3),projectHealth:z.array(health).max(8)}).strict();
const answerSchema=z.object({facts:z.array(fact).max(10),inferences:z.array(judgement).max(8),answer:z.string().max(2000),suggestedNextSteps:z.array(z.string().max(240)).max(5),uncertainty:z.string().max(400)}).strict();
const summarySchema=z.object({facts:z.array(fact).max(10),inferences:z.array(judgement).max(5),completed:z.array(z.string().max(240)).max(8),needsAttention:z.array(z.string().max(240)).max(8),nextSteps:z.array(z.string().max(240)).max(5),uncertainty:z.string().max(400)}).strict();
const taskSchema=z.object({title:z.string().trim().min(1).max(160),priority:workPrioritySchema,deadline:z.iso.datetime({offset:true}).nullable(),objective:z.string().trim().min(1).max(2000),requirements:z.array(z.string().trim().min(1).max(400)).max(12),acceptanceCriteria:z.array(z.string().trim().min(1).max(400)).min(1).max(12),relatedEntityType:workEntitySchema,relatedEntityId:z.string().uuid(),workflow:z.string().max(120)}).strict();
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=(items:object)=>({type:'array',items});
const string={type:'string'};
const nullableString={type:['string','null']};
const factJson=object({text:string,sourceRef:string});
const judgementJson=object({text:string,sourceRefs:array(string)});
const recommendJson=object({facts:array(factJson),inferences:array(judgementJson),recommendations:array(object({workItemId:string,why:string,urgency:string,sourceRefs:array(string)})),projectHealth:array(object({projectId:string,assessment:string,risk:string,nextStep:string}))});
const answerJson=object({facts:array(factJson),inferences:array(judgementJson),answer:string,suggestedNextSteps:array(string),uncertainty:string});
const summaryJson=object({facts:array(factJson),inferences:array(judgementJson),completed:array(string),needsAttention:array(string),nextSteps:array(string),uncertainty:string});
const taskJson=object({title:string,priority:{type:'string',enum:workPrioritySchema.options},deadline:nullableString,objective:string,requirements:array(string),acceptanceCriteria:array(string),relatedEntityType:{type:'string',enum:workEntitySchema.options},relatedEntityId:string,workflow:string});

export function systemContext(store:Store){
  const queue=currentWorkQueue(store);
  const projects=store.db.prepare("SELECT id,name,status,project_type,updated_at FROM product_projects WHERE status<>'CLOSED' ORDER BY updated_at DESC LIMIT 20").all().map((r:Row)=>{
    const id=str(r.id);
    const counts=store.db.prepare(`SELECT
      (SELECT count(*) FROM project_evidence WHERE project_id=?) evidence,
      (SELECT count(*) FROM spus WHERE product_project_id=?) spus,
      (SELECT count(*) FROM products p LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE COALESCE(s.product_project_id,link.project_id)=?) skus,
      (SELECT count(*) FROM kits k JOIN products p ON p.id=k.product_id LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE COALESCE(s.product_project_id,link.project_id)=?) contentKits,
      (SELECT count(*) FROM channel_deliveries WHERE project_id=?) deliveries,
      (SELECT count(*) FROM business_feedback WHERE project_id=?) feedback`).get(id,id,id,id,id,id)!;
    return {id,name:str(r.name),stage:str(r.status),type:r.project_type?str(r.project_type):null,updatedAt:str(r.updated_at),objects:{evidence:Number(counts.evidence),spus:Number(counts.spus),skus:Number(counts.skus),contentKits:Number(counts.contentKits),deliveries:Number(counts.deliveries),feedback:Number(counts.feedback)}};
  });
  const skus=store.db.prepare('SELECT id FROM products ORDER BY updated_at DESC LIMIT 30').all().map((r:Row)=>{const sku=store.product(str(r.id));return {id:sku.id,name:sku.name,specification:sku.specification,spuId:sku.spuId};});
  const market=store.db.prepare('SELECT id,name,platform,imported_at FROM market_batches ORDER BY imported_at DESC LIMIT 4').all().map((r:Row)=>({id:str(r.id),name:str(r.name),platform:str(r.platform),capturedAt:str(r.imported_at),sampleSize:Number(store.db.prepare('SELECT count(*) n FROM market_entries WHERE batch_id=?').get(str(r.id))!.n)}));
  const recentEvents=store.db.prepare('SELECT project_id,event_type,note,created_at FROM project_stage_events ORDER BY created_at DESC LIMIT 20').all().map((r:Row)=>({projectId:str(r.project_id),type:str(r.event_type),note:str(r.note).slice(0,160),at:str(r.created_at)}));
  return {
    market:{recentBatches:market,openSignals:queue.attention.filter(item=>item.kind==='monitoring').length,researchInProgress:count(store,"SELECT count(*) n FROM market_research_jobs WHERE state IN ('CREATED','COLLECTING','NORMALIZING','IMPORTING','ANALYZING')")},
    competitive:{available:false,note:'当前没有独立竞品结论对象；市场样本统计由 Market 模块呈现'},
    project:{items:projects,recentEvents},product:{skus},
    productBrief:{draft:count(store,"SELECT count(*) n FROM product_briefs WHERE status='DRAFT'"),confirmed:count(store,"SELECT count(*) n FROM product_briefs WHERE status='CONFIRMED'")},
    seoListing:{draft:count(store,"SELECT count(*) n FROM listing_contents WHERE status='DRAFT'"),confirmed:count(store,"SELECT count(*) n FROM listing_contents WHERE status='CONFIRMED'")},
    content:{kits:count(store,'SELECT count(*) n FROM kits'),reviewedPages:count(store,"SELECT count(*) n FROM content_quality_results WHERE human_decision='APPROVE'")},
    quality:{ruleFailures:count(store,"SELECT count(*) n FROM content_quality_results WHERE rule_status='FAIL'"),humanRejected:count(store,"SELECT count(*) n FROM content_quality_results WHERE human_decision='REJECT'")},
    delivery:{records:count(store,'SELECT count(*) n FROM channel_deliveries'),feedbackRecords:count(store,'SELECT count(*) n FROM business_feedback')},
    tasks:{attention:queue.attention.slice(0,20).map(item=>({id:item.id,title:item.title,status:item.status,source:item.source,rank:item.rank,rankingReasons:item.rankingReasons,deadline:item.deadline,object:item.context,reason:item.reason})),running:queue.running.slice(0,10).map(item=>({id:item.id,title:item.title,status:item.status,object:item.context}))},
  };
}
function checkRefs(output:{facts:Array<{sourceRef:string}>;inferences:Array<{sourceRefs:string[]}>},allowed:Set<string>){
  const refs=[...output.facts.map(item=>item.sourceRef),...output.inferences.flatMap(item=>item.sourceRefs)];
  if(refs.some(ref=>!allowed.has(ref)))throw new AppError('INVALID_AI_REFERENCE','AI 引用了上下文之外的对象',409);
}
function rejectInvalidRun(store:Store,id:string):never{
  store.db.prepare("UPDATE ai_inference_runs SET status='FAILED',error_code='INVALID_AI_REFERENCE' WHERE id=?").run(id);
  throw new AppError('INVALID_AI_REFERENCE','AI 引用了上下文之外的对象',409);
}
function periodStart(period:'day'|'week'){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
  const localDay=Date.UTC(value('year'),value('month')-1,value('day'));
  const startDay=period==='week'?localDay-((new Date(localDay).getUTCDay()+6)%7)*86400000:localDay;
  const offsetPart=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'shortOffset'}).formatToParts(new Date(startDay)).find(part=>part.type==='timeZoneName')?.value??'GMT';
  const match=/GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offsetPart);
  const offset=match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]??0)):0;
  return new Date(startDay-offset*60000).toISOString();
}
function references(context:ReturnType<typeof systemContext>){
  return new Set(['market','competitive','productBrief','seoListing','content','quality','delivery','tasks',...context.project.items.map(item=>`project:${item.id}`),...context.product.skus.map(item=>`sku:${item.id}`),...context.market.recentBatches.map(item=>`batch:${item.id}`),...context.tasks.attention.map(item=>`task:${item.id}`)]);
}
const basePrompt='你是只读的企业产品工作台协调助手。只读取输入的结构化摘要；不得重新计算业务数值、虚构市场规模/销量/趋势或写入业务状态。明确区分系统事实、AI 判断、建议下一步。引用只可使用输入给出的 sourceRefs。没有证据时说明不足。输出严格 JSON，语言简洁。';
const sourceIds=(context:ReturnType<typeof systemContext>)=>[...references(context)];

export function registerSystemCopilot(app:FastifyInstance,store:Store){
  app.get('/api/system-copilot/context',async()=>{const context=systemContext(store);return {context,inputBytes:Buffer.byteLength(JSON.stringify(context),'utf8')};});
  app.post('/api/system-copilot/recommend',async()=>{
    const context=systemContext(store),input={context,sourceRefs:sourceIds(context)};
    const run=await recordedStructuredRun(store,{task:'system_recommend',subjectType:'system',subjectId:'overview',input,systemPrompt:`${basePrompt} 只从 tasks.attention 推荐最多三件事；排序综合人工优先级、截止时间、下游阻塞与失败风险，领导指派并非恒定第一。每条 workItemId 必须来自候选任务，原因应指向真实对象。`,outputName:'system_recommend',jsonSchema:recommendJson,validator:recommendSchema,reuseSucceeded:true});
    const allowedIds=new Set(context.tasks.attention.map(item=>item.id));
    if(run.output.recommendations.some(item=>!allowedIds.has(item.workItemId))||run.output.projectHealth.some(item=>!context.project.items.some(project=>project.id===item.projectId)))rejectInvalidRun(store,run.id);
    try{checkRefs(run.output,references(context));}catch{rejectInvalidRun(store,run.id);}
    if(run.output.recommendations.some(item=>item.sourceRefs.some(ref=>!references(context).has(ref))))rejectInvalidRun(store,run.id);
    const inputBytes=Buffer.byteLength(JSON.stringify(input),'utf8');
    return {runId:run.id,model:run.model,modelVersion:run.modelVersion,cached:run.cached,inputBytes,output:run.output};
  });
  app.post('/api/system-copilot/ask',async request=>{
    const {question}=z.object({question:z.string().trim().min(2).max(500)}).strict().parse(request.body);
    const context=systemContext(store),input={context,question,sourceRefs:sourceIds(context)};
    const run=await recordedStructuredRun(store,{task:'system_question',subjectType:'system',subjectId:'overview',input,systemPrompt:basePrompt,outputName:'system_question',jsonSchema:answerJson,validator:answerSchema,reuseSucceeded:true});
    try{checkRefs(run.output,references(context));}catch{rejectInvalidRun(store,run.id);}
    return {runId:run.id,model:run.model,cached:run.cached,inputBytes:Buffer.byteLength(JSON.stringify(input),'utf8'),output:run.output};
  });
  app.post('/api/system-copilot/summary',async request=>{
    const {period}=z.object({period:z.enum(['day','week'])}).strict().parse(request.body);
    const context=systemContext(store),since=periodStart(period);
    const input={period,since,context:{...context,project:{...context.project,recentEvents:context.project.recentEvents.filter(item=>item.at>=since)}},sourceRefs:sourceIds(context)};
    const run=await recordedStructuredRun(store,{task:'system_summary',subjectType:'system',subjectId:period,input,systemPrompt:`${basePrompt} 仅把 since 之后有时间戳的记录写为本期完成；无时间信息的计数只能描述当前状态，不得冒充本期新增。`,outputName:'system_summary',jsonSchema:summaryJson,validator:summarySchema,reuseSucceeded:true});
    try{checkRefs(run.output,references(context));}catch{rejectInvalidRun(store,run.id);}
    return {runId:run.id,model:run.model,cached:run.cached,inputBytes:Buffer.byteLength(JSON.stringify(input),'utf8'),output:run.output};
  });
  app.post('/api/system-copilot/structure-task',async request=>{
    const {text}=z.object({text:z.string().trim().min(4).max(1000)}).strict().parse(request.body);
    const candidates=taskCandidates(store).map(item=>({type:item.type,id:item.id,label:item.label}));
    const input={text,currentTime:new Date(Math.floor(Date.now()/3600000)*3600000).toISOString(),timeZone:'America/New_York',candidates};
    const run=await recordedStructuredRun(store,{task:'system_task_structure',subjectType:'system',subjectId:'task-draft',input,systemPrompt:'只从 candidates 中选择真实业务对象，输出严格 JSON 任务草稿。不得创建任务或执行内容工作流。deadline 需是带时区的 ISO 时间；无法确定时为 null。若用户指定 F01 等页面，必须选对应 CONTENT_PAGE 的 id，不要只选 SKU。把版本数量和验收条件写清楚，不虚构对象。用户确认前草稿没有正式效力。',outputName:'system_task_structure',jsonSchema:taskJson,validator:taskSchema,reuseSucceeded:true});
    const selected=candidates.find(item=>item.type===run.output.relatedEntityType&&item.id===run.output.relatedEntityId);
    if(!selected)rejectInvalidRun(store,run.id);
    const targetPage=selected.type==='CONTENT_PAGE'?selected.label.match(/(?:^| · )(F0[1-5]|D(?:0[1-9]|1[0-2]))$/)?.[1]??null:null;
    return {runId:run.id,model:run.model,cached:run.cached,inputBytes:Buffer.byteLength(JSON.stringify(input),'utf8'),draft:{...run.output,targetPage}};
  });
}
