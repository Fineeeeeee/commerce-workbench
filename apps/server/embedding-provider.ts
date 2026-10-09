import { z } from 'zod';
import { AppError } from './store.js';
import { modelOverride } from './model-settings.js';

export type EmbeddingConfig={provider:'bailian';model:string;version:string;dimension:number;workspace:string};
export function embeddingConfig():EmbeddingConfig {
  const model=modelOverride('TEXT_EMBEDDING')||process.env.COMMERCE_TEXT_EMBEDDING_MODEL||'text-embedding-v4';
  if(!['text-embedding-v4','text-embedding-v3'].includes(model))throw new AppError('MODEL_CONFIGURATION_INVALID','当前向量适配器只支持 text-embedding-v3 / v4',409);
  const workspace=process.env.COMMERCE_BAILIAN_WORKSPACE_ID??'';
  return {provider:'bailian',model,version:process.env.COMMERCE_TEXT_EMBEDDING_VERSION?.trim()??'',dimension:512,workspace};
}
export type EmbeddingResult={vectors:number[][];requestId:string|null;latencyMs:number};
export type Embedder=(texts:string[],config:EmbeddingConfig)=>Promise<EmbeddingResult>;
export const requestEmbeddings:Embedder=async(texts,config)=>{
  if(!process.env.DASHSCOPE_API_KEY||!/^[-a-zA-Z0-9]{1,80}$/.test(config.workspace))throw new AppError('MODEL_NOT_CONFIGURED','历史检索的向量服务未连接',409);
  if(!texts.length||texts.length>10||texts.some(t=>!t.trim()||t.length>6000))throw new AppError('EMBEDDING_INPUT_INVALID','向量输入超过单次范围',409);
  const start=Date.now();let response:Response;
  try{response=await fetch(`https://${config.workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${process.env.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,input:texts,dimensions:config.dimension,encoding_format:'float'})});}
  catch{throw new AppError('RESULT_UNCERTAIN','向量请求结果无法确认，未自动重复调用',409);}
  if(!response.ok)throw new AppError(response.status===401?'PROVIDER_INVALID_KEY':response.status===403?'PROVIDER_MODEL_DENIED':response.status===429?'PROVIDER_RATE_LIMIT':'EMBEDDING_REJECTED',`历史检索向量请求未完成（HTTP ${response.status}），请检查模型权限或额度`,409);
  const schema=z.object({data:z.array(z.object({index:z.number().int().nonnegative(),embedding:z.array(z.number().finite()).length(config.dimension)})).length(texts.length)});
  const parsed=schema.safeParse(await response.json());
  if(!parsed.success||new Set(parsed.data.data.map(row=>row.index)).size!==texts.length||parsed.data.data.some(row=>row.index>=texts.length||row.embedding.every(v=>v===0)))throw new AppError('OUTPUT_INVALID','向量响应维度或顺序无效',409);
  return {vectors:parsed.data.data.sort((a,b)=>a.index-b.index).map(row=>row.embedding),requestId:response.headers.get('x-request-id'),latencyMs:Date.now()-start};
};
