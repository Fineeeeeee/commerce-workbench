import { z } from 'zod';

const short = z.string().trim().min(1).max(160);
export const batchSchema = z.object({ name: short, source: short, platform: short, periodStart: z.iso.date(), periodEnd: z.iso.date(), metricName: short, metricUnit: short }).strict().refine(b => b.periodStart <= b.periodEnd, '统计开始日期不能晚于结束日期');
export type BatchInput = z.infer<typeof batchSchema>;
export type Batch = BatchInput & { id: string; importedAt: string; count: number };
export const verdicts = { old: '存在老品证据', candidate: '新品候选', different: '与关联记录不同款', unknown: '证据不足' } as const;
export const reviewSchema = z.object({ relatedEntryId: z.string().uuid().nullable(), verdict: z.enum(['old', 'candidate', 'different', 'unknown']), reason: z.string().trim().min(1).max(1000), evidence: z.string().trim().min(1).max(2000), reviewer: short }).strict().refine(r => r.verdict !== 'different' || r.relatedEntryId !== null, '不同款判断需要关联记录');
export type Review = z.infer<typeof reviewSchema> & { id: string; entryId: string; createdAt: string };
export const columns = ['商品标题', '商品链接', '品牌', '规格', '店铺', '条码', '榜单数值', '时间证据', '类目', '价格', '卖点原文', '成分配方线索', '包装形式', '营销方式', '达人直播依赖'] as const;
export type MarketRow = {
  title: string; url: string; brand: string; specification: string; shop: string; barcode: string;
  value: number; timeEvidence: string; category: string; price: number | null; sellingPoints: string;
  ingredients: string; packaging: string; marketingMode: string; externalDependence: string;
};
export const sourceMetadataSchema = z.object({
  source_scope: z.string().trim().min(1).max(160).optional(),
  source_elite_ids: z.array(z.number().int().nonnegative()).max(50).optional(),
  source_metric_type: z.string().trim().min(1).max(160).optional(),
  source_metric_raw: z.union([z.number(), z.string().max(500), z.null()]).optional(),
  raw_snapshot_path: z.string().max(1000).optional(),
  raw_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  main_image_url: z.string().url().optional(),
  source_comment_count: z.number().nonnegative().optional(),
  source_category_ids: z.array(z.number().int().nonnegative()).max(10).optional(),
  source_spuid: z.string().max(100).optional(),
  source_shop_id: z.string().max(100).optional(),
  source_price: z.number().nonnegative().optional(),
  source_lowest_price: z.number().nonnegative().optional(),
  source_lowest_coupon_price: z.number().nonnegative().optional(),
  source_coupons: z.array(z.object({status:z.number().int().optional(),getStart:z.number().optional(),getEnd:z.number().optional(),useStart:z.number().optional(),useEnd:z.number().optional(),discount:z.number().optional()}).strict()).max(30).optional(),
  source_commission: z.number().nonnegative().optional(),
  source_commission_share: z.number().nonnegative().optional(),
}).strict();
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export function hydrateMarketRow(value: Partial<MarketRow>): MarketRow {
  return { title: value.title ?? '', url: value.url ?? '', brand: value.brand ?? '', specification: value.specification ?? '', shop: value.shop ?? '', barcode: value.barcode ?? '', value: Number(value.value ?? 0), timeEvidence: value.timeEvidence ?? '', category: value.category ?? '', price: value.price ?? null, sellingPoints: value.sellingPoints ?? '', ingredients: value.ingredients ?? '', packaging: value.packaging ?? '', marketingMode: value.marketingMode ?? '', externalDependence: value.externalDependence ?? '' };
}
export type Entry = { id: string; batchId: string; rowNumber: number; raw: string[]; data: MarketRow; sourceProductId?: string | null; sourceMetadata?: SourceMetadata; reviews: Review[] };
export const marketSignals = {
  confirmed: '已确认新品候选',
  firstSeen: '本库首次出现',
  suspectedRelist: '疑似老品换链接/店铺',
  old: '已有老品证据',
  pending: '需要人工核对',
} as const;
export type MarketSignal = keyof typeof marketSignals;
export type MarketMatch = { entryId: string; batchId: string; title: string; shop: string; reason: string };
export type MarketAnalysis = { signal: MarketSignal; matches: MarketMatch[]; completeness: number; missing: string[] };
export type MarketSummary = Record<MarketSignal, number>;

export function parseMarketCsv(input: string): { raw: string[]; data: MarketRow }[] {
  if (input.length > 350_000) throw new Error('榜单内容过大，请分批导入');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const csv = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!;
    if (quoted) { if (c === '"') { if (csv[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } } else cell += c; continue; }
    if (c === '"') { if (cell || closed) throw new Error('CSV 引号格式错误'); quoted = true; }
    else if (c === ',') { row.push(cell); cell = ''; closed = false; }
    else if (c === '\r' || c === '\n') { if (c === '\r' && csv[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; closed = false; }
    else { if (closed) throw new Error('CSV 引号后存在多余字符'); cell += c; }
  }
  if (quoted) throw new Error('CSV 引号没有闭合');
  if (cell || row.length || closed) { row.push(cell); rows.push(row); }
  if (JSON.stringify(rows.shift()) !== JSON.stringify(columns)) throw new Error(`列名和顺序必须为：${columns.join('、')}`);
  if (!rows.length || rows.length > 500) throw new Error('每批需要 1–500 条商品记录');
  return rows.map((raw, i) => {
    if (raw.length !== columns.length || raw.some(c => c.length > 2000)) throw new Error(`第 ${i + 2} 行列数或字段长度错误`);
    const [title, url, brand, specification, shop, barcode, value, timeEvidence, category, price, sellingPoints, ingredients, packaging, marketingMode, externalDependence] = raw.map(c => c.trim()) as [string,string,string,string,string,string,string,string,string,string,string,string,string,string,string];
    if (!title || !/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`第 ${i + 2} 行需要商品标题和非负榜单数值`);
    if (price && (!/^\d+(\.\d+)?$/.test(price) || !Number.isFinite(Number(price)))) throw new Error(`第 ${i + 2} 行价格必须为非负数字或留空`);
    if (url && !/^https?:\/\//i.test(url)) throw new Error(`第 ${i + 2} 行商品链接须为 http 或 https`);
    return { raw, data: hydrateMarketRow({ title, url, brand, specification, shop, barcode, value: Number(value), timeEvidence, category, price: price ? Number(price) : null, sellingPoints, ingredients, packaging, marketingMode, externalDependence }) };
  });
}
export function csvText(rows: unknown[][]): string {
  return '\uFEFF' + rows.map(row => row.map(value => { const s = String(value ?? ''); const safe = /^[\s\uFEFF]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s) ? `'${s}` : s; return `"${safe.replaceAll('"', '""')}"`; }).join(',')).join('\r\n');
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/官方|旗舰店|专卖店|正品|新款|新品|升级|同款|包邮|促销|直播|推荐|热卖|爆款|到手|拍下|赠品|买\d+送\d+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function grams(value: string): Set<string> {
  const text = normalized(value); if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2)));
}

function titleSimilarity(a: string, b: string): number {
  const left = grams(a), right = grams(b); if (!left.size || !right.size) return 0;
  let shared = 0; for (const item of left) if (right.has(item)) shared++;
  return (2 * shared) / (left.size + right.size);
}

export function candidateReasons(a: MarketRow, b: MarketRow): string[] {
  const reasons: string[] = [];
  if (a.barcode && a.barcode === b.barcode) reasons.push('条码相同');
  if (a.url && a.url === b.url) reasons.push('商品链接相同');
  const brandSame = !!normalized(a.brand) && normalized(a.brand) === normalized(b.brand);
  const specificationSame = !!normalized(a.specification) && normalized(a.specification) === normalized(b.specification);
  const similarity = titleSimilarity(a.title, b.title);
  if (brandSame && normalized(a.title) === normalized(b.title)) reasons.push('品牌和标准化标题相同');
  else if (brandSame && similarity >= 0.72) reasons.push(`同品牌标题高度相似（${Math.round(similarity * 100)}%）`);
  else if (specificationSame && similarity >= 0.86) reasons.push(`同规格标题高度相似（${Math.round(similarity * 100)}%）`);
  if (reasons.length && a.shop && b.shop && normalized(a.shop) !== normalized(b.shop)) reasons.push('店铺不同，需排查换店销售');
  if (reasons.length && a.url && b.url && a.url !== b.url) reasons.push('链接不同，需排查重新上架');
  return reasons;
}

export function candidateReason(a: MarketRow, b: MarketRow): string | null {
  const reasons = candidateReasons(a, b);
  return reasons.length ? `${reasons.join('；')}，需结合历史时间证据人工确认` : null;
}

export function analyzeMarketEntry(entry: Entry, matches: MarketMatch[]): MarketAnalysis {
  const verdict = entry.reviews[0]?.verdict;
  const signal: MarketSignal = verdict === 'old' ? 'old' : verdict === 'candidate' ? 'confirmed' : verdict === 'different' ? 'firstSeen' : matches.length ? 'suspectedRelist' : verdict === 'unknown' ? 'pending' : 'firstSeen';
  const fields: Array<[keyof MarketRow, string]> = [['brand', '品牌'], ['specification', '规格'], ['shop', '店铺'], ['url', '商品链接'], ['timeEvidence', '时间证据']];
  const missing = fields.filter(([key]) => !String(entry.data[key] ?? '').trim()).map(([, label]) => label);
  return { signal, matches, completeness: Math.round(((fields.length - missing.length) / fields.length) * 100), missing };
}
