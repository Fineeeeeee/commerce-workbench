import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/app.js';
import { deriveOverviewWork } from '../packages/contracts/overview-work.js';
import type { ProductProject } from '../packages/contracts/business.js';
import type { MarketResearchJob } from '../packages/contracts/market-research.js';

test('failed monitoring is actionable and targets its exact monitoring run, never a module homepage',()=>{
  const result=deriveOverviewWork({research:[],opportunities:[],projects:[],content:[],contentJobs:[],monitoringRuns:[{id:'monitor-run',state:'FAILED',batchId:null}]},new Date().toISOString());
  assert.equal(result.running.length,0);assert.equal(result.attention.length,1);
  assert.deepEqual(result.attention[0]!.target,{view:'market',marketTab:'monitoring',monitoringRunId:'monitor-run'});
});

const project: ProductProject = { id: 'project-1', categoryId: null, name: '香氛洗发水', status: 'DRAFT', projectType: null, brief: { objective: '', positioning: '', constraints: [], notes: '' }, checklist: { formulaConfirmed: false, packagingConfirmed: false, contentCompleted: false }, createdAt: '2026-09-22', updatedAt: '2026-09-22' };
const research: MarketResearchJob = { id: 'research-1', initiatingProjectId: null, sourcePlatform: 'jd', collectionProfile: 'shampoo', targetCount: 50, maxPages: 10, state: 'COLLECTING', failedStage: null, scannedCount: 12, validCount: 3, opportunityCount: 0, manifestData: {}, marketBatchId: null, errorCode: null, safeMessage: null, retryCount: 0, version: 1, createdAt: '2026-09-22', updatedAt: '2026-09-22' };
const empty = { research: [] as MarketResearchJob[], opportunities: [] as Array<{ id: string; title: string; batchId: string; batchName: string; status: string; reviewable: boolean }>, projects: [] as Array<{ project: ProductProject; progress: { evidence: number; spus: number; skus: number; content: number; deliveries: number; feedback: number } }>, content: [] as Array<{ kitId: string; kitName: string; skuId: string; skuName: string; projectId: string | null; pages: Array<{ pageId: string; state: 'GENERATED' | 'REVIEWED'; copyStatus: 'confirmed'; canGenerateCopy: boolean; canGenerateVisual: boolean }> }>, contentJobs: [] as Array<{ id: string; kitId: string; skuId: string; kitName: string; skuName: string; projectId: string | null; operation: string; state: string; activeCount: number }> };

test('总览只投影人工动作与真实运行任务，状态改变后待办消失', () => {
  const source = { ...empty, research: [research], opportunities: [{ id: 'opportunity-1', title: '香氛机会', batchId: 'batch-1', batchName: '京东样本', status: 'DRAFT', reviewable: true }], projects: [{ project, progress: { evidence: 0, spus: 0, skus: 0, content: 0, deliveries: 0, feedback: 0 } }], content: [{ kitId: 'kit-1', kitName: '首套商品图', skuId: 'sku-1', skuName: '500ml', projectId: project.id, pages: [{ pageId: 'page-2', state: 'GENERATED' as const, copyStatus: 'confirmed' as const, canGenerateCopy: false, canGenerateVisual: false }] }] };
  const before = deriveOverviewWork(source, '2026-09-22');
  assert.equal(before.attention.find(item => item.kind === 'opportunity')?.target.opportunityId, 'opportunity-1');
  assert.equal(before.attention.find(item => item.kind === 'project')?.target.projectId, project.id);
  assert.equal(before.attention.find(item => item.kind === 'project')?.target.projectAction, 'evidence');
  assert.equal(before.attention.find(item => item.kind === 'content')?.target.kitId, 'kit-1');
  assert.equal(before.attention.find(item => item.kind === 'content')?.target.pageId, 'page-2');
  assert.deepEqual(before.running.map(item => item.kind), ['research']);
  const after = deriveOverviewWork({ ...source, research: [{ ...research, state: 'COMPLETED' }], opportunities: [{ ...source.opportunities[0]!, status: 'READY' }], projects: [{ project: { ...project, status: 'LAUNCHED', checklist: { formulaConfirmed: true, packagingConfirmed: true, contentCompleted: true } }, progress: { evidence: 1, spus: 1, skus: 1, content: 1, deliveries: 1, feedback: 1 } }], content: [{ ...source.content[0]!, pages: [{ pageId: 'page-2', state: 'REVIEWED', copyStatus: 'confirmed', canGenerateCopy: false, canGenerateVisual: false }] }] }, '2026-09-22');
  assert.equal(after.attention.length, 0);
  assert.equal(after.running.length, 0);
});

test('项目待办携带具体操作，内容待审核与工作台使用同一口径', () => {
  const progress = { evidence: 1, spus: 0, skus: 0, content: 0, deliveries: 0, feedback: 0 };
  const spu = deriveOverviewWork({ ...empty, projects: [{ project, progress }] }, '2026-09-22');
  assert.equal(spu.attention[0]?.target.projectAction, 'spu');
  const sku = deriveOverviewWork({ ...empty, projects: [{ project, progress: { ...progress, spus: 1 } }] }, '2026-09-22');
  assert.equal(sku.attention[0]?.target.projectAction, 'sku');
  const content = deriveOverviewWork({ ...empty, content: [{ kitId: 'kit', kitName: '商品图', skuId: 'sku', skuName: '500ml', projectId: null, pages: [
    { pageId: 'old', state: 'GENERATED', copyStatus: 'draft', canGenerateCopy: true, canGenerateVisual: false },
    { pageId: 'ready', state: 'GENERATED', copyStatus: 'confirmed', canGenerateCopy: false, canGenerateVisual: false },
  ] }] }, '2026-09-22');
  assert.match(content.attention[0]?.title ?? '', /^1 /);
  assert.equal(content.attention[0]?.target.pageId, 'ready');
  assert.equal(content.attention[0]?.target.contentAction, 'review');
  const candidate = deriveOverviewWork({ ...empty, content: [{ kitId: 'kit', kitName: '商品图', skuId: 'sku', skuName: '500ml', projectId: null, pages: [
    { pageId: 'candidate', state: 'READY', copyStatus: 'confirmed', canGenerateCopy: false, canGenerateVisual: true, hasVisualCandidate: true },
  ] }] }, '2026-09-22');
  assert.equal(candidate.attention[0]?.target.pageId, 'candidate');
  assert.equal(candidate.attention[0]?.target.contentAction, 'candidate');
  assert.equal(candidate.attention[0]?.action, '查看视觉候选');
});

test('旧版机会没有可执行审核入口时不出现在待办中', () => {
  const result = deriveOverviewWork({ ...empty, opportunities: [{ id: 'old', title: '旧版机会', batchId: 'batch-1', batchName: '历史批次', status: 'DRAFT', reviewable: false }] }, '2026-09-22');
  assert.equal(result.attention.length, 0);
});

test('进行中的内容任务使用现有任务状态的业务表达', () => {
  const job = { id: 'job', kitId: 'kit', skuId: 'sku', kitName: '商品图', skuName: '500ml', projectId: null, operation: 'image', state: 'queued', activeCount: 2 };
  const queued = deriveOverviewWork({ ...empty, contentJobs: [job] }, '2026-09-22');
  assert.equal(queued.running[0]?.status, '排队中');
  const waiting = deriveOverviewWork({ ...empty, contentJobs: [{ ...job, state: 'waiting_external' }] }, '2026-09-22');
  assert.equal(waiting.running[0]?.status, '等待生成结果');
});

test('总览接口不写入业务数据，并保持数据库版本', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'overview-work-'));
  const { app, store } = await createApp(directory);
  t.after(() => app.close());
  const before = Number(store.db.prepare('SELECT count(*) n FROM product_projects').get()!.n);
  const response = await app.inject({ method: 'GET', url: '/api/overview-work', headers: { host: '127.0.0.1:4380' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().running, []);
  assert.equal(Number(store.db.prepare('SELECT count(*) n FROM product_projects').get()!.n), before);
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 16);
});
