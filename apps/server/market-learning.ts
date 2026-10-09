import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, type Store } from './store.js';
import { embeddingConfig, requestEmbeddings, type Embedder, type EmbeddingConfig } from './embedding-provider.js';
import { cosineSimilarity, summarizeOpportunityReviews, reviewReasonSchema, type HistoryReference, type HistoryRetrieval, type LearningRow } from '../../packages/contracts/market-learning.js';
import type { OpportunityPreview, ProductOpportunity } from '../../packages/contracts/market-opportunity.js';
import { jdCollectionProfiles,type JdCollectionProfile } from '../../packages/contracts/jd-collection-profiles.js';

export const memorySummaryVersion='market-memory-v1';
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function learningRows(store:Store):LearningRow[]{
  return store.db.prepare('SELECT * FROM product_opportunities ORDER BY created_at,id').all().flatMap(row=>{
    const analysis=JSON.parse(String(row.analysis_data)) as ProductOpportunity['analysis'];
    if(!analysis.modelMetadata)return [];
    const review=analysis.review;
    return [{id:String(row.id),title:String(row.title),categoryId:row.category_id?String(row.category_id):null,batchId:analysis.batch.id,batchName:analysis.batch.name,model:analysis.modelMetadata.modelId||'UNKNOWN',modelVersion:analysis.modelMetadata.modelVersion||null,promptVersion:analysis.modelMetadata.promptVersion,decision:review?.decision??null,note:review?.note??'',reasonCodes:review?.reasonCodes??[],reviewedAt:review?.reviewedAt??null}];
  });
}
export function historyReferences(store:Store):HistoryReference[]{
  const reviewed=learningRows(store).filter(row=>row.decision&&row.categoryId);
  return reviewed.map(item=>{
    const row=store.db.prepare('SELECT evidence_id,summary,keywords_data,analysis_data FROM product_opportunities WHERE id=?').get(item.id)!;
    const analysis=JSON.parse(String(row.analysis_data)) as ProductOpportunity['analysis'];
    const supportingRecords=store.db.prepare("SELECT e.id,e.normalized_data FROM opportunity_entries oe JOIN market_entries e ON e.id=oe.entry_id WHERE oe.opportunity_id=? AND oe.role='SUPPORTING' ORDER BY e.row_number LIMIT 5").all(item.id).map(r=>({id:String(r.id),title:String(JSON.parse(String(r.normalized_data)).title??'').slice(0,160)}));
    const research=store.db.prepare('SELECT id FROM market_research_jobs WHERE market_batch_id=?').get(item.batchId);
    return {opportunityId:item.id,evidenceId:String(row.evidence_id),batchId:item.batchId,batchName:item.batchName,categoryId:item.categoryId!,title:item.title,judgment:String(row.summary).slice(0,1200),keywords:(JSON.parse(String(row.keywords_data)) as Array<{term:string}>).slice(0,12).map(k=>k.term),risks:analysis.risks.slice(0,5).map(risk=>risk.slice(0,200)),supportingRecords,decision:item.decision!,reviewNote:item.note,reasonCodes:item.reasonCodes,reviewedAt:item.reviewedAt!,sourceDate:analysis.batch.periodEnd,sourcePlatform:analysis.batch.platform??'未记录',researchJobId:research?String(research.id):null};
  });
}
const memoryInput=(ref:HistoryReference)=>JSON.stringify(ref);
const indexing=new WeakMap<Store,Map<string,Promise<{indexed:number;remaining:number;eligible:number;calls:number}>>>();
export async function indexMarketMemory(store:Store,categoryId:string,embed:Embedder=requestEmbeddings,config=embeddingConfig()){
  let active=indexing.get(store);if(!active){active=new Map();indexing.set(store,active);}
  const key=JSON.stringify([categoryId,config]);const prior=active.get(key);if(prior)return prior;
  const pending=performIndex(store,categoryId,embed,config);active.set(key,pending);
  try{return await pending;}finally{active.delete(key);}
}
async function performIndex(store:Store,categoryId:string,embed:Embedder,config:EmbeddingConfig){
  const refs=historyReferences(store).filter(ref=>ref.categoryId===categoryId);
  const missing=refs.filter(ref=>!store.db.prepare('SELECT id FROM market_memory_embeddings WHERE opportunity_id=? AND content_fingerprint=? AND summary_version=? AND provider=? AND model=? AND model_version=? AND dimension=?').get(ref.opportunityId,fingerprint(ref),memorySummaryVersion,config.provider,config.model,config.version,config.dimension));
  // One explicit indexing action is bounded to one provider batch. Repeating indexes only remaining summaries.
  const selected=missing.slice(0,10);if(!selected.length)return {indexed:0,remaining:0,eligible:refs.length,calls:0};
  const result=await embed(selected.map(memoryInput),config);
  if(result.vectors.length!==selected.length)throw new AppError('OUTPUT_INVALID','向量结果数量无效',409);
  store.transaction(()=>selected.forEach((ref,i)=>{
    cosineSimilarity(result.vectors[i]!,result.vectors[i]!);
    if(result.vectors[i]!.length!==config.dimension)throw new AppError('OUTPUT_INVALID','向量维度无效',409);
    const current=historyReferences(store).find(item=>item.opportunityId===ref.opportunityId);
    if(!current||fingerprint(current)!==fingerprint(ref))throw new AppError('CONFLICT','审核资料已改变，请重新建立索引',409);
    store.db.prepare('INSERT OR IGNORE INTO market_memory_embeddings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),ref.opportunityId,fingerprint(ref),memorySummaryVersion,JSON.stringify(ref),config.provider,config.model,config.version,config.dimension,JSON.stringify(result.vectors[i]),result.requestId,result.latencyMs,new Date().toISOString());
  }));
  return {indexed:selected.length,remaining:missing.length-selected.length,eligible:refs.length,calls:1};
}
export async function retrieveMarketHistory(store:Store,preview:OpportunityPreview,categoryId:string|null,embed:Embedder=requestEmbeddings,config:EmbeddingConfig=embeddingConfig()):Promise<HistoryRetrieval>{
  const query={batchId:preview.batch.id,categoryId,keywords:preview.stats.sellingPoints.map(item=>item.term).slice(0,12),titles:preview.included.slice(0,8).map(item=>item.data.title)};
  const base={model:config.model,modelVersion:config.version||null,provider:config.provider,latencyMs:0,dimension:config.dimension,requestId:null,inputFingerprint:fingerprint(query),hits:[]};
  if(!categoryId)return {...base,status:'NO_CATEGORY'};
  const research=store.db.prepare('SELECT collection_profile FROM market_research_jobs WHERE market_batch_id=?').get(preview.batch.id);
  if(research){const profile=jdCollectionProfiles[String(research.collection_profile) as JdCollectionProfile];const expected=profile&&store.db.prepare('SELECT id FROM categories WHERE code=?').get(profile.categoryCode);if(!expected||String(expected.id)!==categoryId)throw new AppError('CATEGORY_MISMATCH','历史参考品类必须与当前研究一致',409);}
  const current=new Map(historyReferences(store).filter(ref=>ref.categoryId===categoryId&&ref.batchId!==preview.batch.id&&ref.sourceDate<=preview.batch.periodEnd&&Date.parse(ref.reviewedAt)<=Date.parse(`${preview.batch.periodEnd}T23:59:59.999Z`)).map(ref=>[ref.opportunityId,ref]));
  const rows=store.db.prepare('SELECT * FROM market_memory_embeddings WHERE provider=? AND model=? AND model_version=? AND dimension=? AND summary_version=?').all(config.provider,config.model,config.version,config.dimension,memorySummaryVersion).filter(row=>{const ref=current.get(String(row.opportunity_id));return ref&&fingerprint(ref)===row.content_fingerprint;});
  if(!rows.length)return {...base,status:'NO_INDEX'};
  const result=await embed([JSON.stringify(query)],config);const vector=result.vectors[0];
  if(!vector||vector.length!==config.dimension)throw new AppError('OUTPUT_INVALID','查询向量维度无效',409);
  const hits=rows.map(row=>({memoryId:String(row.id),score:cosineSimilarity(vector,JSON.parse(String(row.vector_data))),reference:current.get(String(row.opportunity_id))!})).filter(hit=>hit.score>=0.45).sort((a,b)=>b.score-a.score||a.reference.opportunityId.localeCompare(b.reference.opportunityId)).slice(0,3);
  return {...base,requestId:result.requestId,latencyMs:result.latencyMs,status:hits.length?'USED':'NO_MATCH',hits};
}
export function registerMarketLearning(app:FastifyInstance,store:Store){
  app.get('/api/market-learning/reviews',async request=>{
    const q=z.object({categoryId:z.string().uuid().optional(),batchId:z.string().uuid().optional(),model:z.string().max(120).optional(),promptVersion:z.string().max(100).optional()}).strict().parse(request.query);
    return summarizeOpportunityReviews(learningRows(store).filter(row=>(!q.categoryId||row.categoryId===q.categoryId)&&(!q.batchId||row.batchId===q.batchId)&&(!q.model||row.model===q.model)&&(!q.promptVersion||row.promptVersion===q.promptVersion)));
  });
  app.get('/api/market-learning/memory',async()=>({model:embeddingConfig().model,dimension:512,eligible:historyReferences(store).length,indexed:Number(store.db.prepare('SELECT count(*) n FROM market_memory_embeddings').get()!.n)}));
  app.post('/api/market-learning/memory/index',async request=>{const {categoryId}=z.object({categoryId:z.string().uuid()}).strict().parse(request.body);if(!store.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId))throw new AppError('NOT_FOUND','品类不存在',404);return indexMarketMemory(store,categoryId);});
  app.post('/api/market-learning/memory/search',async request=>{const {batchId,categoryId}=z.object({batchId:z.string().uuid(),categoryId:z.string().uuid()}).strict().parse(request.body);const {previewMarketOpportunity}=await import('./market-opportunity.js');const ids=store.db.prepare('SELECT id FROM market_entries WHERE batch_id=?').all(batchId).map(row=>String(row.id));if(!ids.length)throw new AppError('NO_ENTRIES','当前批次没有样本',409);return retrieveMarketHistory(store,previewMarketOpportunity(store,{batchId,entryIds:ids},true),categoryId);});
}
