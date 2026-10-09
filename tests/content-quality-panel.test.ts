import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPageQuality } from '../apps/web/src/content-quality-panel.js';

test('质检所依据的 SPU 事实过期时，不提供无法执行的同版本重检入口', () => {
  const quality = [{ id: 'old', page_id: 'F04', kit_version: 38, appliesToCurrentPage: false, rule_status: 'FAIL' as const, ruleIssues: ['缺少模板资料：top_notes'], ai_status: 'NOT_RUN' as const, aiIssues: [], human_decision: null }];
  assert.deepEqual(currentPageQuality(quality, 'F04', 38), { current: null, stale: true });
  assert.deepEqual(currentPageQuality(quality, 'F05', 38), { current: null, stale: false });
});
