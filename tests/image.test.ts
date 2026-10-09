import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Store, AppError } from '../apps/server/store.js';
import { Tasks } from '../apps/server/tasks.js';
import { createPages, type ProductInput } from '../packages/contracts/domain.js';
import { imageProfile, requestImage, type ImageResponse } from '../apps/server/image-provider.js';
import { adoptImage, executeImage, imageCandidates } from '../apps/server/image-service.js';
import { uploadAsset, transparentSubjectData } from '../apps/server/media.js';
import { imagePrompt, productionImageMode, productionImageModel } from '../packages/contracts/image.js';
import { imageJobKeys } from '../apps/web/src/image-panel-task.js';
import { reconcileCopy } from '../apps/server/copy-service.js';
import { createApp } from '../apps/server/app.js';
import { taobaoDailyCarePages } from '../packages/contracts/content-template.js';
import { imageTypeDrafts } from '../packages/contracts/image-type-catalog.js';

function configuration(t: TestContext) {
  const values = { COMMERCE_IMAGE_ENABLED: '1', COMMERCE_BAILIAN_WORKSPACE_ID: 'test-workspace', DASHSCOPE_API_KEY: 'test-only-not-a-real-key' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])); Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]; });
}

async function setup(t: TestContext) {
  configuration(t); const directory = await mkdtemp(join(tmpdir(), 'image-test-')), store = new Store(directory); t.after(() => store.close());
  const product: ProductInput = { name: '测试洗发水', brand: '测试品牌', variant: '清香型', specification: '500ml', audience: '油性发质', origin: '广州', notes: '', claims: [] };
  const saved = store.createProduct(product), source = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const category=String(store.db.prepare("SELECT id FROM categories WHERE code='shampoo'").get()!.id),projectId=randomUUID(),time=new Date().toISOString();
  store.db.prepare("INSERT INTO product_projects (id,category_id,name,status,brief_data,checklist_data,created_at,updated_at,project_type) VALUES (?,?,?,'DRAFT','{}','{}',?,?,'EXISTING_PRODUCT')").run(projectId,category,'测试运营项目',time,time);
  store.db.prepare('INSERT INTO project_independent_skus VALUES (?,?,?)').run(saved.id,projectId,time);
  store.db.prepare("INSERT INTO category_visual_guides VALUES (?,?,1,'CONFIRMED',?,'[]',?,?)").run(randomUUID(),category,JSON.stringify({name:'测试指南',style:'真实摄影',channels:['taobao'],identityConstraints:['保持瓶身标签'],imageTypes:[{pageIds:taobaoDailyCarePages.map(p=>p.id),composition:'依据确认文案组织画面'}],prohibitions:[]}),time,time);
  for(const input of imageTypeDrafts)store.db.prepare("INSERT INTO image_type_guides VALUES (?,?,?,1,'CONFIRMED',?,'[]',?,?)").run(randomUUID(),input.templateKey,input.slotId,JSON.stringify(input.data),time,time);
  const asset = await uploadAsset(store, saved.id, source, 'product.png', '测试素材'), kit = store.createKit(saved.id, { name: '测试套图', productVersion: 1, pages: createPages(saved, 12, asset.id).map(page=>({...page,copyStatus:'confirmed'})) });
  return { directory, store, tasks: new Tasks(store), kit, asset };
}

test('图片模型档位使用固定模型和专属域名，严格解析供应商响应', async t => {
  configuration(t);
  assert.equal(productionImageMode, 'quality'); assert.equal(productionImageModel, 'qwen-image-2.0');
  assert.equal(imageProfile('quality','qwen-image-2.0-pro')?.model,'qwen-image-2.0-pro');
  const response = { request_id: 'image-request', output: { choices: [{ finish_reason: 'stop', message: { content: [{ image: 'https://result.oss-cn-beijing.aliyuncs.com/output.png', type: 'image' }] } }], finished: true }, usage: { image_count: 1, input_tokens: 3, output_tokens: 2 } };
  for (const [mode, model] of [['draft', 'z-image-turbo'], ['quality', 'qwen-image-2.0'], ['premium', 'qwen-image-3.0-pro']] as const) {
    const profile = imageProfile(mode)!; let calls = 0;
    const result = await requestImage(profile, '测试提示词', null, '1024*1024', async (url, init) => {
      calls++; assert.equal(String(url), 'https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, model); assert.equal(body.input.messages[0].content.at(-1).text, '测试提示词');
      assert.equal(body.input.messages[0].content.some((item: Record<string, unknown>) => 'image' in item), false);
      return new Response(JSON.stringify(response), { headers: { 'x-request-id': 'header-request' } });
    });
    assert.equal(result.model, model); assert.equal(result.imageCount, 1); assert.equal(calls, 1);
  }
});

test('商品场景模型上传透明主体、保存供应商任务号并轮询结果', async t => {
  configuration(t); const profile = imageProfile('background')!, accepted: string[] = [], calls: string[] = [];
  const source = `data:image/png;base64,${(await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0 } } }).png().toBuffer()).toString('base64')}`;
  const result = await requestImage(profile, '浅蓝商品场景', source, '1024*1024', async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(JSON.stringify({ data: { upload_dir: 'temporary/path', upload_host: 'https://upload.oss-cn-beijing.aliyuncs.com', oss_access_key_id: 'id', signature: 'signature', policy: 'policy', x_oss_object_acl: 'private', x_oss_forbid_overwrite: 'true' } }));
    if (calls.length === 2) { assert.ok(init?.body instanceof FormData); return new Response('', { status: 200 }); }
    if (calls.length === 3) { const body = JSON.parse(String(init?.body)); assert.equal(body.model, 'wanx-background-generation-v2'); assert.equal(body.parameters.model_version, 'v3'); assert.match(body.input.base_image_url, /^oss:\/\//); return new Response(JSON.stringify({ request_id: 'submit-request', output: { task_id: 'background-task', task_status: 'PENDING' } })); }
    return new Response(JSON.stringify({ request_id: 'poll-request', output: { task_id: 'background-task', task_status: 'SUCCEEDED', results: [{ url: 'https://result.oss-cn-beijing.aliyuncs.com/output.png' }] }, usage: { image_count: 1 } }));
  }, pending => accepted.push(pending.id));
  assert.equal(result.model, 'wanx-background-generation-v2'); assert.equal(result.imageCount, 1); assert.deepEqual(accepted, ['background-task']); assert.equal(calls.length, 4);
});

test('白底素材只移除与画布边缘连通的白色背景', async t => {
  configuration(t); const store = new Store(await mkdtemp(join(tmpdir(), 'subject-test-'))); t.after(() => store.close());
  const product = store.createProduct({ name: '测试商品', brand: '', variant: '', specification: '', audience: '', origin: '', notes: '', claims: [] });
  const source = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 12, height: 20, channels: 3, background: '#28545e' } }).png().toBuffer(), left: 10, top: 6 }]).png().toBuffer();
  const asset = await uploadAsset(store, product.id, source, 'product.png', '测试素材'), dataUrl = await transparentSubjectData(store, asset.id);
  const raw = await sharp(Buffer.from(dataUrl!.split(',')[1]!, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(raw.info.width,12); assert.equal(raw.info.height,20); const center=(10*raw.info.width+6)*4; assert.equal(raw.data[center+3],255);
});

test('场景草图不向图片模型发送商品名、规格或页面文案', async t => {
  const { kit, store } = await setup(t), product = store.product(kit.productId), page = kit.pages[0]!;
  page.headline = '禁止泄露的页面标题';
  const draft = imagePrompt(product, page, 'draft');
  assert.ok(!draft.includes(product.name)); assert.ok(!draft.includes(product.specification)); assert.ok(!draft.includes(page.headline));
  assert.match(draft, /不得出现商品、瓶子、泵头、容器、包装/);
  const quality = imagePrompt(product, page, 'quality');
  assert.ok(!quality.includes(page.headline)); assert.match(quality, /禁止出现商品、瓶子/);
  assert.match(quality, /禁止画出可见边框、矩形面板、圆形徽章、卡片、表格、网格、按钮或任何界面占位符/);
  assert.match(quality, /成熟淘宝日化商品页的信息承载密度/);
  assert.match(quality, /上方和底部通过低细节景深自然留出排版空间/);
  const detail = imagePrompt(product, kit.pages.find(item => item.templateId === 'D08')!, 'premium');
  assert.match(detail, /细腻泡沫、清水和柔顺发丝/);
});

test('视觉候选保存为本地产物，人工采用才创建新设计稿版本', async t => {
  const { store, tasks, kit } = await setup(t), page = kit.pages[0]!;
  const job = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'quality', pageIds: [page.id] }, randomUUID()), lease = tasks.claim('image-worker')!;
  assert.equal(lease.snapshot.referenceVisualInputs?.[page.id]?.guide.version,1);
  assert.equal(lease.snapshot.referenceVisualInputs?.[page.id]?.imageTypeGuide?.version,1);
  assert.equal(lease.snapshot.referenceVisualInputs?.[page.id]?.editPolicy?.enforcement,'PROMPT_ONLY');
  assert.equal(lease.snapshot.imageProfile?.engine,'REFERENCE_IMAGE');
  const response: ImageResponse = { id: 'provider-image', model: 'qwen-image-3.0-pro', url: 'https://result.oss-cn-beijing.aliyuncs.com/output.png', imageCount: 1, inputTokens: 4, outputTokens: 1 };
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#abcdef' } }).png().toBuffer();
  await executeImage(tasks, lease, async (_profile,_prompt,reference) => {assert.match(reference!,/^data:image\/png;base64,/);return response;}, async () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } }));
  assert.equal(tasks.info(job.id).state, 'succeeded'); assert.equal(tasks.info(job.id).usage.imageCount, 1); assert.equal(store.kit(kit.id).version, 1);
  const run=store.db.prepare('SELECT * FROM ai_inference_runs WHERE id=?').get(lease.attemptId)!;
  assert.equal(run.capability,'IMAGE_GENERATION');assert.equal(run.status,'SUCCEEDED');
  assert.equal(JSON.parse(String(run.input_data)).referenceInput.imageTypeGuide.version,1);
  const candidate = imageCandidates(store, kit.id)[0]!; assert.equal(candidate.model, 'qwen-image-3.0-pro'); assert.equal(candidate.width, 64);
  const adopted = adoptImage(store, kit.id, { baseVersion: 1, artifactId: candidate.id }, randomUUID());
  assert.equal(adopted.version, 2); assert.equal(adopted.pages[0]!.visualArtifactId, candidate.id); assert.equal(adopted.pages[0]!.reviewed, false);
  assert.equal(adopted.pages[0]!.visualMode,'REFERENCE_IMAGE');
  assert.equal(store.kit(kit.id, 1).pages[0]!.visualArtifactId, null);
});

test('图片 API 失败进入明确失败状态，且不阻塞后续任务', async t => {
  const { tasks, kit } = await setup(t), page = kit.pages[0]!;
  const job = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'draft', pageIds: [page.id] }, randomUUID()), lease = tasks.claim('image-worker')!;
  try { await executeImage(tasks, lease, async () => { throw new AppError('PROVIDER_REJECTED', '图片服务拒绝测试请求'); }); } catch (error) { tasks.fail(lease, error); }
  const failed = tasks.info(job.id); assert.equal(failed.state, 'failed'); assert.match(failed.tasks[0]!.error!, /拒绝/);
  const next = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'draft', pageIds: [kit.pages[1]!.id] }, randomUUID());
  assert.equal(tasks.claim('second-worker')?.jobId, next.id);
});

test('图片 API 超时进入 FAILED 并给出可重试信息', async t => {
  const { tasks, kit } = await setup(t), page = kit.pages[0]!;
  const job = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'quality', pageIds: [page.id] }, randomUUID()), lease = tasks.claim('image-worker')!;
  try {
    await executeImage(tasks, lease, (profile, prompt, source, size) => requestImage(profile, prompt, source, size, async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; }));
  } catch (error) { tasks.fail(lease, error); }
  const failed = tasks.info(job.id); assert.equal(failed.state, 'failed'); assert.match(failed.tasks[0]!.error!, /5 分钟/);
});

test('重复提交使用同一幂等键只创建一个图片任务', async t => {
  const { store, tasks, kit } = await setup(t), key = randomUUID(), pageId = kit.pages[0]!.id, body = { kitVersion: 1, operation: 'image' as const, imageMode: 'quality' as const, pageIds: [pageId] };
  const first = tasks.submit(kit.id, body, key), second = tasks.submit(kit.id, body, key);
  assert.equal(first.id, second.id);
  assert.equal(Number(store.db.prepare('SELECT count(*) count FROM tasks WHERE job_id=?').get(first.id)!.count), 1);
});

test('刷新页面后可用持久 job ID 恢复图片任务最终状态', async t => {
  const { directory, tasks, kit } = await setup(t), page = kit.pages[0]!, key = randomUUID();
  const job = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'quality', pageIds: [page.id] }, key), lease = tasks.claim('image-worker')!;
  const response: ImageResponse = { id: 'provider-refresh', model: 'qwen-image-3.0-pro', url: 'https://result.oss-cn-beijing.aliyuncs.com/output.png', imageCount: 1, inputTokens: null, outputTokens: null };
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#abcdee' } }).png().toBuffer();
  await executeImage(tasks, lease, async () => response, async () => new Response(png));
  const restored = new Store(directory); t.after(() => restored.close());
  assert.equal(new Tasks(restored).info(job.id).state, 'succeeded');
  assert.equal(imageJobKeys(kit.id, page.id, 'quality').job, `image-job:${kit.id}:${page.id}:quality:qwen-image-2.0`);
  const { app } = await createApp(directory); t.after(() => app.close());
  const result = await app.inject({ method: 'GET', url: `/api/jobs/${job.id}`, headers: { host: '127.0.0.1:4380', origin: 'http://127.0.0.1:4380' } });
  assert.equal(result.statusCode, 200); assert.equal(result.json().state, 'succeeded');
});

test('图片已返回但保存失败时可恢复，恢复不会再次调用模型', async t => {
  const { tasks, kit } = await setup(t), page = kit.pages[0]!;
  const job = tasks.submit(kit.id, { kitVersion: 1, operation: 'image', imageMode: 'quality', pageIds: [page.id],editStrategy:'RECOMPOSE_SCENE',seed:39071 }, randomUUID()), first = tasks.claim('image-worker')!;
  const response: ImageResponse = { id: 'provider-image', model: 'z-image-turbo', url: 'https://result.oss-cn-beijing.aliyuncs.com/output.png', imageCount: 1, inputTokens: 0, outputTokens: 0 };
  let providerCalls = 0;
  try { await executeImage(tasks, first, async () => { providerCalls++; return response; }, async () => { throw new Error('download blocked'); }); } catch (error) { tasks.fail(first, error); }
  assert.equal(tasks.info(job.id).tasks[0]!.recoveryAction, 'resume_image_save');
  tasks.resume(first.id, randomUUID());
  const second = tasks.claim('image-worker-2')!, png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#abcdef' } }).png().toBuffer();
  await executeImage(tasks, second, async () => { providerCalls++; throw new Error('must not call provider'); }, async () => new Response(png));
  assert.equal(providerCalls, 1); assert.equal(tasks.info(job.id).state, 'succeeded');
  const candidate=imageCandidates(tasks.store,kit.id)[0]!;
  assert.equal(candidate.generationContext?.sourceInferenceRunId,first.attemptId);
  assert.equal(candidate.generationContext?.seed,39071);
  assert.equal(tasks.store.db.prepare('SELECT count(*) n FROM ai_inference_runs').get()!.n,1,'save recovery must reuse the original model run');
});

test('图片结果待核实时可记录人工结论，不重发且不伪造成功', async t => {
  const {store,tasks,kit}=await setup(t);
  const job=tasks.submit(kit.id,{kitVersion:1,operation:'image',pageIds:[kit.pages[0]!.id],imageMode:'draft'},randomUUID());
  const lease=tasks.claim('worker')!;
  // Reproduce a persisted historical image task requiring manual reconciliation.
  store.db.prepare("UPDATE tasks SET state='needs_reconciliation' WHERE id=?").run(lease.id);
  assert.equal(tasks.info(job.id).state,'needs_reconciliation');
  const result=reconcileCopy(store,lease.id,{conclusion:'not_completed',evidence:'测试人员已核对供应商记录',reviewer:'测试确认人'});
  assert.equal(result.state,'failed');
  assert.equal(result.usage.cost,null);
  assert.equal(imageCandidates(store,kit.id).length,0);
  assert.equal(tasks.claim('second'),null);
  assert.throws(()=>reconcileCopy(store,lease.id,{conclusion:'not_completed',evidence:'重复核对不更改结论',reviewer:'测试确认人'}),/不是待核实/);
});
