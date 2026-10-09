import { test, type TestContext } from 'node:test';
import { mkdtempSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Provider fixtures must not read the developer's persisted model selections.
process.chdir(mkdtempSync(join(tmpdir(), 'copy-model-fixtures-')));
import { randomUUID } from 'node:crypto';
import { Store, AppError } from '../apps/server/store.js';
import { Tasks } from '../apps/server/tasks.js';
import { createPages, type ProductInput } from '../packages/contracts/domain.js';
import { copyFacts, validateCopy } from '../packages/contracts/copy.js';
import { copyProfile, requestCopy, type CopyResponse } from '../apps/server/copy-provider.js';
import { executeCopy, candidates, adoptCopy, reconcileCopy } from '../apps/server/copy-service.js';

function testConfiguration(t: TestContext) {
  const values = { COMMERCE_COPY_MODEL: 'qwen3.7-flash', COMMERCE_COPY_ENABLED: '1', COMMERCE_BAILIAN_WORKSPACE_ID: 'test-workspace', DASHSCOPE_API_KEY: 'test-only-not-a-real-key' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}
async function setup(t: TestContext) {
  testConfiguration(t);
  const store = new Store(await mkdtemp(join(tmpdir(), 'copy-test-'))); t.after(() => store.close());
  const data: ProductInput = { name: '测试沐浴露', brand: '测试品牌', variant: '', specification: '500ml', audience: '', origin: '', notes: '内部备注不得发给模型', claims: [{ id: randomUUID(), label: '清爽', text: '洗后清爽', source: '测试确认资料', status: 'approved' }] };
  const product = store.createProduct(data), pages = createPages(product);
  pages[0]!.claimIds = [data.claims[0]!.id];
  const kit = store.createKit(product.id, { name: '测试文案', productVersion: 1, pages }), tasks = new Tasks(store);
  const body = { kitVersion: 1, operation: 'copy' as const, pageIds: [pages[0]!.id] };
  const copy = { headline: '测试沐浴露', subtitle: '500ml', body: '洗后清爽', evidenceIds: ['product.name', 'product.specification', `claim.${data.claims[0]!.id}`], notes: '软件测试候选' };
  const response: CopyResponse = { id: 'test-request', model: 'qwen3.7-flash', content: JSON.stringify(copy), finishReason: 'stop', usage: { input: 50, output: 20 } };
  return { store, tasks, product, kit, body, copy, response };
}

test('事实目录不发送内部备注或未核实卖点，拒绝伪造事实引用', async t => {
  const { product, kit, copy } = await setup(t);
  const facts = copyFacts({ ...product, claims: product.claims.map(c => ({ ...c, status: 'provided' })) }, kit.pages[0]!);
  assert.ok(!JSON.stringify(facts).includes('内部备注')); assert.ok(!facts.some(f => f.id.startsWith('claim.')));
  assert.throws(() => validateCopy({ ...copy, evidenceIds: ['claim.fake'] }, product, kit.pages[0]!));
  assert.throws(() => validateCopy({ ...copy, headline: '字'.repeat(37) }, product, kit.pages[0]!));
});

test('逐页生成候选不会修改设计稿；采用创建新版本，原稿与候选保留', async t => {
  const { store, tasks, product, kit, body, response, copy } = await setup(t);
  const job = tasks.submit(kit.id, body, randomUUID()), lease = tasks.claim('copy-test')!;
  let calls = 0;
  await executeCopy(tasks, lease, async (_profile, messages) => { calls++; assert.ok(!JSON.stringify(messages).includes('内部备注')); return response; });
  assert.equal(calls, 1); assert.equal(store.kit(kit.id).version, 1);
  assert.equal(tasks.info(job.id).usage.inputTokens, 50); assert.equal(tasks.info(job.id).usage.cost, null);
  const candidate = candidates(store, kit.id)[0]!; assert.equal(candidate.data.headline, copy.headline);
  const key = randomUUID(), input = { baseVersion: 1, artifactId: candidate.id, content: copy };
  const adopted = adoptCopy(store, kit.id, input, key);
  assert.equal(adopted.version, 2); assert.equal(adopted.pages[0]!.reviewed, false); assert.equal(adopted.pages[0]!.body, copy.body);
  assert.equal(adoptCopy(store, kit.id, input, key).version, 2);
  assert.throws(() => adoptCopy(store, kit.id, { ...input, content: { ...copy, headline: '不同内容' } }, key), /同一采用/);
  assert.equal(store.kit(kit.id, 1).pages[0]!.body, ''); assert.equal(candidates(store, kit.id).length, 1);
  store.saveProduct(product.id, 1, { ...product, specification: '600ml' });
  assert.throws(() => adoptCopy(store, kit.id, { ...input, baseVersion: 2 }, randomUUID()), /商品资料已变化/);
});

test('页面用途变化阻止旧候选采用；其他页面修改不使候选失效', async t => {
  const { store, tasks, kit, body, response, copy } = await setup(t);
  tasks.submit(kit.id, body, randomUUID());
  await executeCopy(tasks, tasks.claim('worker')!, async () => response);
  const candidate = candidates(store, kit.id)[0]!;
  const changed = store.saveKit(kit.id, 1, { name: kit.name, productVersion: 1, pages: kit.pages.map((p, i) => i === 0 ? { ...p, purpose: '使用步骤' } : p) });
  assert.throws(() => adoptCopy(store, kit.id, { baseVersion: changed.version, artifactId: candidate.id, content: copy }, randomUUID()), error => error instanceof AppError && error.code === 'PAGE_CHANGED');
  assert.equal(store.kit(kit.id).version, 2);
  const restoredPurpose = store.saveKit(kit.id, 2, { name: kit.name, productVersion: 1, pages: kit.pages.map((p, i) => i === 1 ? { ...p, purpose: '新的其他页用途' } : p) });
  const adopted = adoptCopy(store, kit.id, { baseVersion: restoredPurpose.version, artifactId: candidate.id, content: copy }, randomUUID());
  assert.equal(adopted.pages[1]!.purpose, '新的其他页用途');
  assert.equal(adopted.pages[0]!.body, copy.body);
});

test('未核实卖点阻止提交，单日数量限制在事务内检查', async t => {
  const { store, tasks, product, kit, body } = await setup(t);
  store.saveProduct(product.id, 1, { ...product, claims: product.claims.map(c => ({ ...c, status: 'pending' })) });
  const updated = store.saveKit(kit.id, 1, { name: kit.name, productVersion: 2, pages: kit.pages });
  assert.throws(() => tasks.submit(kit.id, { ...body, kitVersion: updated.version }, randomUUID()), /未核实/);
  store.saveProduct(product.id, 2, { ...product });
  const current = store.saveKit(kit.id, 2, { name: kit.name, productVersion: 3, pages: kit.pages });
  for (let i = 0; i < 20; i++) tasks.submit(kit.id, { ...body, kitVersion: current.version }, randomUUID());
  assert.throws(() => tasks.submit(kit.id, { ...body, kitVersion: current.version }, randomUUID()), /最多提交20页/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks').get()!.n, 20);
});

test('候选不能跨设计稿或跨商品采用，失败不会写入新版本', async t => {
  const { store, tasks, product, kit, body, response, copy } = await setup(t);
  tasks.submit(kit.id, body, randomUUID());
  await executeCopy(tasks, tasks.claim('worker')!, async () => response);
  const candidate = candidates(store, kit.id)[0]!;
  const otherProduct = store.createProduct({ ...product, name: '另一商品' });
  const targets = [store.createKit(product.id, { name: '另一设计稿', productVersion: 1, pages: createPages(product) }), store.createKit(otherProduct.id, { name: '其他商品设计稿', productVersion: 1, pages: createPages(otherProduct) })];
  for (const target of targets) {
    assert.throws(() => adoptCopy(store, target.id, { baseVersion: 1, artifactId: candidate.id, content: copy }, randomUUID()), /不属于当前设计稿/);
    assert.equal(store.kit(target.id).version, 1);
    assert.equal(candidates(store, target.id).length, 0);
  }
});

test('超时结果待核实且不自动重发，核对结果保留且不会伪造费用', async t => {
  const { store, tasks, kit, body } = await setup(t);
  const job = tasks.submit(kit.id, body, randomUUID()), lease = tasks.claim('worker')!; let calls = 0;
  try { await executeCopy(tasks, lease, async () => { calls++; throw new AppError('RESULT_UNCERTAIN', '测试超时'); }); } catch (e) { tasks.fail(lease, e); }
  assert.equal(tasks.info(job.id).state, 'needs_reconciliation'); assert.equal(tasks.claim('second'), null); assert.equal(calls, 1);
  assert.throws(() => tasks.resume(lease.id, randomUUID()), /不能恢复/);
  assert.throws(() => tasks.submit(kit.id, body, randomUUID()), /待核实/);
  const result = reconcileCopy(store, lease.id, { conclusion: 'completed_unretrievable', evidence: '测试人员检查模拟服务记录', reviewer: '测试确认人' });
  assert.equal(result.state, 'failed'); assert.equal(result.usage.cost, null);
  assert.equal(store.db.prepare('SELECT safe_error FROM task_attempts WHERE id=?').get(lease.attemptId)!.safe_error, JSON.stringify({ conclusion: 'completed_unretrievable', evidence: '测试人员检查模拟服务记录', reviewer: '测试确认人' }));
  assert.equal(tasks.claim('second'), null);
});

test('派发阶段崩溃不得重领；尚未外发的准备阶段允许恢复', async t => {
  const { store, tasks, kit, body } = await setup(t);
  tasks.submit(kit.id, body, randomUUID()); const preparing = tasks.claim('first')!;
  store.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(preparing.id);
  const dispatched = tasks.claim('second')!; assert.equal(dispatched.id, preparing.id);
  store.db.prepare("UPDATE task_attempts SET phase='dispatching' WHERE id=?").run(dispatched.attemptId);
  store.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(dispatched.id);
  assert.equal(tasks.claim('third'), null);
  assert.equal(tasks.info(dispatched.jobId).state, 'needs_reconciliation');
});

test('返回结果已存而候选保存失败，恢复只保存结果，不重复模型调用', async t => {
  const { store, tasks, kit, body, response } = await setup(t);
  tasks.submit(kit.id, body, randomUUID()); const first = tasks.claim('first')!; let calls = 0;
  store.db.exec("CREATE TEMP TRIGGER fail_candidate BEFORE INSERT ON artifacts BEGIN SELECT RAISE(ABORT,'test artifact save failure'); END;");
  try { await executeCopy(tasks, first, async () => { calls++; return response; }); } catch (e) { tasks.fail(first, e); }
  assert.equal(tasks.info(first.jobId).tasks[0]!.recoveryAction, 'resume_copy_save');
  store.db.exec('DROP TRIGGER fail_candidate;');
  tasks.resume(first.id, randomUUID()); const next = tasks.claim('second')!;
  await executeCopy(tasks, next, async () => { calls++; throw new Error('must not call'); });
  assert.equal(calls, 1); assert.equal(candidates(store, kit.id).length, 1);
  assert.equal(tasks.info(first.jobId).usage.outputTokens, 20);
});

test('无效或截断输出不成为候选，仍保留返回用量', async t => {
  const { tasks, kit, body, response, store } = await setup(t);
  tasks.submit(kit.id, body, randomUUID()); const lease = tasks.claim('worker')!;
  try { await executeCopy(tasks, lease, async () => ({ ...response, finishReason: 'length' })); } catch (e) { tasks.fail(lease, e); }
  assert.equal(candidates(store, kit.id).length, 0);
  assert.equal(tasks.info(lease.jobId).state, 'failed'); assert.equal(tasks.info(lease.jobId).tasks[0]!.recoveryAction, null);
  assert.equal(tasks.info(lease.jobId).usage.outputTokens, 20);
});

test('百炼适配器只请求固定地域域名、严格解析结果、不重试不泄露错误正文', async t => {
  testConfiguration(t); const profile = copyProfile()!; let calls = 0;
  const reply = { id: 'test-request', model: 'qwen3.7-flash', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
  const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(String(url), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'); const body = JSON.parse(String(init?.body)); assert.deepEqual(Object.keys(body).sort(), ['messages', 'model']); assert.equal(body.model, 'qwen3.7-flash'); assert.equal(init?.redirect, 'error'); return new Response(JSON.stringify(reply)); };
  assert.equal((await requestCopy(profile, [{ role: 'user', content: 'JSON' }], fetcher)).usage?.input, 3);
  assert.equal(calls, 1);
  await assert.rejects(requestCopy(profile, [], async () => new Response('sensitive provider diagnostics', { status: 401 })), error => error instanceof AppError && error.code === 'PROVIDER_REJECTED' && !error.message.includes('sensitive'));
  await assert.rejects(requestCopy(profile, [], async () => new Response(JSON.stringify({ code: 'Model.AccessDenied', message: 'sensitive details', request_id: 'provider-request-1' }), { status: 403 })), error => error instanceof AppError && error.code === 'PROVIDER_MODEL_DENIED' && error.message.includes('provider-request-1') && !error.message.includes('sensitive'));
  await assert.rejects(requestCopy(profile, [], async () => new Response(JSON.stringify({ error: { code: 'invalid_request_error', message: 'sensitive nested details' }, request_id: 'provider-request-2' }), { status: 400 })), error => error instanceof AppError && error.code === 'PROVIDER_REJECTED' && error.message.includes('invalid_request_error') && error.message.includes('provider-request-2') && !error.message.includes('sensitive'));
  await assert.rejects(requestCopy(profile, [], async () => new Response(JSON.stringify({ error: { code: 'invalid_parameter_error', param: 'response_format', message: 'sensitive nested details' }, request_id: 'provider-request-3' }), { status: 400 })), error => error instanceof AppError && error.code === 'PROVIDER_REJECTED' && error.message.includes('invalid_parameter_error.response_format') && !error.message.includes('sensitive'));
  await assert.rejects(requestCopy(profile, [], async () => { throw new Error('connection reset'); }), error => error instanceof AppError && error.code === 'RESULT_UNCERTAIN');
  await assert.rejects(requestCopy(profile, [], async () => new Response('not-json')), error => error instanceof AppError && error.code === 'RESULT_UNCERTAIN');
});
