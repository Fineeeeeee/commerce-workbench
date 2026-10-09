import { z } from 'zod';
import type { Entry, MarketAnalysis } from './market.js';

const id = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);

export const opportunityPreviewInputSchema = z.object({
  batchId: id,
  entryIds: z.array(id).min(1).max(100).refine(value => new Set(value).size === value.length, '竞品记录不能重复'),
}).strict();

export const opportunityKeywordSchema = z.object({
  term: text(30).min(1),
  sourceEntryIds: z.array(id).min(1).max(100),
}).strict();

export const opportunityInputSchema = opportunityPreviewInputSchema.extend({
  categoryId: id.nullable(),
  title: text(160).min(1),
  summary: text(2000).min(1),
  status: z.enum(['DRAFT','READY','REJECTED']),
  keywords: z.array(opportunityKeywordSchema).min(1).max(30),
  replicability: z.enum(['HIGH','MEDIUM','LOW','UNKNOWN']),
  replicabilityReason: text(2000),
  risks: z.array(text(500).min(1)).max(20),
  missingEvidence: z.array(text(200).min(1)).max(30),
}).strict();

export const opportunityProjectInputSchema = z.object({
  name: text(120).min(1),
  scope: text(1000).min(1),
  categoryId: id.optional(),
  projectType: z.enum(['NEW_PRODUCT', 'EXISTING_PRODUCT']),
}).strict();

export type OpportunityKeyword = z.infer<typeof opportunityKeywordSchema>;
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;
export type OpportunityProjectCreation = { projectId: string; opportunityId: string; evidenceId: string; batchId: string; created: boolean };
export type OpportunityEntry = Entry & { analysis: MarketAnalysis };
export type OpportunityPreview = {
  batch: { id: string; name: string; source: string; platform: string; periodStart: string; periodEnd: string; metricName: string; metricUnit: string };
  included: OpportunityEntry[];
  excluded: Array<OpportunityEntry & { exclusionReason: string }>;
  keywords: Array<OpportunityKeyword & { score: number; coverage: number }>;
  stats: {
    selectedCount: number; includedCount: number; excludedCount: number;
    brands: Array<{ value: string; count: number }>;
    shops: Array<{ value: string; count: number }>;
    specifications: Array<{ value: string; count: number }>;
    price: { minimum: number; median: number; maximum: number } | null;
    priceBands: Array<{ label: string; minimum: number | null; maximum: number | null; count: number }>;
    sellingPoints: Array<{ term: string; count: number; sourceEntryIds: string[] }>;
    sellingPointCombinations: Array<{ terms: string[]; count: number; sourceEntryIds: string[] }>;
    missingRates: Array<{ field: string; missing: number; total: number; rate: number }>;
  };
  missingEvidence: string[];
  algorithmVersion: 'market-opportunity-v1';
};

export type ProductOpportunity = {
  id: string; evidenceId: string; categoryId: string | null; title: string;
  status: OpportunityInput['status']; summary: string; keywords: OpportunityKeyword[];
  analysis: OpportunityPreview & Pick<OpportunityInput, 'replicability'|'replicabilityReason'|'risks'|'missingEvidence'> & {
    ai?: import('./market-ai.js').MarketAiAnalysis;
    textSignals?: import('./market-ai.js').MarketTextSignals;
    modelMetadata?: import('./market-ai.js').MarketAiMetadata;
    historyRetrieval?: import("./market-learning.js").HistoryRetrieval;
    review?: { reasonCodes?: string[]; reviewer: string; note: string; decision: 'APPROVED'|'REJECTED'; reviewedAt: string };
  };
  linkedProjectCount: number;
  linkedProjects: Array<{ id: string; name: string; status: 'DRAFT'|'EVALUATING'|'APPROVED'|'DEVELOPING'|'READY'|'LAUNCHED'|'CLOSED' }>;
  createdAt: string; updatedAt: string;
};

const noise = new Set(['官方','旗舰','正品','新品','新款','升级','同款','包邮','促销','直播','推荐','热卖','爆款','到手','拍下','赠品','洗发水','沐浴露','护发素','套装','单瓶']);
function phrases(value: string): string[] {
  return value.split(/[\s,，、|｜/\\+·;；:：()（）【】\[\]_-]+/).map(item => item.trim()).filter(Boolean);
}
function terms(value: string): string[] {
  const result = new Set<string>();
  for (const phrase of phrases(value)) {
    const cleaned = phrase.replace(/\d+(?:\.\d+)?(?:ml|g|kg|毫升|克)?/gi, '').replace(/官方|旗舰店|专卖店|正品|新品|新款|升级|同款|包邮|促销|直播|推荐|热卖|爆款|到手|拍下|赠品/g, '').trim();
    if (cleaned.length >= 2 && cleaned.length <= 8 && !noise.has(cleaned)) result.add(cleaned);
    if (cleaned.length > 8) for (let size = 2; size <= 4; size++) for (let i = 0; i + size <= cleaned.length; i++) {
      const term = cleaned.slice(i, i + size); if (!noise.has(term)) result.add(term);
    }
  }
  return [...result];
}
function distribution(values: string[]) {
  const counts = new Map<string,number>();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].map(([value,count]) => ({ value,count })).sort((a,b) => b.count-a.count || a.value.localeCompare(b.value,'zh-CN'));
}

export const sellingPointGroups = [
  ['控油', ['控油', '油脂']], ['蓬松', ['蓬松', '丰盈', '扁塌']], ['去屑', ['去屑', '头屑']], ['柔顺', ['柔顺', '顺滑']],
  ['清爽/清洁', ['清爽', '清洁', '净澈']], ['修护', ['修护', '修复']], ['滋养/滋润', ['滋养', '滋润', '保湿']], ['止痒', ['止痒']],
  ['留香/香氛', ['留香', '香氛', '香味']], ['改善毛躁', ['毛躁']], ['氨基酸', ['氨基酸']], ['防脱/固发', ['防脱', '固发']], ['无硅油', ['无硅油']],
] as const;
export const facialCleanserSellingPointGroups = [
  ['控油', ['控油', '油皮']], ['温和', ['温和', '氨基酸']], ['清洁', ['清洁', '深层清洁']],
  ['保湿', ['保湿', '水润']], ['祛痘', ['祛痘', '痘肌']], ['敏感肌', ['敏感肌', '舒缓']],
] as const;
function sellingPointStats(entries: OpportunityEntry[], profile: 'shampoo' | 'facial_cleanser') {
  const groups = (profile === 'facial_cleanser' ? facialCleanserSellingPointGroups : sellingPointGroups).map(([term, aliases]) => {
    const sourceEntryIds = entries.filter(entry => aliases.some(alias => `${entry.data.title} ${entry.data.sellingPoints}`.includes(alias))).map(entry => entry.id);
    return { term, count: sourceEntryIds.length, sourceEntryIds };
  }).filter(item => item.count > 0).sort((a,b) => b.count-a.count || a.term.localeCompare(b.term,'zh-CN'));
  const combinations: Array<{ terms: string[]; count: number; sourceEntryIds: string[] }> = [];
  for (let i=0;i<groups.length;i++) for (let j=i+1;j<groups.length;j++) {
    const sourceEntryIds = groups[i]!.sourceEntryIds.filter(id => groups[j]!.sourceEntryIds.includes(id));
    if (sourceEntryIds.length) combinations.push({ terms:[groups[i]!.term,groups[j]!.term],count:sourceEntryIds.length,sourceEntryIds });
  }
  return { groups, combinations: combinations.sort((a,b) => b.count-a.count || a.terms.join('').localeCompare(b.terms.join(''),'zh-CN')).slice(0,30) };
}

export function analyzeOpportunity(batch: OpportunityPreview['batch'], entries: OpportunityEntry[], sourceScope: 'jd_union_jingfen' | 'other' = 'other', profile: 'shampoo' | 'facial_cleanser' = 'shampoo'): OpportunityPreview {
  const included = entries.filter(entry => ['confirmed','firstSeen'].includes(entry.analysis.signal));
  const excluded = entries.filter(entry => !included.includes(entry)).map(entry => ({ ...entry, exclusionReason: entry.analysis.signal === 'old' ? '已存在老品证据' : entry.analysis.signal === 'suspectedRelist' ? '疑似老品换链接或换店铺，需先核对' : '现有证据不足，需先核对' }));
  const maximum = Math.max(...included.map(entry => entry.data.value), 1), keywordMap = new Map<string,{ score:number; ids:Set<string> }>();
  for (const entry of included) for (const term of new Set([...terms(entry.data.title), ...terms(entry.data.sellingPoints)])) {
    const current = keywordMap.get(term) ?? { score: 0, ids: new Set<string>() };
    current.score += sourceScope === 'jd_union_jingfen' ? 1 : 1 + entry.data.value / maximum; current.ids.add(entry.id); keywordMap.set(term,current);
  }
  const keywords = [...keywordMap].map(([term,value]) => ({ term, sourceEntryIds:[...value.ids], score:Number(value.score.toFixed(3)), coverage:value.ids.size })).sort((a,b) => b.coverage-a.coverage || b.score-a.score || b.term.length-a.term.length).slice(0,30);
  const prices = included.map(entry => entry.data.price).filter((value): value is number => value !== null).sort((a,b) => a-b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2;
  const priceBands = [
    { label:'30元以下',minimum:null,maximum:29.99,count:prices.filter(value=>value<30).length },
    { label:'30–49.99元',minimum:30,maximum:49.99,count:prices.filter(value=>value>=30&&value<50).length },
    { label:'50–99.99元',minimum:50,maximum:99.99,count:prices.filter(value=>value>=50&&value<100).length },
    { label:'100元及以上',minimum:100,maximum:null,count:prices.filter(value=>value>=100).length },
  ];
  const selling = sellingPointStats(included, profile);
  const missingFields: Array<[keyof OpportunityEntry['data'], string]> = [['price','价格'],['specification','规格'],['brand','品牌'],['shop','店铺'],['sellingPoints','卖点原文'],['ingredients','成分配方线索'],['packaging','包装形式'],['marketingMode','营销方式'],['externalDependence','达人直播依赖']];
  const missingRates = missingFields.map(([key,field]) => { const missing = included.filter(entry => entry.data[key] === null || String(entry.data[key]).trim() === '').length; return { field,missing,total:included.length,rate:included.length ? Number((missing/included.length).toFixed(4)) : 0 }; });
  const missing = new Set<string>();
  if (!prices.length) missing.add('价格');
  if (included.every(entry => !entry.data.timeEvidence)) missing.add('新品时间证据');
  if (included.every(entry => !entry.data.sellingPoints)) missing.add('卖点原文');
  if (included.every(entry => !entry.data.ingredients)) missing.add('成分配方线索');
  if (included.every(entry => !entry.data.packaging)) missing.add('包装形式');
  if (included.every(entry => !entry.data.marketingMode)) missing.add('营销方式');
  if (included.every(entry => !entry.data.externalDependence)) missing.add('达人直播依赖');
  return { batch, included, excluded, keywords, stats: { selectedCount:entries.length,includedCount:included.length,excludedCount:excluded.length,brands:distribution(included.map(entry=>entry.data.brand)),shops:distribution(included.map(entry=>entry.data.shop)),specifications:distribution(included.map(entry=>entry.data.specification)),price:prices.length ? { minimum:prices[0]!,median,maximum:prices.at(-1)! } : null,priceBands,sellingPoints:selling.groups,sellingPointCombinations:selling.combinations,missingRates }, missingEvidence:[...missing], algorithmVersion:'market-opportunity-v1' };
}
