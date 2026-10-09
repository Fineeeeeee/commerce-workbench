import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import { AppError, type Store } from './store.js';
import { configuredModel } from './model-capabilities.js';
import { renderSvg } from '../../packages/contracts/render.js';
import { transparentSubjectData } from './media.js';
import { visualChecklist } from './visual-guide.js';
import { artifactImageData } from './image-service.js';
import { deliveryPageIssues } from './content-service.js';

export type VisualObjectType = 'BACKGROUND_ASSET' | 'FINAL_COMPOSITE';
export function inspectionInstruction(type:VisualObjectType){
  return type==='BACKGROUND_ASSET'
    ? '第二张是背景素材，不是最终商品页。不要因缺少瓶子或商品中文判失败。检查是否出现不应存在的瓶子、包装、文字、水印、多余对象，以及是否符合背景 Brief 和留白。subjectConsistent 表示背景没有重绘或额外商品，chineseReadable 表示没有不应出现的文字。'
    : '第二张是最终商品页（程序合成或参考图生成）。与第一张原始商品图逐项对照：瓶型、泵头、标签和包装是否变化，中文是否失真、多余对象、名称规格及已确认文案是否一致、布局是否符合 Brief。无法看清时指出需要人工核验，不得凭印象认可。';
}
export function finalCompositeIssues(store:Store,kitId:string,pageId:string){
  const kit=store.kit(kitId),page=kit.pages.find(p=>p.id===pageId);
  if(!page)throw new AppError('NOT_FOUND','页面不存在',404);
  const product=store.product(kit.productId,kit.productVersion);
  const issues=deliveryPageIssues(store,kit,page);
  return {kit,page,product,issues};
}

const outputSchema=z.object({subjectConsistent:z.boolean(),chineseReadable:z.boolean(),extraObjects:z.boolean(),briefAligned:z.boolean(),notes:z.array(z.string().trim().min(1).max(300)).max(8)}).strict();
const responseSchema=z.object({id:z.string(),model:z.string(),choices:z.array(z.object({message:z.object({content:z.string()}),finish_reason:z.string()})).length(1)});
export async function imageAt(store:Store,path:string){
  const root=realpathSync(store.directory),target=realpathSync(resolve(store.directory,path));
  if(!target.startsWith(root+sep))throw new AppError('INVALID_IMAGE_REFERENCE','图片引用超出工作区',409);
  const bytes=readFileSync(target);
  const png=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a';
  const jpeg=bytes.subarray(0,3).toString('hex')==='ffd8ff';
  if(bytes.length>8_000_000||(!png&&!jpeg))throw new AppError('INVALID_IMAGE','只允许检查已保存的 JPG 或 PNG 图片',409);
  try {
    const normalized=png?await sharp(bytes,{failOn:'none'}).png().toBuffer():await sharp(bytes,{failOn:'none'}).jpeg().toBuffer();
    return `data:image/${png?'png':'jpeg'};base64,${normalized.toString('base64')}`;
  } catch {
    throw new AppError('INVALID_IMAGE','只允许检查可解码的 JPG 或 PNG 图片',409);
  }
}
export function registerVisionInspection(app:FastifyInstance,store:Store){
  app.post('/api/artifacts/:id/vision-inspection',async(request,reply)=>{
    const artifactId=z.object({id:z.string().uuid()}).parse(request.params).id;
    const input=z.object({assetId:z.string().uuid(),brief:z.string().trim().min(1).max(600),model:z.string().trim().min(1).max(120).optional(),objectType:z.enum(['BACKGROUND_ASSET','FINAL_COMPOSITE']).default('BACKGROUND_ASSET'),kitId:z.string().uuid().optional(),pageId:z.string().uuid().optional(),kitVersion:z.number().int().positive().optional()}).strict().parse(request.body);
    const row=store.db.prepare(`SELECT a.relative_path,a.mime,j.product_id FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE a.id=? AND a.kind='image' AND t.state='succeeded'`).get(artifactId);
    const asset=store.db.prepare('SELECT path,product_id FROM assets WHERE id=?').get(input.assetId);
    if(!row||row.mime!=='image/png'||!row.relative_path||!asset||row.product_id!==asset.product_id)throw new AppError('IMAGE_OWNERSHIP','候选图与商品原图必须属于同一 SKU',409);
    const original=await imageAt(store,String(asset.path));
    let candidate:string;
    let finalContext:unknown=null;
    if(input.objectType==='FINAL_COMPOSITE'){
      if(!input.kitId||!input.pageId||!input.kitVersion)throw new AppError('FINAL_CONTEXT_REQUIRED','最终页检查需要明确内容方案、页面和版本',400);
      const result=finalCompositeIssues(store,input.kitId,input.pageId);
      if(result.kit.version!==input.kitVersion)throw new AppError('VERSION_CONFLICT','页面已更新，请检查当前版本',409);
      if(result.kit.productId!==row.product_id||result.page.assetId!==input.assetId||result.page.visualArtifactId!==artifactId)throw new AppError('IMAGE_OWNERSHIP','最终页必须使用该商品原图和已采用候选',409);
      if(result.issues.length)throw new AppError('FINAL_NOT_READY',result.issues.join('；'),409);
      const svg=renderSvg(result.page,result.product,await transparentSubjectData(store,input.assetId),await artifactImageData(store,artifactId));
      candidate=`data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')}`;
      finalContext={name:result.product.name,specification:result.product.specification,headline:result.page.headline,subtitle:result.page.subtitle,body:result.page.body};
    }else candidate=await imageAt(store,String(row.relative_path));
    if(input.objectType==='BACKGROUND_ASSET'&&visualChecklist(store,artifactId).length)throw new AppError('VISUAL_TYPE_MISMATCH','这是完整参考图候选，请采用后按最终商品页检查',409);
    const guideChecks=visualChecklist(store,artifactId);
    const config=configuredModel('VISION_INSPECT',input.model),workspace=process.env.COMMERCE_BAILIAN_WORKSPACE_ID;
    if(!process.env.DASHSCOPE_API_KEY||!workspace||!/^[a-zA-Z0-9-]{1,80}$/.test(workspace))throw new AppError('MODEL_NOT_CONFIGURED','视觉检查服务未连接',409);
    const runId=randomUUID(),time=new Date().toISOString(),started=Date.now(),payload={artifactId,...input,finalContext};
    const save=(status:string,output:unknown,version:string|null,errorCode:string|null)=>store.db.prepare(`INSERT INTO ai_inference_runs
      (id,task_type,capability,subject_type,subject_id,provider,model,model_version,input_fingerprint,input_data,output_data,status,latency_ms,error_code,human_evaluation,adopted_at,created_at)
      VALUES (@id,'vision_inspection','VISION_INSPECT','artifact',@artifact,'bailian',@model,@version,@hash,@input,@output,@status,@latency,@error,NULL,NULL,@created)`).run({id:runId,artifact:artifactId,model:config.model,version,hash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),input:JSON.stringify(payload),output:output===null?null:JSON.stringify(output),status,latency:Date.now()-started,error:errorCode,created:time});
    try{
      const response=await fetch(`https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{Authorization:`Bearer ${process.env.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:[{role:'system',content:'比较商品原图和视觉候选。第一张是商品原图，第二张是候选图。只评价主体一致性、中文可读性、多余对象和 Brief 符合度。你的结果仅供人工参考，输出 JSON 对象，字段 subjectConsistent/chineseReadable/extraObjects/briefAligned 为布尔值，notes 为短句数组。'+inspectionInstruction(input.objectType)},{role:'user',content:[{type:'text',text:JSON.stringify({brief:input.brief,finalContext,guideChecks})},{type:'image_url',image_url:{url:original}},{type:'image_url',image_url:{url:candidate}}]}],response_format:{type:'json_object'},temperature:0.1,max_tokens:800})});
      if(!response.ok)throw new AppError('PROVIDER_REJECTED',`视觉检查请求未完成（HTTP ${response.status}）`,409);
      const parsed=responseSchema.parse(await response.json());
      if(parsed.choices[0]!.finish_reason!=='stop')throw new AppError('OUTPUT_TRUNCATED','视觉检查返回不完整',409);
      const output=outputSchema.parse(JSON.parse(parsed.choices[0]!.message.content));
      save('SUCCEEDED',output,parsed.model,null);
      return reply.code(201).send({runId,model:config.model,modelVersion:parsed.model,output,notice:'多模态模型的 JSON Schema 约束不会生效；程序已校验结构，结论仍需人工审核。'});
    }catch(error){const code=error instanceof AppError?error.code:'VISION_INSPECTION_FAILED';save(code==='RESULT_UNCERTAIN'?'UNCERTAIN':'FAILED',null,null,code);if(error instanceof AppError)throw error;throw new AppError(code,'视觉检查未完成，未产生可采用结果',409);}
  });
}
