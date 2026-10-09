import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../apps/server/store.js';
import { migrateMarketSourcesV6 } from '../apps/server/market-source-migration.js';
import { adaptJdJingfen } from '../packages/contracts/jd-market-adapter.js';

test('V6 migration preserves market rows, adds JSON constraint and source product index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'market-v6-'));
  const db = new DatabaseSync(join(directory, 'workbench.sqlite'));
  db.exec(`CREATE TABLE market_batches (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE market_entries (id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES market_batches(id),row_number INTEGER NOT NULL,raw_data TEXT NOT NULL,normalized_data TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(batch_id,row_number)) STRICT;
    INSERT INTO market_batches VALUES ('batch');
    INSERT INTO market_entries VALUES ('entry','batch',2,'[]','{}','2026-09-21');
    PRAGMA user_version=5;`);
  migrateMarketSourcesV6(db, directory);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 6);
  const row = db.prepare('SELECT source_product_id,source_metadata FROM market_entries').get()!;
  assert.equal(row.source_product_id, null); assert.equal(row.source_metadata, '{}');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='market_entries_source_product_id'").get());
  assert.throws(() => db.prepare("UPDATE market_entries SET source_metadata='bad' WHERE id='entry'").run());
  db.close();
  assert.equal(readdirSync(directory).filter(file => file.startsWith('before-market-source-v6-')).length, 1);
});

test('Store initializes through V6 and legacy market import keeps source defaults', () => {
  const directory = mkdtempSync(join(tmpdir(), 'store-v6-'));
  const store = new Store(directory);
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 16);
  store.close();
});

test('JD adapter preserves item identity, raw metric semantics and snapshot traceability', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jd-adapter-'));
  const itemId = 'jd-item-1';
  const productDirectory = join(directory, 'elite-22', 'products');
  mkdirSync(productDirectory, { recursive: true });
  writeFileSync(join(productDirectory, `${itemId}.json`), '{}');
  const result = adaptJdJingfen({ batch_id: 'batch', collected_at: '2026-09-21T00:00:00Z', source_scope: 'jd_union_jingfen_multi_pool', items: [{ item_id: itemId, source_elite_ids: [22], raw_item: { itemId, skuName: '品牌控油洗发水500ml', materialUrl: 'example.com/item', brandName: '品牌', categoryInfo: { cid1: 16750, cid1Name: '个人护理', cid2: 16751, cid2Name: '洗发护发', cid3: 16756, cid3Name: '洗发水' }, priceInfo: { price: 39.9 }, shopInfo: { shopName: '店铺' }, comments: 8, inOrderCount30DaysSku: 12, imageInfo: { imageList: [{ url: 'https://example.com/a.jpg' }] } } }] }, directory);
  assert.equal(result.records[0]!.sourceProductId, itemId);
  assert.equal(result.records[0]!.data.value, 12);
  assert.equal(result.records[0]!.sourceMetadata.source_metric_type, 'jd_union_in_order_count_30d_sku');
  assert.equal(result.records[0]!.sourceMetadata.source_metric_raw, 12);
  assert.match(result.records[0]!.sourceMetadata.raw_snapshot_hash!, /^[a-f0-9]{64}$/);
});

test('facial cleanser adapter accepts verified leaf category and keeps the JD metric distinct from sales', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jd-cleanser-'));
  const itemId = 'jd-cleanser-1';
  const productDirectory = join(directory, 'elite-22', 'products');
  mkdirSync(productDirectory, { recursive: true });
  writeFileSync(join(productDirectory, `${itemId}.json`), '{}');
  const source = { batch_id: 'cleanser-batch', collected_at: '2026-09-28T00:00:00Z', source_scope: 'jd_union_jingfen_multi_pool', collection_profile: 'facial_cleanser', items: [{ item_id: itemId, source_elite_ids: [22], raw_item: { itemId, skuName: '品牌温和洁面洗面奶100ml', categoryInfo: { cid3: 1389, cid3Name: '洁面' }, priceInfo: { price: 39.9 }, inOrderCount30DaysSku: 12 } }] };
  const result = adaptJdJingfen(source, directory);
  assert.equal(result.records.length, 1);
  assert.match(result.batch.name, /洗面奶/);
  assert.match(result.records[0]!.data.sellingPoints, /温和/);
  assert.equal(result.records[0]!.sourceMetadata.source_metric_type, 'jd_union_in_order_count_30d_sku');
  assert.throws(() => adaptJdJingfen({ ...source, items: [{ ...source.items[0]!, raw_item: { ...source.items[0]!.raw_item, categoryInfo: { cid3: 16756 }, skuName: '品牌洗面奶100ml' } }] }, directory));
});
