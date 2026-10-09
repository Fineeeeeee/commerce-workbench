import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectDetail } from '../packages/contracts/business.js';
import { projectSkuRows, resolveProjectSkuSpu } from '../apps/web/src/project-sku-selection.js';

const spu = (id: string, skus: Array<{ id: string; spuId: string | null }> = []) => ({ id, name: id, skus }) as ProjectDetail['spus'][number];

test('没有 SPU 时项目路径不能创建归属 SKU', () => {
  assert.equal(resolveProjectSkuSpu([], null), null);
});

test('只有一个 SPU 时可以直接使用该归属', () => {
  const one = spu('one');
  assert.equal(resolveProjectSkuSpu([one], null)?.id, 'one');
});

test('多个 SPU 时必须明确选择且选择属于当前项目', () => {
  const parents = [spu('one'), spu('two')];
  assert.equal(resolveProjectSkuSpu(parents, null), null);
  assert.equal(resolveProjectSkuSpu(parents, 'outside'), null);
  assert.equal(resolveProjectSkuSpu(parents, 'two')?.id, 'two');
});

test('项目 SKU 列表只包含归属其 SPU 的 SKU，独立历史 SKU 不被自动分配', () => {
  const detail = { spus: [spu('one', [{ id: 'assigned', spuId: 'one' }])] } as ProjectDetail;
  assert.deepEqual(projectSkuRows(detail).map(item => item.id), ['assigned']);
  const independentSku = { id: 'legacy', spuId: null };
  assert.equal(projectSkuRows(detail).some(item => item.id === independentSku.id), false);
});
