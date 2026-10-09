import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../apps/server/app.js';
import { Store } from '../apps/server/store.js';
import { uploadAsset } from '../apps/server/media.js';
import { Tasks } from '../apps/server/tasks.js';
import { runOne } from '../apps/server/export-worker.js';
import { createPages, kitInputSchema, normalizeReviews, type ProductInput } from '../packages/contracts/domain.js';
import { renderSvg, layoutIssues } from '../packages/contracts/render.js';

const productData = (): ProductInput => ({ name: '测试商品', brand: 'TEST', variant: '测试系列', specification: '500ml', audience: '', origin: '', notes: '', claims: [{ id: randomUUID(), label: '测试卖点', text: '仅用于软件验证的测试信息', source: '自动化测试', status: 'provided' }] });
const headers = { host: '127.0.0.1:4380', origin: 'http://127.0.0.1:4380' };
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'commerce-test-')); return { ...await createApp(directory), directory }; }
const image = () => sharp({ create: { width: 120, height: 120, channels: 3, background: '#d5e8ef' } }).png().toBuffer();

test('套图结构固定 5 张主图并支持 11–20 张详情，不接受重复页面或错误数量', () => {
  const p = productData();
  for (const count of [11, 12, 20]) { const pages = createPages(p, count); assert.equal(pages.filter(p => p.kind === 'main').length, 5); assert.equal(kitInputSchema.parse({ name: '测试', productVersion: 1, pages }).pages.length, count + 5); }
  const pages = createPages(p);
  assert.throws(() => kitInputSchema.parse({ name: '测试', productVersion: 1, pages: pages.slice(1) }));
  pages[1]!.id = pages[0]!.id;
  assert.throws(() => kitInputSchema.parse({ name: '测试', productVersion: 1, pages }));
});

test('排版检查阻止长文案溢出，SVG 转义文字内容', () => {
  const page = createPages(productData())[0]!;
  page.headline = '<script>alert(1)</script>';
  const svg = renderSvg(page, productData(), null);
  assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&lt;script&gt;'));
  page.headline = '长'.repeat(36); page.body = '正文'.repeat(90);
  assert.ok(layoutIssues(page).length >= 2);
});

test('只修改审核状态可以通过；更改内容、商品版本或新增页会清除审核', () => {
  const input = { name: '测试', productVersion: 1, pages: createPages(productData()) };
  const old = { ...input, id: randomUUID(), productId: randomUUID(), version: 1, updatedAt: '' };
  const next = structuredClone(input); next.pages[0]!.reviewed = true;
  assert.equal(normalizeReviews(next, old).pages[0]!.reviewed, true);
  next.pages[0]!.headline = '修改内容'; assert.equal(normalizeReviews(next, old).pages[0]!.reviewed, false);
  assert.ok(normalizeReviews({ ...input, productVersion: 2 }, old).pages.every(p => !p.reviewed));
});

test('商品 API 真正持久化并防止旧版本覆盖，额外字段不接受', async t => {
  const { app, store, directory } = await setup();
  const body = productData();
  const result = await app.inject({ method: 'POST', url: '/api/products', headers, payload: body });
  assert.equal(result.statusCode, 201);
  const product = result.json();
  const responses = await Promise.all(['A', 'B'].map(name => app.inject({ method: 'PUT', url: `/api/products/${product.id}`, headers, payload: { baseVersion: 1, data: { ...body, name } } })));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  const invalid = await app.inject({ method: 'POST', url: '/api/products', headers, payload: { ...body, secret: 'not-a-real-secret' } });
  assert.equal(invalid.statusCode, 400); assert.ok(!invalid.body.includes('not-a-real-secret'));
  assert.equal(store.product(product.id, 1).name, body.name);
  await app.close();
  const reopened = new Store(directory); t.after(() => reopened.close());
  assert.equal(reopened.product(product.id).version, 2);
});

test('拒绝跨站访问、伪造 Host，不在响应中泄露内部路径', async t => {
  const { app } = await setup(); t.after(() => app.close());
  for (const bad of [{ host: 'evil.test' }, { ...headers, origin: 'https://evil.test' }, { ...headers, 'sec-fetch-site': 'cross-site' }]) {
    const result = await app.inject({ method: 'GET', url: '/api/products', headers: bad }); assert.equal(result.statusCode, 403);
  }
  const missing = await app.inject({ method: 'GET', url: `/api/assets/${randomUUID()}/content`, headers });
  assert.equal(missing.statusCode, 404); assert.ok(!missing.body.includes('commerce-test-'));
});

test('静态图片完整解码校验，拒绝 SVG 和损坏文件，保存原图字节', async t => {
  const { app, store, directory } = await setup(); t.after(() => app.close());
  const product = store.createProduct(productData());
  await assert.rejects(uploadAsset(store, product.id, Buffer.from('<svg/>'), 'image.png', '测试'), /请选择完整/);
  await assert.rejects(uploadAsset(store, product.id, Buffer.from([137, 80, 78, 71]), 'bad.png', '测试'), /请选择完整/);
  const buffer = await image(), asset = await uploadAsset(store, product.id, buffer, 'test.png', '测试');
  assert.equal(asset.mime, 'image/png'); assert.equal(asset.width, 120);
  assert.deepEqual(await readFile(join(directory, store.asset(asset.id).path)), buffer);
  const served = await app.inject({ method: 'GET', url: `/api/assets/${asset.id}/content`, headers });
  assert.deepEqual(served.rawPayload, buffer);
});

test('不允许跨商品素材、失效卖点引用和缺失内容通过审核', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  const p = store.createProduct(productData()), other = store.createProduct(productData());
  const asset = await uploadAsset(store, other.id, await image(), 'other.png', '测试');
  const initial = { name: '测试', productVersion: 1, pages: createPages(p) }, kit = store.createKit(p.id, initial);
  const changed = structuredClone(initial); changed.pages[0]!.assetId = asset.id;
  let r = await app.inject({ method: 'PUT', url: `/api/kits/${kit.id}`, headers, payload: { baseVersion: 1, data: changed } });
  assert.equal(r.statusCode, 400); assert.equal(r.json().error.code, 'ASSET_OWNERSHIP');
  changed.pages[0]!.assetId = null; changed.pages[0]!.claimIds = [randomUUID()];
  r = await app.inject({ method: 'PUT', url: `/api/kits/${kit.id}`, headers, payload: { baseVersion: 1, data: changed } });
  assert.equal(r.json().error.code, 'CLAIM_REFERENCE');
  initial.pages[0]!.reviewed = true;
  r = await app.inject({ method: 'PUT', url: `/api/kits/${kit.id}`, headers, payload: { baseVersion: 1, data: initial } });
  assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'REVIEW_REQUIRED');
  const ownAsset = await uploadAsset(store, p.id, await image(), 'own.png', '测试');
  const draft = structuredClone(initial);
  draft.pages[0] = { ...draft.pages[0]!, assetId: ownAsset.id, templateId: 'D12', headline: '测试商品', reviewed: true, copyStatus: 'draft' };
  store.saveKit(kit.id,1,{ ...draft,pages:draft.pages.map(page=>({...page,reviewed:false})) });
  r = await app.inject({ method:'PUT', url:`/api/kits/${kit.id}`, headers, payload:{baseVersion:2,data:draft} });
  assert.equal(r.statusCode,409);
  assert.match(r.json().error.message,/文案尚未人工确认/);
});

test('multipart 上传检查来源与使用权确认，并保存真实文件', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  const p = store.createProduct(productData()), buffer = await image();
  const boundary = 'commerce-test-boundary';
  const upload = (rights: string) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nTest source\r\n--${boundary}\r\nContent-Disposition: form-data; name="rights"\r\n\r\n${rights}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
    buffer, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const options = { method: 'POST' as const, url: `/api/products/${p.id}/assets`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` } };
  const denied = await app.inject({ ...options, payload: upload('') }); assert.equal(denied.statusCode, 400); assert.equal(store.listAssets(p.id).length, 0);
  const accepted = await app.inject({ ...options, payload: upload('confirmed') }); assert.equal(accepted.statusCode, 201, accepted.body); assert.equal(store.listAssets(p.id).length, 1);
});

test('设计稿 API 冲突保护，恢复旧版本产生新版本且不自动审核', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  const p = store.createProduct(productData());
  const created = await app.inject({ method: 'POST', url: `/api/products/${p.id}/kits`, headers, payload: { name: '测试套图', detailCount: 12 } });
  assert.equal(created.statusCode, 201); const kit = created.json();
  const data = { name: '已修改', productVersion: 1, pages: kit.pages };
  let r = await app.inject({ method: 'PUT', url: `/api/kits/${kit.id}`, headers, payload: { baseVersion: 1, data } }); assert.equal(r.statusCode, 200);
  r = await app.inject({ method: 'PUT', url: `/api/kits/${kit.id}`, headers, payload: { baseVersion: 1, data } }); assert.equal(r.statusCode, 409);
  r = await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/restore`, headers, payload: { version: 1, baseVersion: 2 } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().version, 3); assert.equal(r.json().name, '测试套图'); assert.ok(r.json().pages.every((p: { reviewed: boolean }) => !p.reviewed));
  assert.equal(store.kit(kit.id, 2).name, '已修改');
});

test('未配置 AI 返回真实错误，不创建生成结果或费用', async t => {
  const { app, store } = await setup(); t.after(() => app.close());
  const result = await app.inject({ method: 'POST', url: '/api/ai/image', headers, payload: {} });
  assert.equal(result.statusCode, 503); assert.equal(result.json().error.code, 'CONFIGURATION_MISSING'); assert.equal(store.exports().length, 0);
  const connections = await app.inject({ method: 'GET', url: '/api/connections', headers }); assert.ok(!connections.body.includes('API_KEY'));
});

test('真实批量导出包含 5+12 张指定尺寸 PNG，版本与文件可在备份恢复后访问', async t => {
  const { app, store, directory } = await setup();
  const p = store.createProduct(productData()), asset = await uploadAsset(store, p.id, await image(), 'test.png', '测试');
  const pages = createPages(p, 12, asset.id).map((page, index) => ({ ...page, templateId: 'D12', headline: '测试标题' + index, body: '测试说明' + index, copyStatus: 'confirmed' as const, reviewed: true }));
  const kit = store.createKit(p.id, { name: '导出测试', productVersion: 1, pages });
  const r = await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/jobs`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { kitVersion: 1, operation: 'export', pageIds: kit.pages.map(p => p.id) } });
  assert.equal(r.statusCode, 202, r.body); const id = r.json().tasks[0].exportId;
  await runOne(new Tasks(store), 'test-worker');
  const download = await app.inject({ method: 'GET', url: `/api/exports/${id}/download`, headers }); assert.equal(download.statusCode, 200);
  const files = unzipSync(download.rawPayload);
  assert.equal(Object.keys(files).filter(p => p.startsWith('main/')).length, 5); assert.equal(Object.keys(files).filter(p => p.startsWith('detail/')).length, 12);
  const main = await sharp(files['main/01.png']!).metadata(), detail = await sharp(files['detail/12.png']!).metadata();
  assert.deepEqual([main.width, main.height, detail.width, detail.height], [1080, 1080, 1080, 1440]);
  assert.equal(JSON.parse(strFromU8(files['design.json']!)).kit.version, 1);
  store.saveProduct(p.id, 1, { ...productData(), name: '资料已更新' });
  assert.throws(() => new Tasks(store).submit(kit.id, { kitVersion: 1, operation: 'export', pageIds: kit.pages.map(p => p.id) }, randomUUID()), /商品资料已更新/);
  await app.close();
  const backup = await mkdtemp(join(tmpdir(), 'commerce-restore-')); await cp(directory, join(backup, 'data'), { recursive: true });
  const restored = new Store(join(backup, 'data')); t.after(() => restored.close());
  assert.equal(restored.kit(kit.id).pages.length, 17); assert.equal(restored.product(p.id).version, 2); assert.ok((await readFile(join(backup, 'data', restored.exportPath(id)))).length > 0);
});

test('未审核导出被阻止，打开其他连接不会误改现有导出状态', async t => {
  const { app, store, directory } = await setup();
  const p = store.createProduct(productData()), kit = store.createKit(p.id, { name: '未完成', productVersion: 1, pages: createPages(p) });
  const r = await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/jobs`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { kitVersion: 1, operation: 'export', pageIds: kit.pages.map(p => p.id) } }); assert.equal(r.statusCode, 409); assert.equal(store.exports().length, 0);
  const record = store.startExport(kit); await app.close();
  const reopened = new Store(directory); t.after(() => reopened.close());
  const recovered = reopened.exports().find(r => r.id === record.id)!; assert.equal(recovered.state, 'running'); assert.equal(recovered.error, null);
});
