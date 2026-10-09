import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { visualGuideInputSchema, guideTextViolations, type VisualGuide, type ReferenceVisualInput } from '../../packages/contracts/visual-guide.js';
import { AppError, type Store } from './store.js';
import { registerImageTypeGuides } from './image-type-guide.js';

const guideRow=(row:Record<string,unknown>):VisualGuide=>({id:String(row.id),categoryId:String(row.category_id),version:Number(row.version),status:row.status as VisualGuide['status'],data:JSON.parse(String(row.guide_data)),sources:JSON.parse(String(row.source_references)),createdAt:String(row.created_at),confirmedAt:row.confirmed_at?String(row.confirmed_at):null});
export function confirmedVisualGuide(store:Store,categoryId:string){
  const row=store.db.prepare("SELECT * FROM category_visual_guides WHERE category_id=? AND status='CONFIRMED'").get(categoryId);
  return row?guideRow(row):null;
}
export function visualCategoryForSku(store:Store,skuId:string):string|null{
  const row=store.db.prepare(`SELECT s.category_id FROM products p JOIN spus s ON s.id=p.spu_id WHERE p.id=?
    UNION ALL SELECT p.category_id FROM project_independent_skus i JOIN product_projects p ON p.id=i.project_id WHERE i.sku_id=? LIMIT 1`).get(skuId,skuId);
  return row?.category_id?String(row.category_id):null;
}
export function pageVisualInput(store:Store,artifactId:string|null):ReferenceVisualInput|null{
  if(!artifactId)return null;
  const row=store.db.prepare("SELECT validated_data FROM artifacts WHERE id=? AND kind='image'").get(artifactId);
  return row?JSON.parse(String(row.validated_data)).referenceInput??null:null;
}
export function visualChecklist(store:Store,artifactId:string|null){
  const input=pageVisualInput(store,artifactId);
  return input?[
    {code:'PRODUCT_IDENTITY',description:'商品瓶型、包装和标签与参考原图一致'},
    {code:'COPY_ACCURACY',description:'中文、商品名、规格及已确认文案逐项一致'},
    ...input.guide.data.prohibitions.filter(rule=>rule.checkMethod!=='TEXT'||rule.severity==='REVIEW').map(({code,description})=>({code,description})),
    ...(input.imageTypeGuide?.data.commonFailureModes??[]).map((description,index)=>({code:`IMAGE_TYPE_FAILURE_${index+1}`,description})),
    ...(input.imageTypeGuide?[{code:'IMAGE_TYPE_COMPOSITION',description:'图型必需元素、构图与禁用元素符合冻结指南'}]:[]),
  ]:[];
}
export function referencePageIssues(store:Store,page:import('../../packages/contracts/domain.js').DesignPage){
  if(page.visualMode!=='REFERENCE_IMAGE')return [];
  const input=pageVisualInput(store,page.visualArtifactId);
  if(!input)return ['参考图候选缺少可追溯输入'];
  const issues:string[]=[];
  if(['purpose','headline','subtitle','body'].some(key=>input.page[key as keyof typeof input.page]!==page[key as 'purpose'|'headline'|'subtitle'|'body'])||page.assetId!==input.referenceAssetId)issues.push('文案、用途或参考素材已改变，请重新生成完整候选');
  issues.push(...guideTextViolations(input.guide.data,page).filter(rule=>rule.severity==='BLOCK').map(rule=>`类目禁忌：${rule.description}`));
  return issues;
}
export function registerVisualGuides(app:FastifyInstance,store:Store){
  registerImageTypeGuides(app,store);
  app.get('/api/visual-guides',async request=>{
    const {categoryId}=z.object({categoryId:z.string().uuid().optional()}).parse(request.query);
    return store.db.prepare('SELECT * FROM category_visual_guides WHERE (? IS NULL OR category_id=?) ORDER BY created_at DESC,version DESC').all(categoryId??null,categoryId??null).map(guideRow);
  });
  app.post('/api/visual-guides',async(request,reply)=>{
    const input=visualGuideInputSchema.parse(request.body);
    if(!store.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId))throw new AppError('NOT_FOUND','类目不存在',404);
    const id=randomUUID();
    store.transaction(()=>{
      const version=Number(store.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM category_visual_guides WHERE category_id=?').get(input.categoryId)!.n);
      store.db.prepare("INSERT INTO category_visual_guides VALUES (?,?,?,'DRAFT',?,?,?,NULL)").run(id,input.categoryId,version,JSON.stringify(input.data),JSON.stringify(input.sources),new Date().toISOString());
    });
    return reply.code(201).send(guideRow(store.db.prepare('SELECT * FROM category_visual_guides WHERE id=?').get(id)!));
  });
  app.post('/api/visual-guides/:id/confirm',async request=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);
    z.object({confirm:z.literal(true)}).strict().parse(request.body);
    return store.transaction(()=>{
      const row=store.db.prepare('SELECT * FROM category_visual_guides WHERE id=?').get(id);
      if(!row)throw new AppError('NOT_FOUND','指南不存在',404);
      if(row.status==='CONFIRMED')return guideRow(row);
      if(row.status!=='DRAFT')throw new AppError('GUIDE_NOT_DRAFT','历史指南不能重新确认，请创建新版本',409);
      store.db.prepare("UPDATE category_visual_guides SET status='SUPERSEDED' WHERE category_id=? AND status='CONFIRMED'").run(String(row.category_id));
      store.db.prepare("UPDATE category_visual_guides SET status='CONFIRMED',confirmed_at=? WHERE id=?").run(new Date().toISOString(),id);
      return guideRow(store.db.prepare('SELECT * FROM category_visual_guides WHERE id=?').get(id)!);
    });
  });
  app.get('/api/products/:id/visual-guide',async request=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params);store.product(id);
    const categoryId=visualCategoryForSku(store,id);
    return {categoryId,guide:categoryId?confirmedVisualGuide(store,categoryId):null};
  });
  app.get('/api/kits/:id/pages/:pageId/visual-checklist',async request=>{
    const {id,pageId}=z.object({id:z.string().uuid(),pageId:z.string().uuid()}).parse(request.params);
    const kit=store.kit(id),page=kit.pages.find(item=>item.id===pageId);
    if(!page)throw new AppError('NOT_FOUND','页面不存在',404);
    return {checks:visualChecklist(store,page.visualArtifactId),issues:referencePageIssues(store,page)};
  });
}
