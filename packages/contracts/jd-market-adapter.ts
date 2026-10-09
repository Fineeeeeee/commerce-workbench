import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { columns, hydrateMarketRow, sourceMetadataSchema, type BatchInput, type MarketRow, type SourceMetadata } from './market.js';
import { jdCollectionProfiles, matchesJdProfile, type JdCollectionProfile } from './jd-collection-profiles.js';

const rawItemSchema = z.object({
  itemId: z.union([z.string(), z.number()]),
  skuName: z.string().min(1),
  materialUrl: z.string().optional(),
  brandName: z.string().optional(),
  categoryInfo: z.object({
    cid1: z.number().int().optional(), cid1Name: z.string().optional(),
    cid2: z.number().int().optional(), cid2Name: z.string().optional(),
    cid3: z.number().int().optional(), cid3Name: z.string().optional(),
  }).passthrough(),
  priceInfo: z.object({ lowestCouponPrice: z.number().nonnegative().optional(), lowestPrice: z.number().nonnegative().optional(), price: z.number().nonnegative().optional() }).passthrough(),
  shopInfo: z.object({ shopName: z.string().optional() }).passthrough().optional(),
  spuid: z.union([z.string(),z.number()]).optional(),
  couponInfo: z.object({couponList:z.array(z.object({couponStatus:z.number().int().optional(),getStartTime:z.number().optional(),getEndTime:z.number().optional(),useStartTime:z.number().optional(),useEndTime:z.number().optional(),discount:z.number().optional()}).passthrough()).optional()}).passthrough().optional(),
  commissionInfo: z.object({commission:z.number().nonnegative().optional(),commissionShare:z.number().nonnegative().optional()}).passthrough().optional(),
  comments: z.number().nonnegative().optional(),
  inOrderCount30DaysSku: z.number().nonnegative(),
  imageInfo: z.object({ imageList: z.array(z.object({ url: z.string() }).passthrough()).optional(), whiteImage: z.string().optional() }).passthrough().optional(),
}).passthrough();

const sourceSchema = z.object({
  batch_id: z.string().min(1),
  collected_at: z.string().min(1),
  source_scope: z.enum(['jd_union_jingfen', 'jd_union_jingfen_multi_pool']),
  collection_profile: z.enum(['shampoo', 'facial_cleanser']).optional(),
  items: z.array(z.object({ item_id: z.union([z.string(), z.number()]), source_elite_ids: z.array(z.number().int().nonnegative()).min(1), raw_item: rawItemSchema }).strict()),
}).passthrough();

export type JdAdaptedRecord = { raw: string[]; data: MarketRow; sourceProductId: string; sourceMetadata: SourceMetadata };
export type JdAdaptedBatch = { sourceBatchId: string; batch: BatchInput; collectedAt: string; records: JdAdaptedRecord[] };

const specPatterns = [/(\d+(?:\.\d+)?\s*(?:ml|mL|ML|毫升|l|L|升|g|G|克|kg|KG|千克)(?:\s*[×xX*]\s*\d+)?)/u, /(\d+\s*(?:瓶|袋|盒|支|套)(?:装)?)/u];
const sellingTerms = ['控油', '蓬松', '去屑', '柔顺', '滋养', '修护', '留香', '清爽', '止痒', '强韧', '防断', '净澈'];
const facialCleanserTerms = ['控油', '温和', '清洁', '保湿', '祛痘', '敏感肌', '舒缓', '氨基酸'];
const ingredientTerms = ['氨基酸', '玻尿酸', '烟酰胺', '咖啡因', '生姜', '何首乌', '茶树', '海盐', '椰油', '角蛋白'];

function extractTerms(title: string, terms: string[]) { return terms.filter(term => title.includes(term)).join('、'); }
function extractSpec(title: string) { return specPatterns.map(pattern => title.match(pattern)?.[1]?.replaceAll(' ', '')).find(Boolean) ?? ''; }
function absoluteUrl(value = '') { return !value ? '' : /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`; }
function rawCells(data: MarketRow): string[] {
  return [data.title, data.url, data.brand, data.specification, data.shop, data.barcode, String(data.value), data.timeEvidence, data.category, data.price === null ? '' : String(data.price), data.sellingPoints, data.ingredients, data.packaging, data.marketingMode, data.externalDependence];
}

function findSnapshot(rawRoot: string, eliteIds: number[], itemId: string): string {
  for (const eliteId of eliteIds) {
    const candidate = join(rawRoot, `elite-${eliteId}`, 'products', `${itemId}.json`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 itemId=${itemId} 的 raw snapshot`);
}

export function adaptJdJingfen(sourceValue: unknown, rawRoot: string): JdAdaptedBatch {
  const source = sourceSchema.parse(sourceValue);
  const profile: JdCollectionProfile = source.collection_profile ?? 'shampoo';
  const seen = new Set<string>();
  const records = source.items.map((sourceRecord, index): JdAdaptedRecord => {
    const item = sourceRecord.raw_item;
    const sourceProductId = String(sourceRecord.item_id);
    if (String(item.itemId) !== sourceProductId) throw new Error(`第 ${index + 1} 条 itemId 不一致`);
    if (seen.has(sourceProductId)) throw new Error(`重复 itemId: ${sourceProductId}`);
    if (profile === 'facial_cleanser' && !matchesJdProfile(profile, item.categoryInfo.cid3, item.skuName)) throw new Error(`第 ${index + 1} 条不属于已验证的洗面奶类目`);
    seen.add(sourceProductId);
    const snapshotPath = findSnapshot(rawRoot, sourceRecord.source_elite_ids, sourceProductId);
    const snapshotHash = createHash('sha256').update(readFileSync(snapshotPath)).digest('hex');
    const categoryNames = [item.categoryInfo.cid1Name, item.categoryInfo.cid2Name, item.categoryInfo.cid3Name].filter(Boolean);
    const categoryIds = [item.categoryInfo.cid1, item.categoryInfo.cid2, item.categoryInfo.cid3].filter((value): value is number => value !== undefined);
    const price = item.priceInfo.lowestCouponPrice ?? item.priceInfo.lowestPrice ?? item.priceInfo.price ?? null;
    const mainImage = absoluteUrl(item.imageInfo?.whiteImage ?? item.imageInfo?.imageList?.[0]?.url ?? '');
    const data = hydrateMarketRow({
      title: item.skuName,
      url: absoluteUrl(item.materialUrl),
      brand: item.brandName ?? '',
      specification: extractSpec(item.skuName),
      shop: item.shopInfo?.shopName ?? '',
      barcode: '',
      value: item.inOrderCount30DaysSku,
      timeEvidence: '',
      category: categoryNames.join(' / '),
      price,
      sellingPoints: extractTerms(item.skuName, profile === 'facial_cleanser' ? facialCleanserTerms : sellingTerms),
      ingredients: extractTerms(item.skuName, ingredientTerms),
      packaging: '', marketingMode: '', externalDependence: '',
    });
    const sourceMetadata = sourceMetadataSchema.parse({
      source_scope: 'jd_union_jingfen',
      source_elite_ids: sourceRecord.source_elite_ids,
      source_metric_type: 'jd_union_in_order_count_30d_sku',
      source_metric_raw: item.inOrderCount30DaysSku,
      raw_snapshot_path: snapshotPath,
      raw_snapshot_hash: snapshotHash,
      ...(mainImage ? { main_image_url: mainImage } : {}),
      ...(item.comments === undefined ? {} : { source_comment_count: item.comments }),
      source_category_ids: categoryIds,
      ...(item.spuid===undefined?{}:{source_spuid:String(item.spuid)}),
      ...(item.shopInfo?.shopId===undefined?{}:{source_shop_id:String(item.shopInfo.shopId)}),
      ...(item.priceInfo.price===undefined?{}:{source_price:item.priceInfo.price}),
      ...(item.priceInfo.lowestPrice===undefined?{}:{source_lowest_price:item.priceInfo.lowestPrice}),
      ...(item.priceInfo.lowestCouponPrice===undefined?{}:{source_lowest_coupon_price:item.priceInfo.lowestCouponPrice}),
      source_coupons:(item.couponInfo?.couponList??[]).map(coupon=>({
        ...(coupon.couponStatus===undefined?{}:{status:coupon.couponStatus}),
        ...(coupon.getStartTime===undefined?{}:{getStart:coupon.getStartTime}),
        ...(coupon.getEndTime===undefined?{}:{getEnd:coupon.getEndTime}),
        ...(coupon.useStartTime===undefined?{}:{useStart:coupon.useStartTime}),
        ...(coupon.useEndTime===undefined?{}:{useEnd:coupon.useEndTime}),
        ...(coupon.discount===undefined?{}:{discount:coupon.discount}),
      })),
      ...(item.commissionInfo?.commission===undefined?{}:{source_commission:item.commissionInfo.commission}),
      ...(item.commissionInfo?.commissionShare===undefined?{}:{source_commission_share:item.commissionInfo.commissionShare}),
    });
    return { raw: rawCells(data), data, sourceProductId, sourceMetadata };
  });
  const collectedDate = source.collected_at.slice(0, 10);
  const batch: BatchInput = {
    name: `京东联盟京粉精选${jdCollectionProfiles[profile].label}样本 ${collectedDate}`,
    source: 'JD Union Jingfen selected pools；仅代表当前样本，不代表京东全站',
    platform: '京东', periodStart: collectedDate, periodEnd: collectedDate,
    metricName: '京东联盟30天SKU引单量', metricUnit: '引单',
  };
  return { sourceBatchId: source.batch_id, batch, collectedAt: source.collected_at, records };
}

export function jdRowsToCsv(batch: JdAdaptedBatch): unknown[][] { return [[...columns], ...batch.records.map(record => record.raw)]; }
