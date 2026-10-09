import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/app.js';
import { columns, csvText, type Batch, type Entry } from '../packages/contracts/market.js';
import type { Category, ProductProject, ProjectDetail } from '../packages/contracts/business.js';
import type { OpportunityPreview, ProductOpportunity } from '../packages/contracts/market-opportunity.js';
import { analyzeOpportunity } from '../packages/contracts/market-opportunity.js';

const headers = { host: '127.0.0.1:4380', origin: 'http://127.0.0.1:4380' };
const request = (app: Awaited<ReturnType<typeof createApp>>['app'], method: 'GET'|'POST', url: string, payload?: unknown) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const batch = (name: string, periodStart: string, periodEnd: string) => ({ name, source: '真实榜单测试样本', platform: '淘宝', periodStart, periodEnd, metricName: '销量', metricUnit: '件' });
const row = (values: Partial<Record<(typeof columns)[number], string>>) => columns.map(column => values[column] ?? '');

test('机会分析对偶数价格样本使用两个中间值的平均数', () => {
  const makeEntry = (id: string, price: number) => ({ id, batchId: 'batch', rowNumber: 2, raw: [], data: { title: `商品${id}`, url: '', brand: '', specification: '', shop: '', barcode: '', value: 1, timeEvidence: '2026-09-18', category: '洗发水', price, sellingPoints: '控油', ingredients: '', packaging: '', marketingMode: '', externalDependence: '' }, reviews: [], analysis: { signal: 'firstSeen' as const, matches: [], completeness: 20, missing: [] } });
  const result = analyzeOpportunity({ id: 'batch', name: '样本', source: '测试', platform: '淘宝', periodStart: '2026-09-18', periodEnd: '2026-09-18', metricName: '权重', metricUnit: '条' }, [makeEntry('a', 10), makeEntry('b', 20), makeEntry('c', 30), makeEntry('d', 40)]);
  assert.equal(result.stats.price?.median, 25);
});

test('JD facial cleanser statistics use cleanser terms and do not weight keywords by union order count', () => {
  const makeEntry = (id: string, value: number) => ({ id, batchId: 'batch', rowNumber: 2, raw: [], data: { title: '温和洁面洗面奶', url: '', brand: '', specification: '100ml', shop: '', barcode: '', value, timeEvidence: '', category: '洁面', price: 39, sellingPoints: '温和 清洁', ingredients: '', packaging: '', marketingMode: '', externalDependence: '' }, reviews: [], analysis: { signal: 'confirmed' as const, matches: [], completeness: 20, missing: [] } });
  const batch = { id: 'batch', name: '洁面样本', source: 'JD Union Jingfen', platform: '京东', periodStart: '2026-09-28', periodEnd: '2026-09-28', metricName: '引单', metricUnit: '条' };
  const first = analyzeOpportunity(batch, [makeEntry('a', 1), makeEntry('b', 1000)], 'jd_union_jingfen', 'facial_cleanser');
  const second = analyzeOpportunity(batch, [makeEntry('a', 1000), makeEntry('b', 1)], 'jd_union_jingfen', 'facial_cleanser');
  assert.deepEqual(first.keywords, second.keywords);
  assert.ok(first.stats.sellingPoints.some(item => item.term === '温和' && item.count === 2));
  assert.ok(!first.stats.sellingPoints.some(item => item.term === '去屑'));
});

test('竞品记录可形成可追溯产品机会并加入产品项目', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'market-opportunity-'));
  const { app, store } = await createApp(directory); t.after(() => app.close());
  const oldCsv = csvText([[...columns], row({ 商品标题: '旧款控油蓬松洗发水', 商品链接: 'https://example.com/old', 品牌: '旧牌', 规格: '500ml', 店铺: '旧店', 条码: 'OLD001', 榜单数值: '80', 时间证据: '2025-05首次评价', 类目: '洗发水', 价格: '39.9', 卖点原文: '控油 蓬松', 包装形式: '泵瓶' })]);
  const currentCsv = csvText([[...columns],
    row({ 商品标题: '旧款控油蓬松洗发水 官方升级', 商品链接: 'https://example.com/relisted', 品牌: '旧牌', 规格: '500ml', 店铺: '新店', 条码: 'OLD001', 榜单数值: '120', 时间证据: '2026-09进入榜单', 类目: '洗发水', 价格: '42.9', 卖点原文: '控油 蓬松', 包装形式: '泵瓶', 营销方式: '直播' }),
    row({ 商品标题: '溪雾幽兰清爽蓬松洗发水', 商品链接: 'https://example.com/new', 品牌: '新牌', 规格: '500ml', 店铺: '新牌旗舰店', 条码: 'NEW001', 榜单数值: '100', 时间证据: '2026-09-01首批评价', 类目: '洗发水', 价格: '59.9', 卖点原文: '清爽蓬松 幽兰留香', 成分配方线索: '氨基酸表活，待配方核实', 包装形式: '泵瓶', 营销方式: '货架电商', 达人直播依赖: '低' })
  ]);
  const oldBatch = (await request(app, 'POST', '/api/market/batches', { batch: batch('历史榜单', '2025-05-01', '2025-05-31'), csv: oldCsv })).json() as Batch;
  assert.ok(oldBatch.id);
  const currentBatch = (await request(app, 'POST', '/api/market/batches', { batch: batch('九月新品榜', '2026-09-01', '2026-09-15'), csv: currentCsv })).json() as Batch;
  const entries = ((await request(app, 'GET', `/api/market/batches/${currentBatch.id}/entries`)).json().entries) as Array<Entry & { analysis: { signal: string } }>;
  const relisted = entries.find(item => item.data.barcode === 'OLD001')!;
  const fresh = entries.find(item => item.data.barcode === 'NEW001')!;
  assert.equal(relisted.analysis.signal, 'suspectedRelist');
  assert.equal(fresh.analysis.signal, 'firstSeen');

  const previewResponse = await request(app, 'POST', '/api/market/opportunity-preview', { batchId: currentBatch.id, entryIds: [relisted.id, fresh.id] });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = previewResponse.json() as OpportunityPreview;
  assert.deepEqual(preview.included.map(item => item.id), [fresh.id]);
  assert.deepEqual(preview.excluded.map(item => item.id), [relisted.id]);
  assert.ok(preview.keywords.some(item => item.sourceEntryIds.includes(fresh.id)));
  assert.equal((await request(app, 'POST', '/api/market/opportunity-preview', { batchId: oldBatch.id, entryIds: [fresh.id] })).statusCode, 409);

  const categories = (await request(app, 'GET', '/api/categories')).json() as Category[];
  const shampoo = categories.find(item => item.code === 'shampoo')!;
  const keywords = preview.keywords.slice(0, 5).map(({ term, sourceEntryIds }) => ({ term, sourceEntryIds }));
  const createdResponse = await request(app, 'POST', '/api/product-opportunities', { batchId: currentBatch.id, entryIds: [relisted.id, fresh.id], categoryId: shampoo.id, title: '幽兰清爽蓬松洗护机会', summary: '榜单中出现具备时间证据的清爽、蓬松与幽兰香型组合，老品换链接记录已排除。', status: 'READY', keywords, replicability: 'HIGH', replicabilityReason: '产品卖点、规格与普通泵瓶均有记录，营销依赖较低；配方仍需研发核实。', risks: ['配方线索未经研发确认'], missingEvidence: [] });
  assert.equal(createdResponse.statusCode, 201, createdResponse.body);
  const created = createdResponse.json() as ProductOpportunity;
  assert.equal(created.analysis.included.length, 1);
  assert.equal(created.analysis.excluded.length, 1);
  assert.equal(created.linkedProjectCount, 0);
  assert.ok(store.db.prepare('SELECT id FROM market_evidence WHERE id=?').get(created.evidenceId));
  assert.equal(Number(store.db.prepare("SELECT count(*) count FROM opportunity_entries WHERE opportunity_id=? AND role='SUPPORTING'").get(created.id)!.count), 1);

  const projectResponse = await request(app, 'POST', '/api/product-projects', { projectType: 'NEW_PRODUCT', categoryId: shampoo.id, name: '幽兰洗护产品项目', objective: '验证榜单机会', positioning: '清爽蓬松香氛洗护', constraints: [], notes: '' });
  assert.equal(projectResponse.statusCode, 201, projectResponse.body);
  const projectId = (projectResponse.json().project as ProductProject).id;
  const attached = await request(app, 'POST', `/api/product-projects/${projectId}/opportunities`, { opportunityId: created.id, note: '由九月新品榜机会加入项目' });
  assert.equal(attached.statusCode, 201, attached.body);
  assert.equal((await request(app, 'POST', `/api/product-projects/${projectId}/opportunities`, { opportunityId: created.id, note: '重复加入' })).statusCode, 200);
  const detail = (await request(app, 'GET', `/api/product-projects/${projectId}`)).json() as ProjectDetail;
  assert.ok(detail.evidence.some(item => item.id === created.evidenceId));
  assert.equal(detail.events.filter(item => item.eventType === 'OPPORTUNITY_LINKED').length, 1);
  assert.equal(((await request(app, 'GET', '/api/product-opportunities')).json() as ProductOpportunity[])[0]!.linkedProjectCount, 1);
  const key = crypto.randomUUID();
  const projectBody = { projectType: 'NEW_PRODUCT', name: '清爽蓬松机会新项目', scope: '验证当前样本中的洗发水机会，配方与功效尚待确认' };
  const createFromOpportunity = (body: object, idempotencyKey = key) => app.inject({ method: 'POST', url: `/api/product-opportunities/${created.id}/projects`, headers: { ...headers, 'idempotency-key': idempotencyKey }, payload: body });
  assert.equal((await createFromOpportunity({ ...projectBody, categoryId: crypto.randomUUID() })).statusCode, 409);
  const fromOpportunity = await createFromOpportunity(projectBody);
  assert.equal(fromOpportunity.statusCode, 201, fromOpportunity.body);
  const newProjectId = fromOpportunity.json().projectId as string;
  const repeated = await createFromOpportunity(projectBody);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().projectId, newProjectId);
  assert.equal((await createFromOpportunity({ ...projectBody, name: '不同项目名称' })).statusCode, 409);
  const newDetail = (await request(app, 'GET', `/api/product-projects/${newProjectId}`)).json() as ProjectDetail;
  assert.equal(newDetail.project.categoryId, shampoo.id);
  assert.equal(newDetail.project.brief.objective, projectBody.scope);
  assert.equal(newDetail.project.brief.positioning, '');
  assert.equal(newDetail.evidence.filter(item => item.id === created.evidenceId).length, 1);
  assert.equal(newDetail.events.filter(item => item.eventType === 'OPPORTUNITY_LINKED').length, 1);
  assert.equal(newDetail.events.filter(item => item.eventType === 'PROJECT_CREATED').length, 1);
  const opportunityAfter = (await request(app, 'GET', `/api/product-opportunities/${created.id}`)).json() as ProductOpportunity;
  assert.equal(opportunityAfter.status, 'READY');
  assert.deepEqual(new Set(opportunityAfter.linkedProjects.map(item => item.id)), new Set([projectId, newProjectId]));
  assert.equal((await createFromOpportunity(projectBody, crypto.randomUUID())).statusCode, 201);
  const draftResponse = await request(app, 'POST', '/api/product-opportunities', { batchId: currentBatch.id, entryIds: [fresh.id], categoryId: shampoo.id, title: '待审核机会', summary: '尚未审核的样本判断', status: 'DRAFT', keywords, replicability: 'UNKNOWN', replicabilityReason: '', risks: [], missingEvidence: [] });
  assert.equal(draftResponse.statusCode, 201, draftResponse.body);
  const draftId = (draftResponse.json() as ProductOpportunity).id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/product-opportunities/${draftId}/projects`, headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, payload: projectBody })).statusCode, 409);
  assert.equal((await request(app, 'POST', `/api/product-opportunities/${created.id}/review`, { decision: 'APPROVED', reviewer: '测试', note: '再次审核' })).statusCode, 409);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
});
