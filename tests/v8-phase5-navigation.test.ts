import assert from 'node:assert/strict';
import test from 'node:test';
import { contentEntryLocation, formatNavigationHash, parseNavigationHash } from '../apps/web/src/navigation.js';

test('content entry selects the requested kit and clears unrelated page and project context', () => {
  const projectKit=contentEntryLocation('sku-1','project','project-1','kit-2');
  const restored=parseNavigationHash(formatNavigationHash(projectKit));
  assert.equal(restored.kitId,'kit-2');
  assert.equal(restored.projectId,'project-1');
  assert.equal(restored.pageId,null);
  const changedSku=contentEntryLocation('sku-2',null,'project-1');
  const changed=parseNavigationHash(formatNavigationHash(changedSku));
  assert.equal(changed.skuId,'sku-2');
  assert.equal(changed.kitId,null);
  assert.equal(changed.pageId,null);
  assert.equal(changed.projectId,null);
});

test('project and research locations survive a page refresh', () => {
  const project = parseNavigationHash('#/projects?project=project-1');
  assert.equal(project.projectId, 'project-1');
  assert.equal(formatNavigationHash(project), '#/projects?project=project-1');
  const market = parseNavigationHash('#/market?batch=batch-1&project=project-1');
  assert.equal(market.researchProjectId, 'project-1');
  assert.equal(formatNavigationHash(market), '#/market?batch=batch-1&project=project-1');
});

test('independent SKU and project-origin content retain distinct return paths', () => {
  assert.deepEqual(parseNavigationHash('#/products?sku=standalone-1').skuId, 'standalone-1');
  const studio = parseNavigationHash('#/studio?sku=sku-1&from=project&project=project-1');
  assert.equal(studio.studioOrigin, 'project');
  assert.equal(formatNavigationHash(studio), '#/studio?sku=sku-1&from=project&project=project-1');
  assert.equal(parseNavigationHash('#/studio?sku=sku-1&from=products').studioOrigin, 'products');
});

test('unknown views and invalid identifiers do not become navigation targets', () => {
  assert.equal(parseNavigationHash('#/unknown?project=project-1').view, 'overview');
  assert.equal(parseNavigationHash('#/projects?project=%3Cscript%3E').projectId, null);
  assert.equal(parseNavigationHash('#/studio?from=project').studioOrigin, null);
});

test('overview work links restore the exact opportunity and content page', () => {
  const opportunity = parseNavigationHash('#/market?batch=batch-1&opportunity=opportunity-1');
  assert.equal(opportunity.opportunityId, 'opportunity-1');
  assert.equal(formatNavigationHash(opportunity), '#/market?batch=batch-1&opportunity=opportunity-1');
  const content = parseNavigationHash('#/studio?sku=sku-1&kit=kit-1&page=page-2&from=project&project=project-1');
  assert.equal(content.kitId, 'kit-1');
  assert.equal(content.pageId, 'page-2');
  assert.equal(formatNavigationHash(content), '#/studio?sku=sku-1&kit=kit-1&page=page-2&from=project&project=project-1');
});
