import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { selectableImageModels } from '../../packages/contracts/image.js';
import { AppError } from './store.js';

export const modelSettingKeys = ['TEXT_FAST','TEXT_REASONING','PRODUCT_BRIEF','SEO_REASONING','COPY_GENERATION','VISION_INSPECT','IMAGE_GENERATION','SYSTEM_REASONING','TEXT_EMBEDDING'] as const;
export type ModelSettingKey = typeof modelSettingKeys[number];
const modelId = z.string().trim().regex(/^[a-zA-Z0-9._-]{1,120}$/);
const settingsSchema = z.object(Object.fromEntries(modelSettingKeys.map(key=>[key,modelId.optional()]))).strict();
export function readModelSettings(directory=resolve('.runtime')): Partial<Record<ModelSettingKey,string>> {
  const path=join(directory,'model-settings.json');
  if(!existsSync(path))return {};
  try{return settingsSchema.parse(JSON.parse(readFileSync(path,'utf8')));}catch{throw new AppError('MODEL_CONFIGURATION_INVALID','模型设置文件无效，请检查设置',409);}
}
export function modelOverride(key:ModelSettingKey){return readModelSettings()[key];}
export function saveModelSetting(key:ModelSettingKey,model:string|null,directory=resolve('.runtime')){
  if(!modelSettingKeys.includes(key))throw new AppError('MODEL_CONFIGURATION_INVALID','未知模型功能');
  const value=model===null?null:modelId.parse(model);
  if(key==='IMAGE_GENERATION'&&value&&!selectableImageModels.includes(value as typeof selectableImageModels[number]))throw new AppError('MODEL_CONFIGURATION_INVALID','该生图模型尚无可用适配器，请选择已支持的模型',409);
  if(key==='TEXT_EMBEDDING'&&value&&!['text-embedding-v3','text-embedding-v4'].includes(value))throw new AppError('MODEL_CONFIGURATION_INVALID','该向量模型尚无可用适配器，请选择 text-embedding-v3 / v4',409);
  const next=readModelSettings(directory);
  if(value===null)delete next[key];else next[key]=value;
  mkdirSync(directory,{recursive:true});
  const path=join(directory,'model-settings.json'), temporary=join(directory,'model-settings.pending.json');
  writeFileSync(temporary,JSON.stringify(next,null,2),'utf8');renameSync(temporary,path);
  return next;
}
