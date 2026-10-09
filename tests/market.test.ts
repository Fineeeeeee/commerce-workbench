import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../apps/server/app.js';
import { Store } from '../apps/server/store.js';
import { parseMarketCsv, columns, csvText, candidateReason, analyzeMarketEntry, type Entry } from '../packages/contracts/market.js';

const batch = { name: '测试榜单', source: '测试提供方', platform: '测试平台', periodStart: '2026-08-01', periodEnd: '2026-08-31', metricName: '销量', metricUnit: '件' };
const firstRow = ['测试商品', 'https://example.com/product', '品牌', '500ml', '店铺', '12345', '90', '2025年已售（测试资料）', '洗发水', '49.9', '控油蓬松', '氨基酸', '泵瓶', '淘宝直播', '中'];
const secondRow = ['另一商品', '', '品牌', '300ml', '另一店', '', '10', '', '洗发水', '', '', '', '', '', ''];
const csv = csvText([[...columns], firstRow, secondRow]);
const headers = { host: '127.0.0.1:4380' };

test('榜单 CSV 支持引号、换行及 BOM；拒绝错误字段与无效数值，导出防公式执行', () => {
  assert.equal(parseMarketCsv(csv).length, 2);
  assert.equal(parseMarketCsv(csvText([[...columns], ['多行\n标题', '', '品牌', '', '', '123', '1', '', '', '', '', '', '', '', '']]))[0]!.data.title, '多行\n标题');
  assert.throws(() => parseMarketCsv(csvText([[...columns], [...firstRow.slice(0, 6), 'NaN', ...firstRow.slice(7)]])));
  assert.throws(() => parseMarketCsv(csv.replace('商品标题', '标题')));
  assert.throws(() => parseMarketCsv(`${columns.join(',')}\n"未闭合`));
  assert.match(csvText([[' =HYPERLINK("x")']]), /' =HYPERLINK/);
  const a = parseMarketCsv(csv)[0]!.data;
  assert.match(candidateReason(a, { ...a, url: '', shop: '换店' })!, /条码/);
  assert.equal(candidateReason(a, { ...a, barcode: '', url: '', title: '另一个标题' }), null);
  const relisted = { ...a, barcode: '', url: 'https://example.com/new-link', shop: '新店铺', title: '官方新品 测试商品 正品热卖' };
  assert.match(candidateReason(relisted, { ...a, barcode: '', url: 'https://example.com/old-link', shop: '历史店铺' })!, /店铺不同/);
  assert.equal(analyzeMarketEntry({ id: 'entry', batchId: 'batch', rowNumber: 2, raw: [], data: relisted, reviews: [] }, [{ entryId: 'old', batchId: 'old-batch', title: a.title, shop: a.shop, reason: '疑似同款' }]).signal, 'suspectedRelist');
});

test('市场研究预览不落库，整批保存、关联核对、过滤导出与重启后历史可追溯', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'market-test-'));
  let { app } = await createApp(directory);
  const request = (method: 'GET' | 'POST', url: string, payload?: unknown) => app.inject({ method, url, headers, ...(payload ? { payload: payload as object } : {}) });
  try {
    assert.equal((await request('POST', '/api/market/preview', { batch, csv })).statusCode, 200);
    assert.equal((await request('GET', '/api/market/batches')).json().length, 0);
    assert.equal((await request('POST', '/api/market/batches', { batch, csv: csv + '\nbad' })).statusCode, 400);
    assert.equal((await request('GET', '/api/market/batches')).json().length, 0);
    const first = (await request('POST', '/api/market/batches', { batch, csv })).json();
    const second = (await request('POST', '/api/market/batches', { batch: { ...batch, name: '第二批' }, csv })).json();
    const entries: Entry[] = (await request('GET', `/api/market/batches/${second.id}/entries`)).json().entries;
    assert.equal(entries[0]!.data.value, 90);
    const id = entries[0]!.id;
    const candidates = (await request('GET', `/api/market/entries/${id}/candidates`)).json();
    assert.equal(candidates[0].batch.id, first.id);
    const review = { relatedEntryId: candidates[0].entry.id, verdict: 'old', reason: '历史记录已有售卖证据', evidence: '2025年记录，仅测试', reviewer: '测试确认人' };
    assert.equal((await request('POST', `/api/market/entries/${id}/reviews`, { ...review, relatedEntryId: id })).statusCode, 400);
    assert.equal((await request('POST', `/api/market/entries/${id}/reviews`, review)).statusCode, 201);
    await request('POST', `/api/market/entries/${id}/reviews`, { ...review, verdict: 'unknown', reason: '需要进一步确认' });
    assert.equal((await request('GET', `/api/market/batches/${second.id}/entries?verdict=old`)).json().entries.length, 0);
    const exported = await request('GET', `/api/market/batches/${second.id}/export?verdict=unknown`);
    assert.match(exported.body, /测试提供方/); assert.match(exported.body, /需要进一步确认/); assert.ok(!exported.body.includes('另一商品'));
    await app.close(); ({ app } = await createApp(directory));
    const restored: Entry = (await request('GET', `/api/market/batches/${second.id}/entries?verdict=unknown`)).json().entries[0];
    assert.equal(restored.reviews.length, 2); assert.equal(restored.raw[7], '2025年已售（测试资料）');
  } finally { await app.close(); }
});

test('版本1迁移保留已有数据，备份可独立打开；重复启动不重复备份', () => {
  const directory = mkdtempSync(join(tmpdir(), 'market-migration-'));
  const db = new DatabaseSync(join(directory, 'workbench.sqlite'));
  db.exec("CREATE TABLE exports (state TEXT, error TEXT); CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('original'); PRAGMA user_version=1;"); db.close();
  const store = new Store(directory);
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.equal(store.db.prepare('SELECT value FROM preserved').get()!.value, 'original'); store.close();
  const backup = readdirSync(directory).find(f => f.startsWith('before-market-'))!;
  const original = new DatabaseSync(join(directory, backup), { readOnly: true });
  assert.equal(original.prepare('PRAGMA user_version').get()!.user_version, 1);
  assert.equal(original.prepare('SELECT value FROM preserved').get()!.value, 'original'); original.close();
  new Store(directory).close();
  assert.equal(readdirSync(directory).filter(f => f.startsWith('before-market-')).length, 1);
});

test('迁移发生表冲突时回滚，不留下部分新结构或推进版本', () => {
  const directory = mkdtempSync(join(tmpdir(), 'market-rollback-'));
  const path = join(directory, 'workbench.sqlite');
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE market_entries (original TEXT); INSERT INTO market_entries VALUES ('kept'); PRAGMA user_version=1;"); db.close();
  assert.throws(() => new Store(directory));
  const check = new DatabaseSync(path);
  assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 1);
  assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='market_batches'").get()!.n, 0);
  assert.equal(check.prepare('SELECT original FROM market_entries').get()!.original, 'kept');
  check.close();
});
