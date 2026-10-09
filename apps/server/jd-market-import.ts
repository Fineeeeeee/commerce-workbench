import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';
import { batchSchema, hydrateMarketRow, sourceMetadataSchema } from '../../packages/contracts/market.js';

const recordSchema = z.object({
  raw: z.array(z.string()).length(15),
  data: z.object({
    title: z.string().min(1), url: z.string(), brand: z.string(), specification: z.string(), shop: z.string(), barcode: z.string(),
    value: z.number().nonnegative(), timeEvidence: z.string(), category: z.string(), price: z.number().nonnegative().nullable(), sellingPoints: z.string(),
    ingredients: z.string(), packaging: z.string(), marketingMode: z.string(), externalDependence: z.string(),
  }).strict(),
  sourceProductId: z.string().min(1).max(300),
  sourceMetadata: sourceMetadataSchema,
}).strict();
const adaptedSchema = z.object({ sourceBatchId: z.string().min(1), batch: batchSchema, collectedAt: z.string().min(1), records: z.array(recordSchema).min(1).max(500) }).strict();

export function importJdMarketBatch(store: Store, input: unknown) {
  const adapted = adaptedSchema.parse(input);
  const sourceIds = new Set(adapted.records.map(record => record.sourceProductId));
  if (sourceIds.size !== adapted.records.length) throw new Error('JD 导入包含重复 source_product_id');
  const existing = store.db.prepare('SELECT id FROM market_batches WHERE name=? AND source=? AND platform=? AND period_start=? AND period_end=?').get(adapted.batch.name, adapted.batch.source, adapted.batch.platform, adapted.batch.periodStart, adapted.batch.periodEnd);
  if (existing) throw new Error(`JD 批次已导入: ${String(existing.id)}`);
  const id = randomUUID();
  const importedAt = new Date().toISOString();
  store.transaction(() => {
    store.db.prepare('INSERT INTO market_batches (id,name,source,platform,period_start,period_end,metric_name,metric_unit,imported_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, adapted.batch.name, adapted.batch.source, adapted.batch.platform, adapted.batch.periodStart, adapted.batch.periodEnd, adapted.batch.metricName, adapted.batch.metricUnit, importedAt);
    const insert = store.db.prepare('INSERT INTO market_entries (id,batch_id,row_number,raw_data,normalized_data,created_at,source_product_id,source_metadata) VALUES (?,?,?,?,?,?,?,?)');
    adapted.records.forEach((record, index) => insert.run(randomUUID(), id, index + 2, JSON.stringify(record.raw), JSON.stringify(hydrateMarketRow(record.data)), importedAt, record.sourceProductId, JSON.stringify(record.sourceMetadata)));
  });
  return { id, sourceBatchId: adapted.sourceBatchId, count: adapted.records.length, importedAt };
}
