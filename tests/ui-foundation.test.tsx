import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { statusCatalog, resolveStatus } from '../apps/web/src/status-catalog.js';
import { StatusTag } from '../apps/web/src/components/StatusTag.js';
import { SourceTag } from '../apps/web/src/components/SourceTag.js';
import { Button } from '../apps/web/src/components/Button.js';
import { Card } from '../apps/web/src/components/Card.js';
import { PageHeader } from '../apps/web/src/components/PageHeader.js';
import { projectStatuses } from '../packages/contracts/business.js';
import { marketResearchStates } from '../packages/contracts/market-research.js';
import { taskStates } from '../packages/contracts/tasks.js';

test('foundation covers contract enums without changing their domain meaning', () => {
  for (const state of projectStatuses) assert.ok(resolveStatus('project', state, 'test'));
  for (const state of marketResearchStates) assert.ok(resolveStatus('research', state, 'test'));
  for (const state of taskStates) assert.ok(resolveStatus('task', state, 'test'));
  assert.equal(resolveStatus('project', 'DRAFT', 'test').label, '草稿');
  assert.equal(resolveStatus('opportunity', 'DRAFT', 'test').label, '待审核');
  for (const domain of ['brief', 'listing'] as const) assert.equal(resolveStatus(domain, 'DRAFT', 'test').label, '待确认');
  assert.equal(resolveStatus('project', 'READY', 'test').label, '待上市');
  assert.equal(resolveStatus('opportunity', 'READY', 'test').label, '已通过');
});
test('human project work is neutral, missing data blocks, and AI pass is not approval', () => {
  for (const state of ['EVALUATING', 'DEVELOPING']) assert.equal(resolveStatus('project', state, 'test').tone, 'neutral');
  assert.equal(resolveStatus('workItem', 'IN_PROGRESS', 'test').tone, 'neutral');
  assert.equal(resolveStatus('contentPage', 'MISSING_DATA', 'test').tone, 'error');
  assert.equal(resolveStatus('opportunity', 'REJECTED', 'test').tone, 'neutral');
  const ai = resolveStatus('aiCheck', 'PASS', 'test');
  assert.equal(ai.tone, 'neutral'); assert.notEqual(ai.icon, 'check');
  assert.equal(resolveStatus('ruleCheck', 'PASS', 'test').tone, 'confirmed');
  assert.equal(resolveStatus('ruleCheck', 'PASS', 'test').icon, 'check');
});
test('queue and timeout remain distinguishable without color', () => {
  const queue = resolveStatus('task', 'Queued', 'test'), running = resolveStatus('task', 'running', 'test');
  assert.equal(queue.tone, running.tone); assert.notEqual(queue.label, running.label); assert.notEqual(queue.icon, running.icon);
  const timeout = resolveStatus('task', 'TIMEOUT', 'test'), failure = resolveStatus('task', 'failed', 'test');
  assert.equal(timeout.tone, failure.tone); assert.notEqual(timeout.label, failure.label); assert.notEqual(timeout.icon, failure.icon);
  assert.equal(resolveStatus('task', 'saving_result', 'test').label, '处理中');
  assert.equal(resolveStatus('task', 'saving_result', 'test').detail, '正在保存结果');
});
test('unknown states throw in development/test and stay honest in production', () => {
  for (const env of ['development', 'test'] as const) assert.throws(() => resolveStatus('task', 'FUTURE_STATE', env), /Unmapped status/);
  const unknown = resolveStatus('task', 'FUTURE_STATE', 'production');
  assert.equal(unknown.label, '状态异常'); assert.equal(unknown.tone, 'unknown'); assert.match(unknown.detail!, /FUTURE_STATE/);
  assert.throws(() => renderToStaticMarkup(<StatusTag domain="task" status="FUTURE_STATE"/>), /Unmapped status/);
  assert.equal(resolveStatus('humanReview', null, 'test').label, '待审核');
  assert.throws(() => resolveStatus('task', null, 'test'), /Unmapped status/);
  assert.equal(resolveStatus('task', null, 'production').label, '状态异常');
});
test('catalog has exactly six tones and every entry renders', () => {
  const tones = new Set<string>();
  for (const [domain, entries] of Object.entries(statusCatalog)) for (const [state, definition] of Object.entries(entries)) {
    tones.add(definition.tone);
    assert.ok(renderToStaticMarkup(<StatusTag domain={domain as keyof typeof statusCatalog} status={state}/>).includes(definition.label));
  }
  tones.add(resolveStatus('task', '?', 'production').tone);
  assert.deepEqual([...tones].sort(), ['action', 'confirmed', 'error', 'neutral', 'running', 'unknown']);
});
test('buttons default to safe secondary non-submit and busy disables interaction', () => {
  const normal = renderToStaticMarkup(<Button>查看</Button>);
  assert.match(normal, /type="button"/); assert.match(normal, /ui-button--secondary/);
  const busy = renderToStaticMarkup(<Button busy variant="primary">提交中</Button>);
  assert.match(busy, /disabled/); assert.match(busy, /aria-busy="true"/);
  const header = renderToStaticMarkup(<PageHeader title="测试" primaryAction={{children:'确认'}} actions={<Button>取消</Button>}/>);
  assert.equal((header.match(/ui-button--primary/g) ?? []).length, 1);
});
test('source tags describe provenance without checkmarks or state semantics', () => {
  const ai = renderToStaticMarkup(<SourceTag source="ai"/>), fact = renderToStaticMarkup(<SourceTag source="fact"/>);
  assert.match(ai, /AI 推断/); assert.match(fact, /程序事实/); assert.doesNotMatch(ai, /check|confirmed/);
  assert.match(renderToStaticMarkup(<Card compact aria-label="摘要">内容</Card>), /ui-card--compact/);
});
