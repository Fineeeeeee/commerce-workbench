import { z } from 'zod';
import type { DesignPage } from './domain.js';
import { templateById, type Fact } from './content-template.js';
import { editStrategies,imageTypeBranch,type ImageTypeGuide,type EditStrategy } from './image-type-guide.js';
import { visualGuideSourceSchema } from './visual-knowledge-source.js';
export { visualGuideSourceSchema } from './visual-knowledge-source.js';

const text = (max: number) => z.string().trim().min(1).max(max);
export const visualProhibitionSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/), description: text(300),
  severity: z.enum(['BLOCK','REVIEW']), checkMethod: z.enum(['TEXT','VISION','HUMAN']),
  terms: z.array(text(80)).max(30),
}).strict().refine(rule => rule.checkMethod !== 'TEXT' || rule.terms.length > 0, '文字规则需要明确匹配词');
export const visualGuideDataSchema = z.object({
  name: text(100), style: text(1000), identityConstraints: z.array(text(300)).min(1).max(15),
  channels: z.array(text(40)).min(1).max(8),
  imageTypes: z.array(z.object({ pageIds: z.array(z.string().regex(/^[FD]\d{2}$/)).min(1).max(25), composition: text(1000) }).strict()).min(1).max(25),
  prohibitions: z.array(visualProhibitionSchema).max(30),
}).strict().superRefine((data,ctx) => {
  const pages=data.imageTypes.flatMap(item=>item.pageIds);
  if(new Set(pages).size!==pages.length)ctx.addIssue({code:'custom',message:'图型不能重复覆盖同一页'});
  if(new Set(data.prohibitions.map(rule=>rule.code)).size!==data.prohibitions.length)ctx.addIssue({code:'custom',message:'禁忌项 code 不得重复'});
  if(data.prohibitions.some(rule=>['PRODUCT_IDENTITY','COPY_ACCURACY'].includes(rule.code)))ctx.addIssue({code:'custom',message:'禁忌项 code 与基础检查项冲突'});
});
export const visualGuideInputSchema=z.object({categoryId:z.string().uuid(),data:visualGuideDataSchema,sources:z.array(visualGuideSourceSchema).max(20)}).strict();
export type VisualGuideData=z.infer<typeof visualGuideDataSchema>;
export type VisualGuideSource=z.infer<typeof visualGuideSourceSchema>;
export type VisualGuide={id:string;categoryId:string;version:number;status:'DRAFT'|'CONFIRMED'|'SUPERSEDED';data:VisualGuideData;sources:VisualGuideSource[];createdAt:string;confirmedAt:string|null};
export type ReferenceVisualInput={engine:'REFERENCE_IMAGE';guide:VisualGuide;imageTypeGuide?:ImageTypeGuide;editPolicy?:{strategy:EditStrategy;enforcement:'PROMPT_ONLY';requestedChanges:string;preserveConstraints:string[]};channelBranch?:'domestic'|'crossBorder';seed?:number;referenceAssetId:string;referenceHash:string;facts:Array<Pick<Fact,'id'|'type'|'value'>>;page:{purpose:string;headline:string;subtitle:string;body:string;composition:string};prompt:string};

export function assembleReferencePrompt(guide:VisualGuide,page:DesignPage,facts:Fact[],assetId:string,assetHash:string,options?:{imageTypeGuide:ImageTypeGuide;strategy:EditStrategy;channel:string;seed?:number}):ReferenceVisualInput {
  if(guide.status!=='CONFIRMED')throw new Error('指南尚未确认');
  const type=guide.data.imageTypes.find(item=>item.pageIds.includes(page.templateId??''));
  if(!type)throw new Error('当前页面未配置图型');
  const requiredTypes=new Set(['product_name','brand','spec',...(templateById(page.templateId)?.requiredFactTypes??[]).map(item=>item.split(':')[0])]);
  const confirmed=facts.filter(fact=>fact.confirmed&&fact.type!=='asset'&&(requiredTypes.has(fact.type)||page.sourceFactIds.includes(fact.id))).map(({id,type,value})=>({id,type,value}));
  if(options&&(options.imageTypeGuide.status!=='CONFIRMED'||options.imageTypeGuide.slotId!==page.templateId))throw new Error('图型指南未确认或槽位不匹配');
  const imageType=options?.imageTypeGuide.data,branch=options?imageTypeBranch(options.channel):undefined;
  const pageInput={purpose:page.purpose,headline:page.headline,subtitle:page.subtitle,body:page.body,composition:imageType?.framing??type.composition};
  const imageRules=imageType?`图型：${imageType.purpose}；${imageType.cameraAngle}；${imageType.framing}；${imageType.lighting}；${imageType.backgroundRule}；${imageType.textOverlayRule}；${imageType.styleVariant[branch!]}`:'';
  const editPolicy=options?{strategy:options.strategy,enforcement:'PROMPT_ONLY' as const,requestedChanges:editStrategies[options.strategy],preserveConstraints:['瓶型','泵头','包装标签','数量','已确认文字']}:undefined;
  const prompt=[
    '参考图为唯一商品身份。保留瓶型与包装标签，不增加商品；约束冲突时不得补造事实。',
    '商品事实优先\n'+confirmed.map(fact=>`${({product_name:'品名',brand:'品牌',spec:'规格',selling_point:'卖点'} as Record<string,string>)[fact.type]??fact.type}：${fact.value}`).join('；'),
    '类目规则\n'+[guide.data.style,...guide.data.identityConstraints,...guide.data.prohibitions.map(rule=>rule.description)].join('；'),
    ...(imageType?[imageRules,`必须：${imageType.mustShow.join('、')}；禁止：${imageType.mustNotShow.join('、')}`]:[]),
    ...(editPolicy?[`编辑策略：${editPolicy.requestedChanges}`]:[]),
    '页面文案\n'+Object.entries(pageInput).filter(([key])=>!imageType||key!=='composition').map(([key,value])=>`${key}：${value}`).join('\n'),
    `输出${page.kind==='main'?'1:1':'3:4'}完整图。中文逐字正确，不添加未经确认的功效、认证、价格或促销。`,
  ].join('\n\n');
  return {engine:'REFERENCE_IMAGE',guide,...(options?{imageTypeGuide:options.imageTypeGuide,editPolicy,channelBranch:branch,seed:options.seed}:{}),referenceAssetId:assetId,referenceHash:assetHash,facts:confirmed,page:pageInput,prompt};
}

export function guideTextViolations(data:VisualGuideData,page:DesignPage){
  const content=[page.headline,page.subtitle,page.body].join('\n');
  return data.prohibitions.filter(rule=>rule.checkMethod==='TEXT'&&rule.terms.some(term=>content.includes(term)));
}
