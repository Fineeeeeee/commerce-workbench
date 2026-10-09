import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/app.js';
import { Store } from '../apps/server/store.js';

const headers = { host: '127.0.0.1:4380', origin: 'http://127.0.0.1:4380' };
const request = async (app: Awaited<ReturnType<typeof createApp>>['app'], method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });

test('V4 迁移保留现有商品主键和套图关系，并建立洗发水业务上下文', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'commerce-v3-'));
  const database = new DatabaseSync(join(directory, 'workbench.sqlite'));
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE products (id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE product_versions (product_id TEXT NOT NULL REFERENCES products(id), version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(product_id,version)) STRICT;
    CREATE TABLE kits (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), version INTEGER NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE kit_versions (kit_id TEXT NOT NULL REFERENCES kits(id), version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(kit_id,version)) STRICT;
    CREATE TABLE jobs (id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, kit_version INTEGER NOT NULL, product_id TEXT NOT NULL, product_version INTEGER NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('copy','image','export')), input_snapshot TEXT NOT NULL, profile_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(kit_id,kit_version) REFERENCES kit_versions(kit_id,version), FOREIGN KEY(product_id,product_version) REFERENCES product_versions(product_id,version)) STRICT;
    CREATE TABLE market_batches (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, platform TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, metric_name TEXT NOT NULL, metric_unit TEXT NOT NULL, imported_at TEXT NOT NULL) STRICT;
    CREATE TABLE market_entries (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES market_batches(id), row_number INTEGER NOT NULL, raw_data TEXT NOT NULL, normalized_data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(batch_id,row_number)) STRICT;
    CREATE TABLE market_reviews (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES market_entries(id), related_entry_id TEXT REFERENCES market_entries(id), verdict TEXT NOT NULL CHECK(verdict IN ('old','candidate','different','unknown')), reason TEXT NOT NULL, evidence TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
    PRAGMA user_version=3;
  `);
  const productId = randomUUID(), kitId = randomUUID(), time = new Date().toISOString();
  const productData = { name: 'LEADR溪畔幽兰香氛洗发水', brand: 'LEADR', variant: '溪畔幽兰香氛', specification: '500ml', audience: '油性发质', origin: '广州', notes: '', claims: [{ id: randomUUID(), label: '蓬松', text: '洗后发根轻盈', source: '业务方提供', status: 'provided' }] };
  database.prepare('INSERT INTO products VALUES (?,?,?)').run(productId, 1, time);
  database.prepare('INSERT INTO product_versions VALUES (?,?,?,?)').run(productId, 1, JSON.stringify(productData), time);
  database.prepare('INSERT INTO kits VALUES (?,?,?,?)').run(kitId, productId, 1, time);
  database.prepare('INSERT INTO kit_versions VALUES (?,?,?,?)').run(kitId, 1, JSON.stringify({ name: '原套图', productVersion: 1, pages: [] }), time);
  database.close();

  const store = new Store(directory); t.after(() => store.close());
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
  assert.equal(store.product(productId).id, productId);
  const product = store.db.prepare('SELECT id,spu_id FROM products WHERE id=?').get(productId)!;
  const kit = store.db.prepare('SELECT id,product_id,spu_id,sku_id,channel,content_template_id FROM kits WHERE id=?').get(kitId)!;
  assert.equal(product.id, productId);
  assert.equal(kit.product_id, productId);
  assert.equal(kit.sku_id, productId);
  assert.equal(kit.spu_id, product.spu_id);
  assert.equal(kit.channel, 'taobao');
  assert.ok(store.db.prepare('SELECT id FROM product_projects').get());
  assert.ok((await readdir(directory)).some(name => name.startsWith('before-business-v4-')));
  assert.ok((await readdir(directory)).some(name => name.startsWith('before-opportunity-v5-')));
});

test('市场证据到经营反馈的业务主链可通过 API 完整运行', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'commerce-business-'));
  const { app, store } = await createApp(directory); t.after(() => app.close());
  const categories = await request(app, 'GET', '/api/categories');
  assert.equal(categories.statusCode, 200);
  const shampoo = categories.json().find((item: { code: string }) => item.code === 'shampoo');
  assert.ok(shampoo.template.fields.some((field: { code: string }) => field.code === 'ingredients'));

  const evidence = await request(app, 'POST', '/api/market-evidence', { title: '香氛洗护新品机会', sourceType: '淘宝榜单人工记录', sourceUrl: '', summary: '近期香氛与蓬松诉求集中出现', rawContent: '保留榜单日期、商品链接与观察备注' });
  assert.equal(evidence.statusCode, 201, evidence.body);
  const project = await request(app, 'POST', '/api/product-projects', { projectType: 'NEW_PRODUCT', categoryId: shampoo.id, name: '香氛洗发水新品项目', objective: '验证香氛蓬松洗护机会', positioning: '油性发质香氛洗护', constraints: ['不使用未经确认的功效表达'], notes: '' });
  assert.equal(project.statusCode, 201, project.body);
  const projectId = project.json().project.id;
  assert.equal((await request(app, 'POST', `/api/product-projects/${projectId}/evidence`, { evidenceId: evidence.json().id, note: '作为立项依据' })).statusCode, 201);
  const evidenceLibrary = await request(app, 'GET', '/api/market-evidence');
  const references = evidenceLibrary.json().find((item: {id:string}) => item.id === evidence.json().id).references;
  assert.deepEqual(references.projects, [{id:projectId,name:'香氛洗发水新品项目'}]);
  assert.deepEqual(references.opportunities, []);

  const update = async (status: string) => {
    const current = (await request(app, 'GET', `/api/product-projects/${projectId}`)).json().project;
    return request(app, 'PUT', `/api/product-projects/${projectId}`, { expectedUpdatedAt: current.updatedAt, status, data: { categoryId: current.categoryId, name: current.name, projectType: current.projectType, ...current.brief }, checklist: current.checklist, note: `进入${status}` });
  };
  assert.equal((await update('EVALUATING')).statusCode, 200);
  assert.equal((await update('APPROVED')).statusCode, 200);

  const spu = await request(app, 'POST', `/api/product-projects/${projectId}/spus`, { categoryId: shampoo.id, brand: '测试品牌', name: '香氛蓬松洗发水', positioning: '轻盈洗护', targetAudience: '油性发质', coreClaims: ['蓬松', '清爽'], dynamicAttributes: { hairType: ['油性'], fragrance: '幽兰香', netContent: '500ml', formulaType: '待研发确认', coreBenefits: ['蓬松', '清爽'], ingredients: [] }, status: 'ACTIVE' });
  assert.equal(spu.statusCode, 201, spu.body);
  const ingredients = await request(app, 'PATCH', `/api/spus/${spu.json().id}/ingredients`, { expectedUpdatedAt: spu.json().updatedAt, ingredients: ['霍霍巴籽油', '水解小麦蛋白', '霍霍巴籽油'] });
  assert.equal(ingredients.statusCode, 200, ingredients.body);
  assert.equal(ingredients.json().id, spu.json().id);
  assert.deepEqual(ingredients.json().dynamicAttributes.ingredients, ['霍霍巴籽油', '水解小麦蛋白']);
  assert.equal((await request(app, 'PATCH', `/api/spus/${spu.json().id}/ingredients`, { expectedUpdatedAt: spu.json().updatedAt, ingredients: ['何首乌'] })).statusCode, 409);
  assert.equal((await request(app, 'GET', `/api/product-projects/${projectId}`)).json().events.filter((event: { eventType: string }) => event.eventType === 'SPU_INGREDIENTS_UPDATED').length, 1);
  const fragrance = await request(app, 'PATCH', `/api/spus/${spu.json().id}/fragrance-notes`, { expectedUpdatedAt: ingredients.json().updatedAt, topNotes: '依兰、苹果、樱花', middleNotes: '百合、鸢尾、小苍兰', baseNotes: '檀香、柏木、龙涎香' });
  assert.equal(fragrance.statusCode, 200, fragrance.body);
  assert.equal(fragrance.json().id, spu.json().id);
  assert.deepEqual(fragrance.json().dynamicAttributes, { ...ingredients.json().dynamicAttributes, topNotes: '依兰、苹果、樱花', middleNotes: '百合、鸢尾、小苍兰', baseNotes: '檀香、柏木、龙涎香' });
  assert.equal((await request(app, 'PATCH', `/api/spus/${spu.json().id}/fragrance-notes`, { expectedUpdatedAt: ingredients.json().updatedAt, topNotes: '苹果', middleNotes: '百合', baseNotes: '柏木' })).statusCode, 409);
  assert.equal((await request(app, 'GET', `/api/product-projects/${projectId}`)).json().events.filter((event: { eventType: string }) => event.eventType === 'SPU_FRAGRANCE_NOTES_UPDATED').length, 1);
  const claimId = randomUUID();
  const sku = await request(app, 'POST', `/api/spus/${spu.json().id}/skus`, { variant: '单瓶', specification: '500ml', origin: '广州', notes: '', claims: [{ id: claimId, label: '蓬松', text: '确认后的卖点资料', source: '产品项目', status: 'provided' }] });
  assert.equal(sku.statusCode, 201, sku.body);
  const skuId = sku.json().id;
  const kit = await request(app, 'POST', `/api/products/${skuId}/kits`, { name: '淘宝日化商品图', detailCount: 12 });
  assert.equal(kit.statusCode, 201, kit.body);
  assert.equal(kit.json().spuId, spu.json().id);
  const workTargets = await request(app, 'GET', '/api/work-queue/targets');
  assert.equal(workTargets.statusCode, 200);
  assert.equal(workTargets.json().find((item: {type:string;id:string}) => item.type === 'CONTENT_PAGE' && item.id === kit.json().pages[0].id).target.projectId, projectId);
  const contentContext = await request(app, 'GET', `/api/products/${skuId}/business-context`);
  assert.equal(contentContext.statusCode, 200, contentContext.body);
  assert.equal(contentContext.json().project.id, projectId);
  assert.equal(contentContext.json().spu.id, spu.json().id);

  const deliveredAt = new Date().toISOString();
  const delivery = await request(app, 'POST', '/api/channel-deliveries', { projectId, spuId: spu.json().id, skuId, channel: 'taobao', kitId: kit.json().id, kitVersion: kit.json().version, deliveredAt, status: 'DELIVERED', notes: '淘宝首版交付' });
  assert.equal(delivery.statusCode, 201, delivery.body);
  const feedback = await request(app, 'POST', '/api/business-feedback', { projectId, skuId, channel: 'taobao', periodStart: '2026-09-01', periodEnd: '2026-09-07', sales: 120, impressions: 10000, clickRate: 0.08, conversionRate: 0.15, refundRate: 0.02, operationFeedback: '主图点击表现稳定', userFeedback: '留香反馈较多' });
  assert.equal(feedback.statusCode, 201, feedback.body);

  const detail = await request(app, 'GET', `/api/product-projects/${projectId}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().evidence.length, 1);
  assert.equal(detail.json().spus[0].skus[0].id, skuId);
  assert.equal(detail.json().spus[0].kits[0].id, kit.json().id);
  assert.equal(detail.json().deliveries.length, 1);
  assert.equal(detail.json().feedback.length, 1);
  assert.ok(detail.json().events.length >= 7);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
});
