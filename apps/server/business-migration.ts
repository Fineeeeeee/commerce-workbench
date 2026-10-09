import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const categoryIds = {
  personalCare: '11111111-1111-4111-8111-111111111111',
  hairCare: '22222222-2222-4222-8222-222222222222',
  shampoo: '33333333-3333-4333-8333-333333333333',
} as const;
export const shampooTemplateId = '44444444-4444-4444-8444-444444444444';
export const taobaoDailyCareTemplateId = '55555555-5555-4555-8555-555555555555';

const shampooTemplate = {
  name: '洗发水属性模板',
  fields: [
    { code: 'hairType', name: '发质', type: 'multi_select', required: true, options: ['油性', '干性', '中性', '混合性', '受损'] },
    { code: 'fragrance', name: '香型', type: 'text', required: false },
    { code: 'netContent', name: '净含量', type: 'text', required: true },
    { code: 'formulaType', name: '配方类型', type: 'text', required: false },
    { code: 'coreBenefits', name: '核心功效', type: 'multi_text', required: true },
    { code: 'ingredients', name: '主要成分', type: 'multi_text', required: false },
  ],
};

const contentTemplate = {
  mainCount: 5,
  detailCount: 12,
  mainPurposes: ['产品首图', '核心卖点', '产品特点', '适用需求', '规格信息'],
  detailPurposes: ['产品定位', '核心卖点', '特点说明一', '特点说明二', '特点说明三', '使用体验', '细节展示', '使用场景', '适用对象', '规格展示', '使用资料', '产品信息'],
};

export function migrateBusinessV4(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 3) return;
  const existingTables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)),
  );
  const requiredTables = ['products', 'product_versions', 'kits', 'kit_versions'];
  if (requiredTables.some(table => !existingTables.has(table))) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-business-v4-${randomUUID()}.sqlite`));
  const time = new Date().toISOString();
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE categories (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES categories(id), code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE category_template_versions (category_id TEXT NOT NULL REFERENCES categories(id), version INTEGER NOT NULL, schema_data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(category_id,version)) STRICT;
      CREATE TABLE content_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL, category_id TEXT REFERENCES categories(id), version INTEGER NOT NULL, template_data TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), created_at TEXT NOT NULL) STRICT;
      CREATE TABLE product_projects (id TEXT PRIMARY KEY, category_id TEXT REFERENCES categories(id), name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','EVALUATING','APPROVED','DEVELOPING','READY','LAUNCHED','CLOSED')), brief_data TEXT NOT NULL, checklist_data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE TABLE project_stage_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id), from_status TEXT, to_status TEXT, event_type TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE INDEX project_events_project ON project_stage_events(project_id,created_at,id);
      CREATE TABLE market_evidence (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_type TEXT NOT NULL, source_url TEXT, summary TEXT NOT NULL, raw_content TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE project_evidence (project_id TEXT NOT NULL REFERENCES product_projects(id), evidence_id TEXT NOT NULL REFERENCES market_evidence(id), note TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,evidence_id)) STRICT;
      CREATE TABLE spus (id TEXT PRIMARY KEY, product_project_id TEXT NOT NULL REFERENCES product_projects(id), category_id TEXT NOT NULL REFERENCES categories(id), brand TEXT NOT NULL, name TEXT NOT NULL, positioning TEXT NOT NULL, target_audience TEXT NOT NULL, core_claims TEXT NOT NULL, dynamic_attributes TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','RETIRED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      CREATE INDEX spus_project ON spus(product_project_id,created_at,id);
      ALTER TABLE products ADD COLUMN spu_id TEXT REFERENCES spus(id);
      CREATE INDEX products_spu ON products(spu_id,updated_at,id);
      ALTER TABLE kits ADD COLUMN spu_id TEXT REFERENCES spus(id);
      ALTER TABLE kits ADD COLUMN sku_id TEXT REFERENCES products(id);
      ALTER TABLE kits ADD COLUMN channel TEXT NOT NULL DEFAULT 'taobao';
      ALTER TABLE kits ADD COLUMN content_template_id TEXT REFERENCES content_templates(id);
      CREATE TABLE channel_deliveries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id), spu_id TEXT NOT NULL REFERENCES spus(id), sku_id TEXT REFERENCES products(id), channel TEXT NOT NULL, kit_id TEXT REFERENCES kits(id), kit_version INTEGER, delivered_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('DRAFT','DELIVERED','WITHDRAWN')), notes TEXT NOT NULL, created_at TEXT NOT NULL, CHECK((kit_id IS NULL AND kit_version IS NULL) OR (kit_id IS NOT NULL AND kit_version IS NOT NULL)), FOREIGN KEY(kit_id,kit_version) REFERENCES kit_versions(kit_id,version)) STRICT;
      CREATE INDEX deliveries_project ON channel_deliveries(project_id,delivered_at,id);
      CREATE TABLE business_feedback (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES product_projects(id), sku_id TEXT NOT NULL REFERENCES products(id), channel TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, sales INTEGER CHECK(sales IS NULL OR sales>=0), impressions INTEGER CHECK(impressions IS NULL OR impressions>=0), click_rate REAL CHECK(click_rate IS NULL OR (click_rate>=0 AND click_rate<=1)), conversion_rate REAL CHECK(conversion_rate IS NULL OR (conversion_rate>=0 AND conversion_rate<=1)), refund_rate REAL CHECK(refund_rate IS NULL OR (refund_rate>=0 AND refund_rate<=1)), operation_feedback TEXT NOT NULL, user_feedback TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
      CREATE INDEX feedback_project ON business_feedback(project_id,period_end,id);
    `);
    const category = db.prepare('INSERT INTO categories VALUES (?,?,?,?,?,?)');
    category.run(categoryIds.personalCare, null, 'personal-care', '日化个护', time, time);
    category.run(categoryIds.hairCare, categoryIds.personalCare, 'hair-care', '洗护发', time, time);
    category.run(categoryIds.shampoo, categoryIds.hairCare, 'shampoo', '洗发水', time, time);
    db.prepare('INSERT INTO category_template_versions VALUES (?,?,?,?)').run(categoryIds.shampoo, 1, JSON.stringify(shampooTemplate), time);
    db.prepare('INSERT INTO content_templates VALUES (?,?,?,?,?,?,?,?)').run(taobaoDailyCareTemplateId, '淘宝日化商品图 5+12', 'taobao', categoryIds.shampoo, 1, JSON.stringify(contentTemplate), 'ACTIVE', time);

    const products = db.prepare('SELECT p.id,p.version,pv.data FROM products p JOIN product_versions pv ON pv.product_id=p.id AND pv.version=p.version').all();
    for (const row of products) {
      const data = JSON.parse(String(row.data)) as { name?: string; brand?: string; variant?: string; specification?: string; audience?: string; claims?: Array<{ label?: string }> };
      if (data.name !== 'LEADR溪畔幽兰香氛洗发水') continue;
      const projectId = randomUUID(), spuId = randomUUID();
      db.prepare('INSERT INTO product_projects VALUES (?,?,?,?,?,?,?,?)').run(projectId, categoryIds.shampoo, '溪畔幽兰香氛洗发水产品项目', 'DEVELOPING', JSON.stringify({ objective: '基于现有产品资料完成产品定义、内容交付与经营反馈闭环', positioning: '香氛洗护产品', constraints: [], notes: '由V3现有商品迁移建立' }), JSON.stringify({ formulaConfirmed: false, packagingConfirmed: true, contentCompleted: false }), time, time);
      db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, 'DEVELOPING', 'PROJECT_MIGRATED', '由现有商品建立产品项目，保留原商品、素材、套图和历史记录', time);
      const attributes = { hairType: data.audience || '油性发质', fragrance: data.variant || '溪畔幽兰香氛', netContent: data.specification || '500ml', formulaType: '', coreBenefits: (data.claims ?? []).map(item => item.label).filter(Boolean), ingredients: [] };
      db.prepare('INSERT INTO spus VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(spuId, projectId, categoryIds.shampoo, data.brand || 'LEADR', '溪畔幽兰香氛洗发水', '面向油性发质的香氛洗护产品', data.audience || '油性发质', JSON.stringify((data.claims ?? []).map(item => item.label).filter(Boolean)), JSON.stringify(attributes), 'ACTIVE', time, time);
      db.prepare('UPDATE products SET spu_id=? WHERE id=?').run(spuId, String(row.id));
      db.prepare('UPDATE kits SET spu_id=?,sku_id=product_id,channel=?,content_template_id=? WHERE product_id=?').run(spuId, 'taobao', taobaoDailyCareTemplateId, String(row.id));
    }
    db.prepare("UPDATE kits SET sku_id=product_id,channel='taobao',content_template_id=? WHERE sku_id IS NULL").run(taobaoDailyCareTemplateId);
    db.exec('PRAGMA user_version=4; COMMIT;');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
