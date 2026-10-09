import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError,type Store } from './store.js';
import { imageTypeInputSchema,type ImageTypeGuide } from '../../packages/contracts/image-type-guide.js';
import { imageTypeDrafts,imageTypeTemplateKey } from '../../packages/contracts/image-type-catalog.js';
const rowGuide=(row:Record<string,unknown>):ImageTypeGuide=>({id:String(row.id),templateKey:String(row.template_key),slotId:String(row.slot_id),version:Number(row.version),status:row.status as ImageTypeGuide['status'],data:JSON.parse(String(row.guide_data)),sources:JSON.parse(String(row.source_references)),createdAt:String(row.created_at),confirmedAt:row.confirmed_at?String(row.confirmed_at):null});
export function confirmedImageType(store:Store,slot:string){const row=store.db.prepare("SELECT * FROM image_type_guides WHERE template_key=? AND slot_id=? AND status='CONFIRMED'").get(imageTypeTemplateKey,slot);return row?rowGuide(row):null;}
function draft(store:Store,input:z.infer<typeof imageTypeInputSchema>){
  if(input.templateKey!==imageTypeTemplateKey||!imageTypeDrafts.some(item=>item.slotId===input.slotId))throw new AppError('INVALID_TEMPLATE','当前仅支持已有17个模板槽位',409);
  const id=randomUUID(),version=Number(store.db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM image_type_guides WHERE template_key=? AND slot_id=?').get(input.templateKey,input.slotId)!.n);
  store.db.prepare("INSERT INTO image_type_guides VALUES (?,?,?,?,'DRAFT',?,?,?,NULL)").run(id,input.templateKey,input.slotId,version,JSON.stringify(input.data),JSON.stringify(input.sources),new Date().toISOString());
  return rowGuide(store.db.prepare('SELECT * FROM image_type_guides WHERE id=?').get(id)!);
}
export function registerImageTypeGuides(app:FastifyInstance,store:Store){
  app.get('/api/image-type-guides',async()=>store.db.prepare('SELECT * FROM image_type_guides ORDER BY slot_id,version DESC').all().map(rowGuide));
  app.post('/api/image-type-guides',async(request,reply)=>{const input=imageTypeInputSchema.parse(request.body);return reply.code(201).send(store.transaction(()=>draft(store,input)));});
  app.post('/api/image-type-guides/prepare-drafts',async request=>{
    z.object({confirmDraftPreparation:z.literal(true)}).strict().parse(request.body);
    return store.transaction(()=>imageTypeDrafts.map(input=>{
      const existing=store.db.prepare('SELECT * FROM image_type_guides WHERE template_key=? AND slot_id=? ORDER BY version DESC LIMIT 1').get(input.templateKey,input.slotId);
      return existing?rowGuide(existing):draft(store,imageTypeInputSchema.parse(input));
    }));
  });
  app.post('/api/image-type-guides/:id/confirm',async request=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);z.object({confirm:z.literal(true)}).strict().parse(request.body);
    return store.transaction(()=>{
      const row=store.db.prepare('SELECT * FROM image_type_guides WHERE id=?').get(id);
      if(!row)throw new AppError('NOT_FOUND','图型指南不存在',404);
      if(row.status==='CONFIRMED')return rowGuide(row);
      if(row.status!=='DRAFT')throw new AppError('GUIDE_NOT_DRAFT','历史图型指南不能重新启用',409);
      store.db.prepare("UPDATE image_type_guides SET status='SUPERSEDED' WHERE template_key=? AND slot_id=? AND status='CONFIRMED'").run(String(row.template_key),String(row.slot_id));
      store.db.prepare("UPDATE image_type_guides SET status='CONFIRMED',confirmed_at=? WHERE id=?").run(new Date().toISOString(),id);
      return rowGuide(store.db.prepare('SELECT * FROM image_type_guides WHERE id=?').get(id)!);
    });
  });
}
