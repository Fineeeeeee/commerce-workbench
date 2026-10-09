import { z } from 'zod';
import { visualGuideSourceSchema } from './visual-knowledge-source.js';
const text=z.string().trim().min(1).max(500);
export const editStrategySchema=z.enum(['PRESERVE_SUBJECT','RECOMPOSE_SCENE']);
export type EditStrategy=z.infer<typeof editStrategySchema>;
export const imageTypeDataSchema=z.object({
  purpose:text,cameraAngle:text,framing:text,lighting:text,backgroundRule:text,
  mustShow:z.array(text).min(1).max(12),mustNotShow:z.array(text).min(1).max(12),
  textOverlayRule:text,commonFailureModes:z.array(text).min(1).max(12),
  styleVariant:z.object({domestic:text,crossBorder:text}).strict(),
  sourceMapping:text,
}).strict();
export const imageTypeInputSchema=z.object({templateKey:z.string().min(1).max(100),slotId:z.string().regex(/^[FD]\d{2}$/),data:imageTypeDataSchema,sources:z.array(visualGuideSourceSchema).max(20)}).strict();
export type ImageTypeData=z.infer<typeof imageTypeDataSchema>;
export type ImageTypeGuide={id:string;templateKey:string;slotId:string;version:number;status:'DRAFT'|'CONFIRMED'|'SUPERSEDED';data:ImageTypeData;sources:z.infer<typeof visualGuideSourceSchema>[];createdAt:string;confirmedAt:string|null};
export function imageTypeBranch(channel:string):'domestic'|'crossBorder'{
  if(['taobao','jd'].includes(channel))return 'domestic';
  throw new Error('当前渠道未配置正式图型生成能力');
}
export const editStrategies:Record<EditStrategy,string>={
  PRESERVE_SUBJECT:'保留商品主体的位置、视角、比例、包装和标签，仅整理周边背景与信息区。',
  RECOMPOSE_SCENE:'允许重构商品周边场景和构图，但必须保持商品瓶型、包装、标签及数量；不得重新设计商品。',
};
