import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateTasks } from './task-migration.js';
import { migrateBusinessV4, taobaoDailyCareTemplateId } from './business-migration.js';
import { migrateOpportunitiesV5 } from './opportunity-migration.js';
import { migrateMarketSourcesV6 } from './market-source-migration.js';
import { migrateMarketResearchV7 } from './market-research-migration.js';
import { migrateProjectResearchV8 } from './project-research-migration.js';
import { migrateProjectTypeV9 } from './project-type-migration.js';
import { migrateContentProductionV10 } from './content-production-migration.js';
import { migrateProductIntelligenceV11 } from './product-intelligence-migration.js';
import { migrateMarketMonitoringV12 } from './market-monitoring-migration.js';
import { migrateWorkQueueV13 } from './work-queue-migration.js';
import { migrateVisualGuidesV14 } from './visual-guide-migration.js';
import { migrateMarketMemoryV16 } from "./market-memory-migration.js";
import { migrateImageTypesV15 } from './image-type-migration.js';
import type { Product, ProductInput, Kit, KitInput, Asset, ExportRecord, Revision } from '../../packages/contracts/domain.js';
import { hydrateTemplatePages } from '../../packages/contracts/content-template.js';

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
export class Store {
  db: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'workbench.sqlite'), { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(version)) throw new Error('数据库版本不受支持；未执行迁移');
    if (version === 0) {
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new Error('拒绝修改未知数据库');
      this.db.exec(`BEGIN;
        CREATE TABLE products (id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE product_versions (product_id TEXT NOT NULL REFERENCES products(id), version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(product_id,version)) STRICT;
        CREATE TABLE assets (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, source TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
        CREATE TABLE kits (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), version INTEGER NOT NULL, updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE kit_versions (kit_id TEXT NOT NULL REFERENCES kits(id), version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(kit_id,version)) STRICT;
        CREATE TABLE exports (id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, kit_version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed')), created_at TEXT NOT NULL, error TEXT, path TEXT, FOREIGN KEY(kit_id,kit_version) REFERENCES kit_versions(kit_id,version)) STRICT;
        PRAGMA user_version = 1; COMMIT;`);
    }
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) === 1) {
      const backupPath = join(directory, `before-market-${randomUUID()}.sqlite`);
      this.db.prepare('VACUUM INTO ?').run(backupPath);
      try {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE market_batches (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, platform TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, metric_name TEXT NOT NULL, metric_unit TEXT NOT NULL, imported_at TEXT NOT NULL) STRICT;
          CREATE TABLE market_entries (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES market_batches(id), row_number INTEGER NOT NULL, raw_data TEXT NOT NULL, normalized_data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(batch_id,row_number)) STRICT;
          CREATE TABLE market_reviews (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES market_entries(id), related_entry_id TEXT REFERENCES market_entries(id), verdict TEXT NOT NULL CHECK(verdict IN ('old','candidate','different','unknown')), reason TEXT NOT NULL, evidence TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
          PRAGMA user_version = 2; COMMIT;`);
      } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
    }
    try { migrateTasks(this.db, directory); migrateBusinessV4(this.db, directory); migrateOpportunitiesV5(this.db, directory); migrateMarketSourcesV6(this.db, directory); migrateMarketResearchV7(this.db, directory); migrateProjectResearchV8(this.db, directory); migrateProjectTypeV9(this.db, directory); migrateContentProductionV10(this.db, directory); migrateProductIntelligenceV11(this.db, directory); migrateMarketMonitoringV12(this.db, directory); migrateWorkQueueV13(this.db, directory); migrateVisualGuidesV14(this.db, directory); migrateImageTypesV15(this.db,directory); migrateMarketMemoryV16(this.db,directory); } catch (error) { this.db.close(); throw error; }
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close() { this.db.close(); }
  listProducts(): Product[] { return this.db.prepare('SELECT id FROM products ORDER BY updated_at DESC').all().map(r => this.product(String(r.id))); }
  product(id: string, version?: number): Product {
    const row = this.db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!row) throw new AppError('NOT_FOUND', '商品不存在', 404);
    const v = version ?? Number(row.version);
    const revision = this.db.prepare('SELECT * FROM product_versions WHERE product_id=? AND version=?').get(id, v);
    if (!revision) throw new AppError('NOT_FOUND', '商品版本不存在', 404);
    return { ...JSON.parse(String(revision.data)), id, spuId: row.spu_id ? String(row.spu_id) : null, version: v, updatedAt: String(revision.created_at) };
  }
  createProduct(data: ProductInput, spuId: string | null = null): Product {
    const id = randomUUID(), time = now();
    this.transaction(() => { if (spuId && !this.db.prepare('SELECT id FROM spus WHERE id=?').get(spuId)) throw new AppError('NOT_FOUND', 'SPU不存在', 404); this.db.prepare('INSERT INTO products (id,version,updated_at,spu_id) VALUES (?,?,?,?)').run(id, 1, time, spuId); this.db.prepare('INSERT INTO product_versions VALUES (?,?,?,?)').run(id, 1, JSON.stringify(data), time); });
    return this.product(id);
  }
  saveProduct(id: string, baseVersion: number, data: ProductInput): Product {
    this.transaction(() => {
      const current = this.product(id);
      if (current.version !== baseVersion) throw new AppError('VERSION_CONFLICT', '商品已在其他窗口更新，请重新加载后修改', 409);
      const time = now(), version = current.version + 1;
      this.db.prepare('INSERT INTO product_versions VALUES (?,?,?,?)').run(id, version, JSON.stringify(data), time);
      this.db.prepare('UPDATE products SET version=?,updated_at=? WHERE id=?').run(version, time, id);
    }); return this.product(id);
  }
  listAssets(productId: string): Asset[] { this.product(productId); return this.db.prepare('SELECT * FROM assets WHERE product_id=? ORDER BY created_at').all(productId).map(r => this.publicAsset(r)); }
  publicAsset(r: Row): Asset { return { id: String(r.id), productId: String(r.product_id), name: String(r.name), mime: String(r.mime), width: Number(r.width), height: Number(r.height), source: String(r.source), createdAt: String(r.created_at) }; }
  asset(id: string): { asset: Asset; path: string } {
    const r = this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);
    if (!r) throw new AppError('NOT_FOUND', '素材不存在', 404);
    return { asset: this.publicAsset(r), path: String(r.path) };
  }
  addAsset(asset: Asset, path: string, sha256: string) {
    this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?,?)').run(asset.id, asset.productId, asset.name, asset.mime, asset.width, asset.height, asset.source, path, sha256, asset.createdAt);
  }
  listKits(productId: string): Kit[] { return this.db.prepare('SELECT id FROM kits WHERE product_id=? ORDER BY updated_at DESC').all(productId).map(r => this.kit(String(r.id))); }
  kit(id: string, version?: number): Kit {
    const row = this.db.prepare('SELECT * FROM kits WHERE id=?').get(id);
    if (!row) throw new AppError('NOT_FOUND', '设计稿不存在', 404);
    const v = version ?? Number(row.version);
    const revision = this.db.prepare('SELECT * FROM kit_versions WHERE kit_id=? AND version=?').get(id, v);
    if (!revision) throw new AppError('NOT_FOUND', '设计稿版本不存在', 404);
    const data = JSON.parse(String(revision.data));
    return { ...data, pages: hydrateTemplatePages(data.pages), id, productId: String(row.product_id), spuId: row.spu_id ? String(row.spu_id) : null, skuId: row.sku_id ? String(row.sku_id) : String(row.product_id), channel: String(row.channel ?? 'taobao'), contentTemplateId: row.content_template_id ? String(row.content_template_id) : null, version: v, updatedAt: String(revision.created_at) };
  }
  createKit(productId: string, data: KitInput): Kit {
    const id = randomUUID(), time = now();
    this.transaction(() => { const product = this.product(productId, data.productVersion); this.db.prepare('INSERT INTO kits (id,product_id,version,updated_at,spu_id,sku_id,channel,content_template_id) VALUES (?,?,?,?,?,?,?,?)').run(id, productId, 1, time, product.spuId ?? null, productId, 'taobao', taobaoDailyCareTemplateId); this.db.prepare('INSERT INTO kit_versions VALUES (?,?,?,?)').run(id, 1, JSON.stringify(data), time); });
    return this.kit(id);
  }
  saveKit(id: string, baseVersion: number, data: KitInput, afterSave?: (version: number) => void): Kit {
    this.transaction(() => {
      const current = this.kit(id);
      if (current.version !== baseVersion) throw new AppError('VERSION_CONFLICT', '设计稿已有更新，请重新加载以免覆盖新内容', 409);
      this.product(current.productId, data.productVersion);
      const version = current.version + 1, time = now();
      this.db.prepare('INSERT INTO kit_versions VALUES (?,?,?,?)').run(id, version, JSON.stringify(data), time);
      this.db.prepare('UPDATE kits SET version=?,updated_at=? WHERE id=?').run(version, time, id);
      afterSave?.(version);
    }); return this.kit(id);
  }
  revisions(id: string): Revision[] { this.kit(id); return this.db.prepare('SELECT version,created_at FROM kit_versions WHERE kit_id=? ORDER BY version DESC').all(id).map(r => ({ version: Number(r.version), createdAt: String(r.created_at) })); }
  startExport(kit: Kit): ExportRecord {
    const record: ExportRecord = { id: randomUUID(), kitId: kit.id, kitVersion: kit.version, state: 'running', createdAt: now(), error: null };
    this.db.prepare('INSERT INTO exports (id,kit_id,kit_version,state,created_at) VALUES (?,?,?,?,?)').run(record.id, kit.id, kit.version, record.state, record.createdAt);
    return record;
  }
  finishExport(id: string, path: string | null, error: string | null) { this.db.prepare('UPDATE exports SET state=?,path=?,error=? WHERE id=?').run(error ? 'failed' : 'succeeded', path, error, id); }
  exports(): ExportRecord[] { return this.db.prepare('SELECT * FROM exports ORDER BY created_at DESC LIMIT 100').all().map(r => ({ id: String(r.id), kitId: String(r.kit_id), kitVersion: Number(r.kit_version), state: r.state as ExportRecord['state'], createdAt: String(r.created_at), error: r.error === null ? null : String(r.error) })); }
  exportPath(id: string): string { const r = this.db.prepare("SELECT path FROM exports WHERE id=? AND state='succeeded'").get(id); if (!r?.path) throw new AppError('NOT_FOUND', '导出文件尚未就绪', 404); return String(r.path); }
}
