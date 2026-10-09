import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { manualWorkInputSchema, rankUnifiedQueue, type ManualWorkInput, type ManualWorkItem, type WorkEntity } from '../../packages/contracts/work-queue.js';
import type { WorkTarget } from '../../packages/contracts/overview-work.js';
import { currentOverviewWork } from './overview-work.js';
import { AppError, type Store } from './store.js';

type Row=Record<string,unknown>;
const now=()=>new Date().toISOString();
const uuid=z.string().uuid();
function skuProjectId(store:Store,skuId:string):string|undefined{
  const owner=store.db.prepare('SELECT COALESCE(s.product_project_id,link.project_id) project_id FROM products p LEFT JOIN spus s ON s.id=p.spu_id LEFT JOIN project_independent_skus link ON link.sku_id=p.id WHERE p.id=?').get(skuId);
  return owner?.project_id?String(owner.project_id):undefined;
}

export function resolveWorkTarget(store:Store,type:WorkEntity,id:string):{target:WorkTarget;label:string}{
  if(type==='PROJECT'){
    const row=store.db.prepare('SELECT name FROM product_projects WHERE id=?').get(id);
    if(!row)throw new AppError('RELATED_ENTITY_NOT_FOUND','关联项目不存在',404);
    return {target:{view:'projects',projectId:id},label:String(row.name)};
  }
  if(type==='SKU'){
    const sku=store.product(id);
    const projectId=skuProjectId(store,id);
    return {target:{view:'studio',skuId:id,...(projectId?{projectId}:{})},label:`${sku.name} · ${sku.specification}`};
  }
  if(type==='OPPORTUNITY'){
    const row=store.db.prepare('SELECT title,analysis_data FROM product_opportunities WHERE id=?').get(id);
    if(!row)throw new AppError('RELATED_ENTITY_NOT_FOUND','关联机会不存在',404);
    const data=JSON.parse(String(row.analysis_data)) as {batch?:{id?:string}};
    return {target:{view:'market',opportunityId:id,...(data.batch?.id?{batchId:data.batch.id}:{})},label:String(row.title)};
  }
  if(type==='CONTENT_KIT'){
    const kit=store.kit(id),sku=store.product(kit.productId);
    const projectId=skuProjectId(store,kit.productId);
    return {target:{view:'studio',skuId:kit.productId,kitId:id,tab:'production',...(projectId?{projectId}:{})},label:`${sku.name} · ${kit.name}`};
  }
  for(const row of store.db.prepare('SELECT id FROM kits ORDER BY updated_at DESC').all()){
    const kit=store.kit(String(row.id)),page=kit.pages.find(item=>item.id===id);
    if(page){const sku=store.product(kit.productId),projectId=skuProjectId(store,kit.productId);return {target:{view:'studio',skuId:kit.productId,kitId:kit.id,pageId:id,tab:'production',contentAction:'visual',...(projectId?{projectId}:{})},label:`${sku.name} · ${kit.name} · ${page.templateId??page.kind}`};}
  }
  throw new AppError('RELATED_ENTITY_NOT_FOUND','关联内容页不存在',404);
}

function manualRow(store:Store,row:Row):ManualWorkItem{
  const relatedEntityType=row.related_entity_type as ManualWorkItem['relatedEntityType'],relatedEntityId=String(row.related_entity_id);
  return {id:String(row.id),title:String(row.title),source:row.source as ManualWorkItem['source'],priority:row.priority as ManualWorkItem['priority'],deadline:row.deadline?String(row.deadline):null,objective:String(row.objective),acceptanceCriteria:JSON.parse(String(row.acceptance_criteria)),relatedEntityType,relatedEntityId,target:resolveWorkTarget(store,relatedEntityType,relatedEntityId).target,status:row.status as ManualWorkItem['status'],createdAt:String(row.created_at),updatedAt:String(row.updated_at)};
}
export function currentWorkQueue(store:Store){
  const overview=currentOverviewWork(store),time=now();
  const manual=store.db.prepare("SELECT * FROM manual_work_items WHERE status IN ('OPEN','IN_PROGRESS') ORDER BY created_at DESC LIMIT 200").all().map(row=>manualRow(store,row));
  return {attention:rankUnifiedQueue(overview.attention,manual,time),running:overview.running,updatedAt:time};
}
export function taskCandidates(store:Store){
  const candidates:Array<{type:WorkEntity;id:string;label:string;target:WorkTarget}>=[];
  const add=(type:WorkEntity,id:string)=>{const resolved=resolveWorkTarget(store,type,id);candidates.push({type,id,...resolved});};
  for(const row of store.db.prepare('SELECT id FROM product_projects ORDER BY updated_at DESC LIMIT 30').all())add('PROJECT',String(row.id));
  for(const row of store.db.prepare('SELECT id FROM products ORDER BY updated_at DESC LIMIT 30').all())add('SKU',String(row.id));
  for(const row of store.db.prepare("SELECT id FROM product_opportunities WHERE status IN ('DRAFT','READY') ORDER BY updated_at DESC LIMIT 30").all())add('OPPORTUNITY',String(row.id));
  for(const row of store.db.prepare('SELECT id FROM kits ORDER BY updated_at DESC LIMIT 20').all()){
    const id=String(row.id);add('CONTENT_KIT',id);
    const kit=store.kit(id),sku=store.product(kit.productId),projectId=skuProjectId(store,kit.productId);
    for(const page of kit.pages)candidates.push({type:'CONTENT_PAGE',id:page.id,label:`${sku.name} · ${kit.name} · ${page.templateId??page.kind}`,target:{view:'studio',skuId:kit.productId,kitId:id,pageId:page.id,tab:'production',contentAction:'visual',...(projectId?{projectId}:{})}});
  }
  return candidates;
}

export function registerWorkQueue(app:FastifyInstance,store:Store){
  app.get('/api/work-queue',async()=>currentWorkQueue(store));
  app.get('/api/work-queue/targets',async()=>taskCandidates(store));
  app.get('/api/work-queue/manual',async()=>store.db.prepare('SELECT * FROM manual_work_items ORDER BY created_at DESC LIMIT 200').all().map(row=>manualRow(store,row)));
  app.post('/api/work-queue/manual',async(request,reply)=>{
    const input:ManualWorkInput=manualWorkInputSchema.parse(request.body);
    const requestKey=uuid.parse(request.headers['idempotency-key']);
    const existing=store.db.prepare('SELECT * FROM manual_work_items WHERE request_key=?').get(requestKey);
    if(existing){const task=manualRow(store,existing);if(JSON.stringify({...task,target:undefined,id:undefined,status:undefined,createdAt:undefined,updatedAt:undefined})!==JSON.stringify({...input,target:undefined,id:undefined,status:undefined,createdAt:undefined,updatedAt:undefined}))throw new AppError('IDEMPOTENCY_CONFLICT','该提交编号已用于其他任务',409);return task;}
    const {target}=resolveWorkTarget(store,input.relatedEntityType,input.relatedEntityId);
    const id=randomUUID(),time=now();
    store.db.prepare(`INSERT INTO manual_work_items (id,request_key,title,source,priority,deadline,objective,acceptance_criteria,related_entity_type,related_entity_id,target_data,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,requestKey,input.title,input.source,input.priority,input.deadline,input.objective,JSON.stringify(input.acceptanceCriteria),input.relatedEntityType,input.relatedEntityId,JSON.stringify(target),'OPEN',time,time);
    return reply.code(201).send(manualRow(store,store.db.prepare('SELECT * FROM manual_work_items WHERE id=?').get(id)!));
  });
  app.patch('/api/work-queue/manual/:id',async request=>{
    const id=z.object({id:uuid}).parse(request.params).id;
    const input=z.object({status:z.enum(['OPEN','IN_PROGRESS','COMPLETED','CANCELED'])}).strict().parse(request.body);
    const row=store.db.prepare('SELECT * FROM manual_work_items WHERE id=?').get(id);
    if(!row)throw new AppError('NOT_FOUND','任务不存在',404);
    if(['COMPLETED','CANCELED'].includes(String(row.status))&&input.status!==row.status)throw new AppError('TASK_FINAL','已结束任务不能重新打开',409);
    store.db.prepare('UPDATE manual_work_items SET status=?,updated_at=? WHERE id=?').run(input.status,now(),id);
    return manualRow(store,store.db.prepare('SELECT * FROM manual_work_items WHERE id=?').get(id)!);
  });
}
