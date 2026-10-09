import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityEvidence } from '../packages/contracts/evidence-decision.js';
import type { ProductOpportunity } from '../packages/contracts/market-opportunity.js';
import type { Entry } from '../packages/contracts/market.js';

test('AI 机会仅将模型引用的商品标为代表证据', () => {
  const opportunity = { title: '控油与去屑组合', analysis: {
    included: [{ id: 'a' }, { id: 'b' }],
    ai: { opportunities: [{ name: '控油与去屑组合', evidence_record_ids: ['b', 'outside'] }] },
  } } as ProductOpportunity;
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'outside' }] as Entry[];
  const result = opportunityEvidence(opportunity, entries);
  assert.deepEqual(result.highlightedEntries.map(entry => entry.id), ['b']);
  assert.deepEqual(result.analysisEntries.map(entry => entry.id), ['b', 'a']);
  assert.equal(result.representativeIds.has('a'), false);
});

test('手工机会没有代表与对照之分，全部纳入记录都是关联商品', () => {
  const opportunity = { title: '手工机会', analysis: {
    included: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  } } as ProductOpportunity;
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'outside' }] as Entry[];
  const result = opportunityEvidence(opportunity, entries);
  assert.equal(result.candidate, undefined);
  assert.deepEqual(result.highlightedEntries.map(entry => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(result.analysisEntries.map(entry => entry.id), ['a', 'b', 'c']);
  assert.equal(result.representativeIds.size, 0);
});
