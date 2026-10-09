import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { marketResearchInputSchema, projectMarketResearchInputSchema, type MarketResearchJob, type MarketResearchState } from '../../packages/contracts/market-research.js';
import { adaptJdJingfen } from '../../packages/contracts/jd-market-adapter.js';
import { AppError, type Store } from './store.js';
import { importJdMarketBatch } from './jd-market-import.js';
import { createMarketResearchOpportunities } from './market-opportunity.js';
import { runMarketAiAnalysis, type MarketAiRunner } from './market-ai-service.js';
import { jdCollectionProfiles, type JdCollectionProfile } from '../../packages/contracts/jd-collection-profiles.js';
import { marketAnalysisModelOptions } from './model-router.js';

type Row=Record<string,unknown>;
const collectorRoot=resolve('D:/Projects/Tiny Projects/commerce-data-collector');
const collectorScript=join(collectorRoot,'scripts','jd_jingfen_pool_scan.py');
const now=()=>new Date().toISOString();
const parse=(value:unknown)=>JSON.parse(String(value)) as Record<string,unknown>;
export function marketResearchRow(row:Row):MarketResearchJob{return {id:String(row.id),initiatingProjectId:row.initiating_project_id?String(row.initiating_project_id):null,sourcePlatform:String(row.source_platform),collectionProfile:String(row.collection_profile),targetCount:Number(row.target_count),maxPages:Number(row.max_pages),state:String(row.state) as MarketResearchState,failedStage:row.failed_stage?String(row.failed_stage):null,scannedCount:Number(row.scanned_count),validCount:Number(row.valid_count),opportunityCount:Number(row.opportunity_count),manifestData:parse(row.manifest_data),marketBatchId:row.market_batch_id?String(row.market_batch_id):null,errorCode:row.error_code?String(row.error_code):null,safeMessage:row.safe_message?String(row.safe_message):null,retryCount:Number(row.retry_count),version:Number(row.version),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};}
function setState(store:Store,id:string,state:MarketResearchState,extra:Record<string,unknown>={}){const allowed=new Set(['failed_stage','scanned_count','valid_count','opportunity_count','manifest_data','market_batch_id','error_code','safe_message','lease_owner','lease_until','next_run_at','retry_count']);for(const key of Object.keys(extra))if(!allowed.has(key))throw new Error(`invalid job field ${key}`);const fields=['state=?','updated_at=?','version=version+1',...Object.keys(extra).map(key=>`${key}=?`)];const statement=store.db.prepare(`UPDATE market_research_jobs SET ${fields.join(',')} WHERE id=?`);(statement.run as (...values:any[])=>unknown)(state,now(),...Object.values(extra).map(value=>keyJson(value)),id);}
function keyJson(value:unknown){return value&&typeof value==='object'?JSON.stringify(value):value;}
export async function runCollector(job:Pick<MarketResearchJob,'id'|'maxPages'|'targetCount'> & {collectionProfile?:string}){
  if(!existsSync(collectorScript))throw new AppError('COLLECTOR_MISSING','京东采集器不可用',503);
  const profile=job.collectionProfile ?? 'shampoo';
  if(!(profile in jdCollectionProfiles))throw new AppError('COLLECTION_PROFILE_UNAVAILABLE','当前品类尚未配置京东研究',409);
  const batchId=`jd_ui_${job.id.replaceAll('-','').slice(0,12)}`;
  const rawRoot=join(collectorRoot,'data','raw','market','jd',batchId);
  const args=[collectorScript,'--batch-id',batchId,'--profile',profile,'--page-size','50','--max-pages',String(job.maxPages),'--request-interval','0.5','--timeout','20','--retries','2'];
  if(existsSync(rawRoot))args.push('--reuse-raw');
  const output=await new Promise<string>((ok,fail)=>{const child=spawn('python',args,{cwd:collectorRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();fail(new AppError('COLLECTOR_TIMEOUT','京东采集超时，可从当前阶段重试',504));},15*60_000);child.stdout.on('data',chunk=>{if(stdout.length<1_000_000)stdout+=String(chunk)});child.stderr.on('data',chunk=>{if(stderr.length<20_000)stderr+=String(chunk)});child.on('error',error=>{clearTimeout(timer);fail(error)});child.on('exit',code=>{clearTimeout(timer);if(code!==0){let type='';try{const last=stderr.trim().split(/\r?\n/).at(-1);type=z.object({status:z.literal('FAILED'),error_type:z.string().max(80)}).parse(JSON.parse(last??'')).error_type;}catch{}const access=type==='PermissionError',configuration=type==='RuntimeError';return fail(new AppError(access?'COLLECTOR_FILE_ACCESS':configuration?'COLLECTOR_CONFIGURATION':'COLLECTOR_FAILED',access?'采集器无法写入结果目录，请检查运行权限':configuration?'采集器配置无效，请检查本地凭证与路径':`京东采集失败（exit ${code}）`,502));}ok(stdout)});});
  const line=output.trim().split(/\r?\n/).at(-1);if(!line)throw new AppError('COLLECTOR_RESULT_INVALID','采集器未返回结果',502);
  const result=z.object({status:z.literal('SUCCESS'),batch_id:z.string(),collection_profile:z.string(),valid_count:z.number().int().nonnegative(),processed_path:z.string(),report_path:z.string(),hard_stop:z.boolean()}).parse(JSON.parse(line));
  if(result.batch_id!==batchId||result.collection_profile!==profile)throw new AppError('COLLECTOR_RESULT_INVALID','采集结果与请求品类不一致',502);
  const normalizedPath=resolve(collectorRoot,result.processed_path),reportPath=resolve(collectorRoot,result.report_path);
  if(!normalizedPath.startsWith(collectorRoot)||!reportPath.startsWith(collectorRoot)||!existsSync(normalizedPath))throw new AppError('COLLECTOR_RESULT_INVALID','采集结果路径无效',502);
  const source=JSON.parse(readFileSync(normalizedPath,'utf8')) as {pool_results?:Array<{raw_product_count?:number}>};
  return {batch_id:result.batch_id,source_platform:'jd',source_scope:'jd_union_jingfen',profile,raw_count:(source.pool_results??[]).reduce((sum,item)=>sum+Number(item.raw_product_count??0),0),deduplicated_count:result.valid_count,collector_valid_count:result.valid_count,valid_count:Math.min(job.targetCount,result.valid_count),normalized_json_path:normalizedPath,report_path:reportPath,raw_root:rawRoot,status:'success'};
}
export async function processMarketResearchJob(store:Store,id:string,rawAi:MarketAiRunner=runMarketAiAnalysis){
  const ai:MarketAiRunner=(preview,options)=>rawAi(preview,{
    ...options,
    lightModelId:options?.lightModelId&&marketAnalysisModelOptions().includes(options.lightModelId)?options.lightModelId:undefined,
    onRun:run=>{
      const current=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);
      const prior=Array.isArray(current.manifestData.aiRuns)?current.manifestData.aiRuns:[];
      setState(store,id,'ANALYZING',{manifest_data:{...current.manifestData,aiRuns:[...prior,{...run,retryCount:current.retryCount,createdAt:now()}].slice(-20)}});
    },
  });
  let job=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);
  try{
    let resume=job.state==='FAILED'?job.failedStage:job.state;
    if(resume==='CREATED'||resume==='COLLECTING'){setState(store,id,'COLLECTING',{failed_stage:null,error_code:null,safe_message:null});const manifest=await runCollector(job);setState(store,id,'NORMALIZING',{manifest_data:manifest,scanned_count:manifest.raw_count,valid_count:manifest.valid_count});job=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);resume='NORMALIZING';}
    if(resume==='NORMALIZING'){const manifest=job.manifestData;const source=JSON.parse(readFileSync(String(manifest.normalized_json_path),'utf8'));source.items=(source.items as unknown[]).slice(0,job.targetCount);const adapted=adaptJdJingfen(source,String(manifest.raw_root));adapted.batch.name=`${adapted.batch.name} · ${String(manifest.batch_id)}`;setState(store,id,'IMPORTING',{manifest_data:{...manifest,adapted}});job=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);resume='IMPORTING';}
    if(resume==='IMPORTING'){const adapted=job.manifestData.adapted;let imported;try{imported=importJdMarketBatch(store,adapted);}catch(error){const name=(adapted as {batch:{name:string}}).batch.name;const existing=store.db.prepare('SELECT id,(SELECT count(*) FROM market_entries WHERE batch_id=market_batches.id) count FROM market_batches WHERE name=?').get(name);if(!existing)throw error;imported={id:String(existing.id),count:Number(existing.count)};}setState(store,id,'ANALYZING',{market_batch_id:imported.id,valid_count:imported.count});job=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);resume='ANALYZING';}
    if(resume==='ANALYZING'){if(!job.marketBatchId)throw new Error('missing market batch');const config=jdCollectionProfiles[job.collectionProfile as JdCollectionProfile];if(!config)throw new AppError('COLLECTION_PROFILE_UNAVAILABLE','当前品类尚未配置京东研究',409);const category=store.db.prepare('SELECT id FROM categories WHERE code=?').get(config.categoryCode);if(!category)throw new AppError('CATEGORY_MISSING','研究品类未建立',409);const lightModelId=typeof job.manifestData.analysisLightModelId==='string'?job.manifestData.analysisLightModelId:undefined;const ids=await createMarketResearchOpportunities(store,job.marketBatchId,String(category.id),id,(preview,options)=>ai(preview,{...options,...(lightModelId?{lightModelId}:{})}));setState(store,id,'REVIEW_REQUIRED',{opportunity_count:ids.length,failed_stage:null,error_code:null,safe_message:null});}
  }catch(error){const current=marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);const stage=current.state==='FAILED'?(current.failedStage??'COLLECTING'):current.state;setState(store,id,'FAILED',{failed_stage:stage,error_code:error instanceof AppError?error.code:'MARKET_RESEARCH_FAILED',safe_message:error instanceof AppError?error.message:'市场研究未完成，请从当前阶段重试',lease_owner:null,lease_until:null,next_run_at:9_007_199_254_740_991});}
}
export function registerMarketResearch(app:FastifyInstance,store:Store){
  app.get('/api/market-research-models',async()=>({lightModels:marketAnalysisModelOptions(),currentLightModel:marketAnalysisModelOptions()[0]}));
  app.get('/api/market-research-jobs',async()=>store.db.prepare('SELECT * FROM market_research_jobs ORDER BY created_at DESC').all().map(marketResearchRow));
  app.post('/api/market-research-jobs',async(request,reply)=>{const input=marketResearchInputSchema.parse(request.body),id=randomUUID(),time=now();const config=jdCollectionProfiles[input.collectionProfile as JdCollectionProfile];if(!config||!store.db.prepare('SELECT id FROM categories WHERE code=?').get(config.categoryCode))throw new AppError('CATEGORY_MISSING','研究品类尚未建立，请先核对商品类目或记录人工市场依据',409);store.db.prepare('INSERT INTO market_research_jobs (id,source_platform,collection_profile,target_count,max_pages,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,input.sourcePlatform,input.collectionProfile,input.targetCount,input.maxPages,'CREATED',time,time);return reply.code(201).send(marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!));});
  app.get('/api/product-projects/:id/market-research-jobs',async request=>{const projectId=z.object({id:z.string().uuid()}).parse(request.params).id;if(!store.db.prepare('SELECT id FROM product_projects WHERE id=?').get(projectId))throw new AppError('NOT_FOUND','产品项目不存在',404);return store.db.prepare('SELECT * FROM market_research_jobs WHERE initiating_project_id=? ORDER BY created_at DESC,id DESC').all(projectId).map(marketResearchRow);});
  app.post('/api/product-projects/:id/market-research-jobs',async(request,reply)=>{
    const projectId=z.object({id:z.string().uuid()}).parse(request.params).id;
    const {targetCount}=projectMarketResearchInputSchema.parse(request.body);
    const key=z.string().uuid().parse(request.headers['idempotency-key']);
    const project=store.db.prepare('SELECT p.id,c.code category_code FROM product_projects p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?').get(projectId);
    if(!project)throw new AppError('NOT_FOUND','产品项目不存在',404);
    const profile=(Object.entries(jdCollectionProfiles).find(([,config])=>config.categoryCode===project.category_code)?.[0]) as JdCollectionProfile|undefined;
    if(!profile)throw new AppError('COLLECTION_PROFILE_UNAVAILABLE','当前品类尚未配置市场研究能力',409);
    const input=marketResearchInputSchema.parse({sourcePlatform:'jd',collectionProfile:profile,targetCount});
    const scope='project-market-research:create';
    const requestHash=createHash('sha256').update(JSON.stringify({projectId,...input})).digest('hex');
    const result=store.transaction(()=>{
      const previous=store.db.prepare('SELECT request_hash,resource_id FROM operation_keys WHERE scope=? AND key=?').get(scope,key);
      if(previous){if(String(previous.request_hash)!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT','这次研究请求的内容已改变，请重新开始',409);return {id:String(previous.resource_id),created:false};}
      const id=randomUUID(),time=now();
      store.db.prepare('INSERT INTO market_research_jobs (id,source_platform,collection_profile,target_count,max_pages,state,initiating_project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,input.sourcePlatform,input.collectionProfile,input.targetCount,input.maxPages,'CREATED',projectId,time,time);
      store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope,key,requestHash,id,time);
      return {id,created:true};
    });
    return reply.code(result.created?201:200).send(marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(result.id)!));
  });
  app.post('/api/market-research-jobs/:id/retry',async request=>{
    const id=z.object({id:z.string().uuid()}).parse(request.params).id;
    const row=store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id);
    if(!row)throw new AppError('NOT_FOUND','市场研究任务不存在',404);
    const job=marketResearchRow(row);
    if(job.state!=='FAILED')throw new AppError('JOB_NOT_FAILED','只有失败任务可以重试',409);
    const input=z.object({lightModelId:z.string().max(120).optional()}).parse(request.body??{});
    if(input.lightModelId&&(job.failedStage!=='ANALYZING'||!marketAnalysisModelOptions().includes(input.lightModelId)))throw new AppError('MODEL_NOT_CONFIGURED','该模型未在文本能力配置中启用',409);
    if(Number(row.next_run_at)===0)return job;
    setState(store,id,'FAILED',{retry_count:job.retryCount+1,next_run_at:0,error_code:null,safe_message:null,...(job.failedStage==='ANALYZING'?{manifest_data:{...job.manifestData,analysisLightModelId:input.lightModelId??null}}:{})});
    return marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);
  });
  app.post('/api/market-research-jobs/:id/complete',async request=>{const id=z.object({id:z.string().uuid()}).parse(request.params).id,row=store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id);if(!row)throw new AppError('NOT_FOUND','市场研究任务不存在',404);const job=marketResearchRow(row);if(job.state!=='REVIEW_REQUIRED')throw new AppError('REVIEW_NOT_REQUIRED','任务当前不能完成审核',409);const counts=store.db.prepare("SELECT count(*) total,sum(CASE WHEN status='DRAFT' THEN 1 ELSE 0 END) drafts FROM product_opportunities WHERE json_extract(analysis_data,'$.marketResearchJobId')=?").get(id);if(!counts||Number(counts.total)===0||Number(counts.drafts)>0)throw new AppError('REVIEW_INCOMPLETE','请先人工处理本次研究的全部机会候选',409);setState(store,id,'COMPLETED');return marketResearchRow(store.db.prepare('SELECT * FROM market_research_jobs WHERE id=?').get(id)!);});
}
