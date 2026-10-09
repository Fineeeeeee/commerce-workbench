import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPages, normalizeReviews, pageIssues, kitInputSchema, type ProductInput, type Kit } from '../packages/contracts/domain.js';

const product: ProductInput = { name: '测试沐浴露', brand: '测试', specification: '300ml', variant: '', audience: '', origin: '', notes: '', claims: [] };

test('新商品的套图规划不预设洗发水功效，也不自动填充未经确认的文案', () => {
  const pages = createPages(product);
  assert.equal(pages.length, 17);
  assert.ok(!/控油|去屑|发质|蓬松/.test(JSON.stringify(pages)));
  assert.ok(pages.slice(1).every(p => !p.headline && !p.body && !p.reviewed));
  assert.ok(kitInputSchema.safeParse({ name: '沐浴露方案', productVersion: 1, pages }).success);
});

test('改变页面用途取消该页审核，其他页面和历史稿保持原样', () => {
  const previous: Kit = { id: crypto.randomUUID(), productId: crypto.randomUUID(), version: 1, productVersion: 1, updatedAt: '', name: '方案', pages: createPages(product).map(p => ({ ...p, reviewed: true })) };
  const next = normalizeReviews({ name: previous.name, productVersion: 1, pages: previous.pages.map((p, i) => i === 2 ? { ...p, purpose: '沐浴使用场景' } : p) }, previous);
  assert.equal(next.pages[2]!.reviewed, false);
  assert.ok(next.pages.filter((_, i) => i !== 2).every(p => p.reviewed));
  assert.equal(previous.pages[2]!.purpose, '成分 / 产品机理页');
  assert.equal(previous.pages[2]!.reviewed, true);
  assert.ok(pageIssues({ ...next.pages[2]!, purpose: ' ' }, product, []).includes('填写本页用途'));
});
