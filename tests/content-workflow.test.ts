import test from 'node:test';
import assert from 'node:assert/strict';
import { contentPageConclusion, deriveContentPageState, deriveContentWorkflow, eligibleCopyPageIds, type WorkflowPage } from '../apps/web/src/content-workflow.js';
import { contentProgressClaim } from '../packages/contracts/content-progress.js';
import type { DesignPage } from '../packages/contracts/domain.js';

const page = (change: Partial<WorkflowPage> = {}): WorkflowPage => ({ pageId: crypto.randomUUID(), state: 'READY', copyStatus: 'draft', canGenerateCopy: true, canGenerateVisual: false, ...change });
const design = (change: Partial<DesignPage> = {}): DesignPage => ({ id: crypto.randomUUID(), kind:'main', purpose:'首图', templateId:'F01', generationMode:'fixed', headline:'', subtitle:'', body:'', claimIds:[], assetId:null, layout:'hero', background:'#ffffff', accent:'#111111', productScale:1, visualArtifactId:null, copyStatus:'draft', sourceFactIds:[], reviewed:false, ...change });

test('本页结论忠于真实状态，不把生成成功当成质量通过',()=>{
  assert.match(contentPageConclusion(page({state:'FAILED'}),design()),/生成失败/);
  assert.match(contentPageConclusion(page({state:'MISSING_DATA',canGenerateCopy:false}),design()),/缺少已确认资料/);
  assert.match(contentPageConclusion(page({state:'GENERATED',copyStatus:'confirmed'}),design()),/人工复核/);
  assert.ok(!contentPageConclusion(page({state:'GENERATED',copyStatus:'confirmed'}),design()).includes('通过'));
});

test('内容工作台只派生一个当前阶段，并保留各阶段真实计数', () => {
  const workflow = deriveContentWorkflow([
    page(),
    page({ state:'MISSING_DATA', canGenerateCopy:false }),
    page({ copyStatus:'confirmed', canGenerateCopy:false, canGenerateVisual:true }),
    page({ state:'GENERATED', copyStatus:'confirmed', canGenerateCopy:false }),
    page({ state:'REVIEWED', copyStatus:'confirmed', canGenerateCopy:false }),
  ]);
  assert.equal(workflow.current, 'review');
  assert.deepEqual({ copyReady:workflow.copyReady, visualReady:workflow.visualReady, reviewPending:workflow.reviewPending, reviewed:workflow.reviewed, missing:workflow.missing }, { copyReady:1, visualReady:1, reviewPending:1, reviewed:1, missing:1 });
});

test('页面状态使用现有事实映射，不新增持久状态', () => {
  assert.equal(deriveContentPageState(page({ state:'MISSING_DATA', canGenerateCopy:false }), design({reviewed:true})), 'missing');
  assert.equal(deriveContentPageState(page({ state:'GENERATING', canGenerateCopy:false }), design({reviewed:true})), 'generating');
  assert.equal(deriveContentPageState(page({ state:'FAILED', canGenerateCopy:false }), design({reviewed:true})), 'failed');
  assert.equal(deriveContentPageState(page({ state:'MISSING_DATA', canGenerateCopy:false }), design()), 'missing');
  assert.equal(deriveContentPageState(page({ state:'READY', copyStatus:'confirmed', canGenerateCopy:false, canGenerateVisual:true }), design({ copyStatus:'confirmed' })), 'visual_ready');
  assert.equal(deriveContentPageState(page({ state:'GENERATED', copyStatus:'confirmed', canGenerateCopy:false }), design({ copyStatus:'confirmed' })), 'review_pending');
  assert.equal(deriveContentPageState(page({ state:'REVIEWED', copyStatus:'confirmed', canGenerateCopy:false }), design({ copyStatus:'confirmed', reviewed:true })), 'reviewed');
  assert.equal(deriveContentPageState(page({ state:'GENERATED', copyStatus:'draft', canGenerateCopy:true }), design()), 'copy_ready');
  assert.equal(deriveContentPageState(page({ hasCopyCandidate:true }), design()), 'copy_pending');
  assert.equal(deriveContentPageState(page({ state:'READY', copyStatus:'confirmed', canGenerateCopy:false, canGenerateVisual:true, hasVisualCandidate:true }), design({ copyStatus:'confirmed' })), 'candidate_ready');
});

test('已生成视觉候选优先引导采用，不重复计入可生成或待审核', () => {
  const progress = deriveContentWorkflow([page({ state:'READY', copyStatus:'confirmed', canGenerateCopy:false, canGenerateVisual:true, hasVisualCandidate:true })]);
  assert.equal(progress.candidatePending, 1);
  assert.equal(progress.visualReady, 0);
  assert.equal(progress.reviewPending, 0);
  assert.equal(progress.current, 'visual');
});

test('审核进行时仍可批量处理其他可用文案，但不能带入缺资料或运行中的页面', () => {
  const ready = page(), failed = page({ state: 'FAILED' }), missing = page({ state: 'MISSING_DATA', canGenerateCopy: false });
  const running = page({ state: 'GENERATING', canGenerateCopy: false });
  const confirmed = page({ copyStatus: 'confirmed', canGenerateCopy: false });
  const candidate = page({ hasCopyCandidate: true });
  const pages = [ready, failed, missing, running, confirmed, candidate, page({ state: 'GENERATED', copyStatus: 'confirmed', canGenerateCopy: false })];
  assert.equal(deriveContentWorkflow(pages).current, 'review');
  assert.deepEqual(eligibleCopyPageIds(pages), [ready.pageId, failed.pageId]);
  assert.equal(deriveContentWorkflow(pages).copyReady, 2);
});

test('工作台摘要与逐页事实使用同一份并行进度，不把阶段数相加', () => {
  const pages = [
    page({state:'REVIEWED',copyStatus:'confirmed'}),
    page({state:'GENERATED',copyStatus:'confirmed'}),
    page({state:'MISSING_DATA',canGenerateCopy:false}),
    page({state:'FAILED'}),
  ];
  const workflow = deriveContentWorkflow(pages);
  const claim = contentProgressClaim(workflow);
  assert.equal(claim.headline, '4 页中 1 页已审核，尚余 3 页');
  assert.equal(claim.detail, '1 页缺资料 · 1 页生成失败');
  assert.equal(workflow.generated, 2);
  assert.equal(workflow.copyConfirmed, 2);
  assert.equal(workflow.reviewPending, 1);
});
