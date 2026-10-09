import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { Store } from '../apps/server/store.js';
import { Tasks } from '../apps/server/tasks.js';
import { executeExport } from '../apps/server/export-worker.js';
import { uploadAsset } from '../apps/server/media.js';
import { createPages, type ProductInput } from '../packages/contracts/domain.js';
import { createApp } from '../apps/server/app.js';

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'task-engine-')), store = new Store(directory), tasks = new Tasks(store);
  const input: ProductInput = { name: '后台任务测试商品', brand: '测试', variant: '', specification: '100ml', audience: '', origin: '', notes: '', claims: [] };
  const product = store.createProduct(input);
  const asset = await uploadAsset(store, product.id, await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ddeeff' } }).png().toBuffer(), 'test.png', '测试专用');
  const pages = createPages(product, 12, asset.id).map((p, index) => ({ ...p, templateId: 'D12', headline: '测试标题' + index, body: '测试说明' + index, copyStatus: 'confirmed' as const, reviewed: true }));
  const kit = store.createKit(product.id, { name: '后台导出', productVersion: 1, pages });
  const body = { kitVersion: 1, operation: 'export' as const, pageIds: pages.map(p => p.id) };
  return { directory, store, tasks, product, kit, body };
}

test('提交幂等先于版本检查，固定快照不随商品修改；不同输入同键冲突', async t => {
  const { store, tasks, kit, body, product } = await setup(); t.after(() => store.close());
  const key = randomUUID(), first = tasks.submit(kit.id, body, key);
  store.saveKit(kit.id, 1, { name: '新名称', productVersion: 1, pages: kit.pages });
  assert.equal(tasks.submit(kit.id, body, key).id, first.id);
  assert.throws(() => tasks.submit(kit.id, { ...body, kitVersion: 2 }, key), /同一提交/);
  store.saveProduct(product.id, 1, { ...product, name: '更新商品' });
  const lease = tasks.claim('worker')!; assert.equal(lease.snapshot.product.name, '后台任务测试商品');
  await executeExport(tasks, lease);
  assert.equal(tasks.info(first.id).state, 'succeeded');
  const files = unzipSync(await readFile(join(store.directory, store.exportPath(lease.exportId))));
  assert.equal(JSON.parse(strFromU8(files['design.json']!)).product.version, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM usage_ledger').get()!.n, 0);
});

test('执行中开新连接不改状态；租约过期才能接管，旧代次不能登记失败', async t => {
  const { directory, store, tasks, kit, body } = await setup(); t.after(() => store.close());
  const job = tasks.submit(kit.id, body, randomUUID()), first = tasks.claim('first')!;
  const other = new Store(directory); t.after(() => other.close());
  assert.equal(new Tasks(other).claim('second'), null);
  assert.equal(tasks.info(job.id).tasks[0]!.state, 'running');
  store.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(first.id);
  const second = new Tasks(other).claim('second')!;
  assert.equal(second.epoch, first.epoch + 1); assert.equal(tasks.owns(first), false);
  tasks.fail(first, new Error('stale')); assert.equal(tasks.info(job.id).tasks[0]!.state, 'running');
  await assert.rejects(executeExport(tasks, first), /其他执行进程/);
  await executeExport(new Tasks(other), second); assert.equal(tasks.info(job.id).state, 'succeeded');
});

test('第8页中断后重启复用页面；ZIP写完但登记失败时复用同一文件', async t => {
  const { directory, store, tasks, kit, body } = await setup();
  const job = tasks.submit(kit.id, body, randomUUID()), lease = tasks.claim('first')!;
  await assert.rejects(executeExport(tasks, lease, async (stage, n) => { if (stage === 'page_saved' && n === 8) throw new Error('crash'); }), /crash/);
  const pagePaths = store.db.prepare("SELECT output_key,relative_path FROM artifacts WHERE task_id=? AND kind='page'").all(lease.id);
  assert.equal(pagePaths.length, 8); store.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(lease.id); store.close();
  const reopened = new Store(directory), recoveredTasks = new Tasks(reopened); t.after(() => reopened.close());
  const next = recoveredTasks.claim('second')!;
  await assert.rejects(executeExport(recoveredTasks, next, async stage => { if (stage === 'before_commit') throw new Error('database unavailable'); }), /database unavailable/);
  for (const row of pagePaths) assert.equal(reopened.db.prepare('SELECT relative_path FROM artifacts WHERE task_id=? AND output_key=?').get(lease.id, String(row.output_key))!.relative_path, row.relative_path);
  const descriptor = JSON.parse(String(reopened.db.prepare('SELECT response_descriptor FROM task_attempts WHERE id=?').get(next.attemptId)!.response_descriptor));
  recoveredTasks.fail(next, new Error('database unavailable'));
  const resumeKey = randomUUID(); recoveredTasks.resume(next.id, resumeKey); recoveredTasks.resume(next.id, resumeKey);
  const final = recoveredTasks.claim('third')!; await executeExport(recoveredTasks, final);
  assert.equal(reopened.exportPath(final.exportId), descriptor.archive.path);
  assert.equal(recoveredTasks.info(job.id).state, 'succeeded');
  assert.equal(Object.keys(unzipSync(await readFile(join(directory, reopened.exportPath(final.exportId))))).length, 19);
});

test('文件已完成但页面记录未保存，恢复根据持久描述复用文件', async t => {
  const { store, tasks, kit, body } = await setup(); t.after(() => store.close());
  tasks.submit(kit.id, body, randomUUID()); const first = tasks.claim('first')!;
  await assert.rejects(executeExport(tasks, first, async (stage, count) => { if (stage === 'file_finalized' && count === 1) throw new Error('crash'); }));
  const manifest = JSON.parse(String(store.db.prepare('SELECT response_descriptor FROM task_attempts WHERE id=?').get(first.attemptId)!.response_descriptor));
  store.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(first.id);
  await executeExport(tasks, tasks.claim('second')!);
  assert.equal(store.db.prepare("SELECT relative_path FROM artifacts WHERE task_id=? AND output_key='main/01.png'").get(first.id)!.relative_path, manifest['main/01.png'].path);
});

test('排队取消阻止领取，已领取任务不能伪装取消，生成能力不创建空任务', async t => {
  const { store, tasks, kit, body } = await setup(); t.after(() => store.close());
  const first = tasks.submit(kit.id, body, randomUUID()); assert.equal(tasks.cancel(first.id).cancelledIds.length, 1); assert.equal(tasks.claim('worker'), null);
  const second = tasks.submit(kit.id, body, randomUUID()); tasks.claim('worker');
  assert.equal(tasks.cancel(second.id).uncancelledIds.length, 1);
  assert.throws(() => tasks.submit(kit.id, { ...body, operation: 'image', imageMode: 'draft' }, randomUUID()), /尚未接入/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get()!.n, 2);
});

test('任务接口分页、幂等、状态读取和未完成下载保护', async t => {
  const { directory, store, kit, body } = await setup(); store.close();
  const { app } = await createApp(directory); t.after(() => app.close());
  const headers = { host: '127.0.0.1:4380', 'idempotency-key': randomUUID() };
  const first = await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/jobs`, headers, payload: body }); assert.equal(first.statusCode, 202);
  const duplicate = await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/jobs`, headers, payload: body }); assert.equal(first.json().id, duplicate.json().id);
  const download = await app.inject({ method: 'GET', url: `/api/exports/${first.json().tasks[0].exportId}/download`, headers }); assert.equal(download.statusCode, 404);
  await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/jobs`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: body });
  const list = (await app.inject({ method: 'GET', url: '/api/jobs?limit=1', headers })).json(); assert.equal(list.items.length, 1); assert.ok(list.nextCursor);
  const page2 = (await app.inject({ method: 'GET', url: `/api/jobs?limit=1&cursor=${list.nextCursor}`, headers })).json(); assert.notEqual(list.items[0].id, page2.items[0].id);
  assert.equal((await app.inject({ method: 'POST', url: `/api/kits/${kit.id}/exports`, headers, payload: { version: 1 } })).statusCode, 404);
});

test('版本2迁移完整备份，六张表冲突则全部回滚', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'task-migration-')), path = join(directory, 'workbench.sqlite');
  const db = new DatabaseSync(path); db.exec("CREATE TABLE exports (state TEXT,error TEXT); INSERT INTO exports VALUES ('running',NULL); PRAGMA user_version=2;"); db.close();
  const store = new Store(directory); assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 3);
  assert.equal(store.db.prepare('SELECT state FROM exports').get()!.state, 'failed'); store.close();
  const file = (await readdir(directory)).find(f => f.startsWith('before-tasks-'))!;
  const backup = new DatabaseSync(join(directory, file)); assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 2); assert.equal(backup.prepare('SELECT state FROM exports').get()!.state, 'running'); backup.close();
  const brokenDir = await mkdtemp(join(tmpdir(), 'task-rollback-')), brokenPath = join(brokenDir, 'workbench.sqlite');
  const broken = new DatabaseSync(brokenPath); broken.exec('CREATE TABLE tasks (original TEXT); PRAGMA user_version=2;'); broken.close();
  assert.throws(() => new Store(brokenDir));
  const check = new DatabaseSync(brokenPath); assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 2); assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='jobs'").get()!.n, 0); check.close();
});

test('独立 worker 进程在提交端关闭后完成真实导出', async t => {
  const { directory, store, tasks, kit, body } = await setup();
  const job = tasks.submit(kit.id, body, randomUUID()); store.close();
  const working = await mkdtemp(join(tmpdir(), 'worker-process-'));
  await cp(directory, join(working, '.runtime'), { recursive: true });
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../apps/server/worker.ts', import.meta.url))], { cwd: working, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  assert.ok(child.stderr); let output = ''; child.stderr.on('data', b => { output += String(b); });
  t.after(() => { child.kill(); });
  const check = new Store(join(working, '.runtime')); t.after(() => check.close());
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && new Tasks(check).info(job.id).state === 'active' && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(new Tasks(check).info(job.id).state, 'succeeded', output);
  const id = new Tasks(check).info(job.id).tasks[0]!.exportId!;
  assert.equal(Object.keys(unzipSync(await readFile(join(working, '.runtime', check.exportPath(id))))).length, 19);
  child.disconnect();
});
