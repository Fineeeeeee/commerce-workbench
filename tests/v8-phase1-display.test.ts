import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActionLabel, statusPresentation } from '../apps/web/src/components/StatusBadge.js';
import { batchDisplayName, cleanDisplayText, factDisplayValue, opportunityDisplayTitle, sourceDisplayLabel, businessNotes, joinBusinessNotes, marketSourceLabel, contentRevisionLabel } from '../apps/web/src/display-text.js';

test('三套展示词汇只映射各自业务状态', () => {
  assert.equal(statusPresentation({ domain: 'project', status: 'EVALUATING' }).label, '评估中');
  assert.equal(statusPresentation({ domain: 'project', status: 'LAUNCHED' }).label, '已上市');
  assert.equal(statusPresentation({ domain: 'opportunity', status: 'DRAFT' }).label, '待审核');
  assert.equal(statusPresentation({ domain: 'opportunity', status: 'REJECTED' }).label, '已否决');
  assert.equal(statusPresentation({ domain: 'content', status: 'confirmed' }).label, '文案已确认');
  assert.equal(statusPresentation({ domain: 'content', status: 'page_pending' }).label, '页面未审核');
  assert.equal(statusPresentation({ domain: 'content', status: 'reviewed' }).label, '页面已审核');
});

test('项目操作只对现有正向合法下一阶段显示', () => {
  assert.equal(projectActionLabel('EVALUATING'), '完成评估并立项');
  assert.equal(projectActionLabel('LAUNCHED'), null);
  assert.equal(projectActionLabel('CLOSED'), null);
});

test('旧标题中的状态前缀只在展示时去除', () => {
  assert.equal(opportunityDisplayTitle('待审核：多件装机会'), '多件装机会');
  assert.equal(opportunityDisplayTitle('香氛体验叠加功效卖点待人工审核'), '香氛体验叠加功效卖点');
  assert.equal(opportunityDisplayTitle('大容量规格方向待审核'), '大容量规格方向');
  assert.equal(opportunityDisplayTitle('控油洗发水'), '控油洗发水');
  assert.equal(batchDisplayName('京东联盟洗发水 · jd_ui_f5d03a'), '京东联盟洗发水');
});

test('事实展示不泄露内部素材 ID 或把来源括注混进值', () => {
  assert.equal(cleanDisplayText('油性发质（用户提供）'), '油性发质');
  assert.equal(factDisplayValue({ type: 'asset', value: '87e911fc-ede3-4115-a67e-e80a30b02e1a' }), '已上传商品素材');
  assert.equal(factDisplayValue({ type: 'audience', value: '油性发质（用户提供）' }), '油性发质');
});

test('产品资料来源使用业务标签，不展示任务实现语境', () => {
  assert.equal(sourceDisplayLabel('用户在当前任务提供的产品资料'), '产品资料');
  assert.equal(sourceDisplayLabel('SPU 产品定义'), 'SPU 产品定义');
});

test('市场来源和风险不会重复边界、内部批次编号或标点',()=>{
  assert.equal(batchDisplayName('京东联盟洗发水 · jduif5d97566b516'),'京东联盟洗发水');
  assert.equal(batchDisplayName('京东联盟洗发水 2026-09-27 · 监控 jd_ui_c0852d78563a'),'京东联盟洗发水 2026-09-27');
  assert.equal(marketSourceLabel('京东','JD Union Jingfen selected pools；仅代表当前样本，不代表京东全站'),'京东；JD Union Jingfen selected pools');
  assert.equal(marketSourceLabel('京东','京东'),'京东');
  assert.equal(joinBusinessNotes(['需进一步验证。','仍缺 包装形式、营销方式']),'需进一步验证；仍缺 包装形式、营销方式');
  assert.equal(businessNotes('品牌名待核实。当前仅用于本地工作流程试点。'),'品牌名待核实。');
  assert.equal(contentRevisionLabel(38),'方案修订记录 #38');
});
