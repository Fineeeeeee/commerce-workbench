import type { DesignPage, ProductInput } from './domain.js';

export type Fact = { id: string; type: string; label: string; value: string; source: string; confirmed: true };
export type TemplateState = 'READY'|'MISSING_DATA'|'GENERATING'|'GENERATED'|'REVIEWED'|'FAILED';
export type GenerationMode = 'fixed'|'creative'|'evidence';
export type TemplateDefinition = {
  id: string; kind: 'main'|'detail'; name: string; purpose: string; generationMode: GenerationMode;
  requiredFactTypes: string[]; optionalFactTypes: string[]; layoutSlots: Record<string, { maxChars: number; maxLines: number }>;
};

const slots = (headline = 10, subtitle = 18, body = 72) => ({ headline: { maxChars: headline, maxLines: 2 }, subtitle: { maxChars: subtitle, maxLines: 2 }, body: { maxChars: body, maxLines: 6 } });
export const taobaoDailyCarePages: TemplateDefinition[] = [
  { id:'F01',kind:'main',name:'主视觉首图',purpose:'主视觉首图',generationMode:'fixed',requiredFactTypes:['product_name','brand','spec','selling_point','asset'],optionalFactTypes:['fragrance'],layoutSlots:{...slots(10,18,30),sellingPoint:{maxChars:6,maxLines:1},spec:{maxChars:20,maxLines:1}} },
  { id:'F02',kind:'main',name:'四卖点页',purpose:'四卖点页',generationMode:'fixed',requiredFactTypes:['product_name','selling_point:4','asset'],optionalFactTypes:[],layoutSlots:{...slots(10,18,96),keyword:{maxChars:6,maxLines:1},description:{maxChars:18,maxLines:2}} },
  { id:'F03',kind:'main',name:'成分 / 产品机理页',purpose:'成分 / 产品机理页',generationMode:'creative',requiredFactTypes:['ingredient','selling_point','asset'],optionalFactTypes:[],layoutSlots:slots(10,18,100) },
  { id:'F04',kind:'main',name:'香氛情绪页',purpose:'香氛情绪页',generationMode:'creative',requiredFactTypes:['top_notes','middle_notes','base_notes','asset'],optionalFactTypes:['fragrance'],layoutSlots:slots(10,18,100) },
  { id:'F05',kind:'main',name:'凭证 / 清单页',purpose:'凭证 / 清单页',generationMode:'evidence',requiredFactTypes:['credential','credential_number','evidence_list:8','asset'],optionalFactTypes:[],layoutSlots:slots(10,18,120) },
  { id:'D01',kind:'detail',name:'产品总览',purpose:'产品总览',generationMode:'fixed',requiredFactTypes:['product_name','brand','spec','selling_point','asset'],optionalFactTypes:['fragrance'],layoutSlots:slots(12,22,100) },
  { id:'D02',kind:'detail',name:'用户痛点 / 使用需求',purpose:'用户痛点 / 使用需求',generationMode:'fixed',requiredFactTypes:['audience','selling_point','asset'],optionalFactTypes:[],layoutSlots:slots(12,22,120) },
  { id:'D03',kind:'detail',name:'核心卖点总览',purpose:'核心卖点总览',generationMode:'fixed',requiredFactTypes:['selling_point:4','asset'],optionalFactTypes:[],layoutSlots:{...slots(12,22,120),keyword:{maxChars:6,maxLines:1},description:{maxChars:18,maxLines:2}} },
  { id:'D04',kind:'detail',name:'卖点展开 1',purpose:'卖点展开 1',generationMode:'fixed',requiredFactTypes:['selling_point','asset'],optionalFactTypes:['ingredient'],layoutSlots:slots(12,22,140) },
  { id:'D05',kind:'detail',name:'卖点展开 2',purpose:'卖点展开 2',generationMode:'fixed',requiredFactTypes:['selling_point:2','asset'],optionalFactTypes:['ingredient'],layoutSlots:slots(12,22,140) },
  { id:'D06',kind:'detail',name:'成分 / 配方页',purpose:'成分 / 配方页',generationMode:'creative',requiredFactTypes:['ingredient','asset'],optionalFactTypes:['formula_type'],layoutSlots:slots(12,22,140) },
  { id:'D07',kind:'detail',name:'香氛体验页',purpose:'香氛体验页',generationMode:'creative',requiredFactTypes:['fragrance','asset'],optionalFactTypes:['top_notes','middle_notes','base_notes'],layoutSlots:slots(12,22,140) },
  { id:'D08',kind:'detail',name:'使用体验 / 场景页',purpose:'使用体验 / 场景页',generationMode:'creative',requiredFactTypes:['audience','selling_point','asset'],optionalFactTypes:[],layoutSlots:slots(12,22,140) },
  { id:'D09',kind:'detail',name:'使用方法页',purpose:'使用方法页',generationMode:'fixed',requiredFactTypes:['usage','asset'],optionalFactTypes:[],layoutSlots:{...slots(12,22,150),step:{maxChars:36,maxLines:2}} },
  { id:'D10',kind:'detail',name:'规格参数页',purpose:'规格参数页',generationMode:'fixed',requiredFactTypes:['product_name','brand','spec','origin','asset'],optionalFactTypes:['fragrance'],layoutSlots:slots(12,22,150) },
  { id:'D11',kind:'detail',name:'品牌 / 产品信息页',purpose:'品牌 / 产品信息页',generationMode:'fixed',requiredFactTypes:['product_name','brand','asset'],optionalFactTypes:['origin'],layoutSlots:slots(12,22,150) },
  { id:'D12',kind:'detail',name:'收尾 / 购买引导页',purpose:'收尾 / 购买引导页',generationMode:'fixed',requiredFactTypes:['product_name','brand','spec','asset'],optionalFactTypes:['selling_point'],layoutSlots:slots(12,22,100) },
];

export const templateById = (id: string | undefined) => taobaoDailyCarePages.find(item => item.id === id);
export function hydrateTemplatePages(pages: DesignPage[]): DesignPage[] {
  return pages.map((page,index) => {
    const definition = taobaoDailyCarePages[index];
    return { ...page, templateId: page.templateId ?? definition?.id, generationMode: page.generationMode ?? definition?.generationMode, copyStatus: page.copyStatus ?? 'draft', sourceFactIds: page.sourceFactIds ?? [] };
  });
}
export function productFacts(product: ProductInput, page?: Pick<DesignPage,'assetId'>, spu?: { positioning?: string; targetAudience?: string; coreClaims?: string[]; dynamicAttributes?: Record<string,string|string[]>; categoryCode?: string } | null): Fact[] {
  const facts: Fact[] = [];
  const add = (id: string, type: string, label: string, value: unknown, source: string) => { if (typeof value === 'string' && value.trim()) facts.push({ id, type, label, value: value.trim(), source, confirmed: true }); };
  add('product.name','product_name','产品名',product.name,'SKU'); add('product.brand','brand','品牌',product.brand,'SPU/SKU'); add('product.specification','spec','规格',product.specification,'SKU');
  add('product.audience','audience','适用对象',spu?.targetAudience || product.audience,'SPU'); add('product.origin','origin','产地',product.origin,'SKU'); add('spu.positioning','positioning','产品定位',spu?.positioning,'SPU');
  const attrs = spu?.dynamicAttributes ?? {};
  const values = (key: string) => { const value = attrs[key]; return Array.isArray(value) ? value : typeof value === 'string' ? [value] : []; };
  for (const [i,value] of values('ingredients').entries()) add(`spu.ingredients.${i}`,'ingredient','主要成分',value,'SPU类目属性');
  add('spu.fragrance','fragrance','香型',values('fragrance')[0] || product.variant,'SPU类目属性'); add('spu.formulaType','formula_type','配方类型',values('formulaType')[0],'SPU类目属性');
  add('spu.topNotes','top_notes','前调',values('topNotes')[0],'SPU类目属性'); add('spu.middleNotes','middle_notes','中调',values('middleNotes')[0],'SPU类目属性'); add('spu.baseNotes','base_notes','后调',values('baseNotes')[0],'SPU类目属性');
  const approved = product.claims.filter(item => item.status === 'approved');
  approved.forEach((item,i) => add(`claim.${item.id}`,'selling_point',item.label,item.text,item.source || '已确认卖点'));
  (spu?.coreClaims ?? []).filter(label => !approved.some(item => item.label === label)).forEach((value,i) => add(`spu.claim.${i}`,'selling_point','核心卖点',value,'SPU'));
  const usage = product.notes.match(/(?:使用方法|用法)[：:]?\s*([^。\n]{2,180})/i)?.[1]; add('product.usage','usage','使用方法',usage,'商品资料');
  if (!usage && spu?.categoryCode === 'shampoo') add('category.shampoo.usage','usage','类目使用方法','充分湿润头发后，取适量洗发水涂抹于头发，轻柔按摩起泡，再用清水冲洗干净。','洗发水类目使用模板');
  if (page?.assetId) add(`asset.${page.assetId}`,'asset','原始商品素材',page.assetId,'素材库');
  return facts;
}

export function missingFields(definition: TemplateDefinition, facts: Fact[]) {
  return definition.requiredFactTypes.filter(requirement => {
    const [type,countText] = requirement.split(':'); const count = Number(countText || 1);
    return facts.filter(fact => fact.type === type).length < count;
  });
}
export const missingFieldLabel = (field: string) => ({ product_name:'产品名',brand:'品牌',spec:'规格',selling_point:'已确认卖点',ingredient:'真实成分',asset:'原始商品素材',audience:'适用对象',origin:'产地',usage:'使用方法',fragrance:'真实香型',top_notes:'真实前调',middle_notes:'真实中调',base_notes:'真实后调',credential:'真实凭证',credential_number:'真实凭证编号',evidence_list:'真实清单' } as Record<string,string>)[field.split(':')[0]!] ?? field;
