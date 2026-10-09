import type { Store } from './store.js';
import { randomUUID } from 'node:crypto';
import { referencePageIssues, visualChecklist } from './visual-guide.js';
import type { Kit, Product } from '../../packages/contracts/domain.js';
import { pageIssues } from '../../packages/contracts/domain.js';
import { layoutIssues } from '../../packages/contracts/render.js';
import { hydrateTemplatePages, missingFieldLabel, missingFields, productFacts, templateById, type Fact, type TemplateState } from '../../packages/contracts/content-template.js';

type SpuFacts = { positioning?: string; targetAudience?: string; coreClaims?: string[]; dynamicAttributes?: Record<string,string|string[]>; categoryCode?: string };
export function spuFacts(store: Store, product: Product): SpuFacts | null {
  if (!product.spuId) return null;
  const row = store.db.prepare('SELECT s.positioning,s.target_audience,s.core_claims,s.dynamic_attributes,c.code AS category_code FROM spus s LEFT JOIN categories c ON c.id=s.category_id WHERE s.id=?').get(product.spuId);
  if (!row) return null;
  return { positioning: String(row.positioning), targetAudience: String(row.target_audience), coreClaims: JSON.parse(String(row.core_claims)), dynamicAttributes: JSON.parse(String(row.dynamic_attributes)), categoryCode: row.category_code ? String(row.category_code) : undefined };
}
export function factsForPage(store: Store, product: Product, page: Kit['pages'][number]): Fact[] { return productFacts(product, page, spuFacts(store, product)); }

export type TemplatePageOverview = {
  pageId: string; templateId: string; name: string; generationMode: string; state: TemplateState;
  missingFields: string[]; missingLabels: string[]; copyStatus: 'draft'|'confirmed'; canGenerateCopy: boolean; canGenerateVisual: boolean; hasCopyCandidate: boolean; hasVisualCandidate: boolean;
};
export function templateOverview(store: Store, kit: Kit): { templateName: string; facts: Fact[]; pages: TemplatePageOverview[] } {
  const product = store.product(kit.productId, kit.productVersion), pages = hydrateTemplatePages(kit.pages), allFacts = new Map<string,Fact>();
  const result = pages.map(page => {
    const definition = templateById(page.templateId), facts = factsForPage(store, product, page); facts.forEach(fact => allFacts.set(fact.id, fact));
    const missing = definition ? missingFields(definition, facts) : ['template'];
    const latest = store.db.prepare("SELECT j.operation,t.state FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.kit_id=? AND j.kit_version=? AND t.page_id=? ORDER BY t.created_at DESC,t.rowid DESC").all(kit.id,kit.version,page.id);
    const copyTaskState=String(latest.find(item=>item.operation==='copy')?.state??''), imageTaskState=String(latest.find(item=>item.operation==='image')?.state??'');
    const activeStates=['queued','running','waiting_external','saving_result'], failedStates=['failed','cancelled','needs_reconciliation'];
    let state: TemplateState = missing.length ? 'MISSING_DATA' : 'READY';
    if (!missing.length) { if (activeStates.includes(copyTaskState)||activeStates.includes(imageTaskState)) state='GENERATING'; else if (page.reviewed && page.copyStatus === 'confirmed') state='REVIEWED'; else if (page.visualArtifactId) state='GENERATED'; else if (failedStates.includes(copyTaskState)||failedStates.includes(imageTaskState)) state='FAILED'; }
    return { pageId: page.id, templateId: definition?.id ?? page.templateId ?? '', name: definition?.name ?? page.purpose, generationMode: definition?.generationMode ?? 'fixed', state, missingFields: missing, missingLabels: missing.map(missingFieldLabel), copyStatus: page.copyStatus ?? 'draft', canGenerateCopy: missing.length === 0&&!activeStates.includes(copyTaskState), canGenerateVisual: missing.length === 0 && page.copyStatus === 'confirmed'&&!activeStates.includes(imageTaskState), hasCopyCandidate: page.copyStatus !== 'confirmed' && copyTaskState === 'succeeded', hasVisualCandidate: !page.visualArtifactId && imageTaskState === 'succeeded' };
  });
  return { templateName: '淘宝日化商品图 5+12', facts: [...allFacts.values()], pages: result };
}
export function addProjectEventForKit(store: Store, kitId: string, eventType: string, note: string) {
  const row = store.db.prepare('SELECT s.product_project_id FROM kits k JOIN spus s ON s.id=k.spu_id WHERE k.id=?').get(kitId);
  if (row?.product_project_id) store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), String(row.product_project_id), null, null, eventType, note, new Date().toISOString());
}

export function deliveryPageIssues(store: Store, kit: Kit, page: Kit['pages'][number]): string[] {
    const sku = store.product(kit.productId, kit.productVersion);
    const issues = [...pageIssues(page, sku, store.listAssets(sku.id)), ...layoutIssues(page)];
    if (store.product(sku.id).version !== kit.productVersion) issues.push('商品资料已有新版本，请先同步内容方案');
    if (page.copyStatus !== 'confirmed') issues.push('文案尚未人工确认');
    const definition = templateById(page.templateId);
    if (definition) issues.push(...missingFields(definition, factsForPage(store, sku, page)).map(field => `缺少模板资料：${field}`));
    if (page.claimIds.some(id => sku.claims.find(claim => claim.id === id)?.status !== 'approved')) issues.push('页面引用未确认卖点');
    const confirmedFacts = new Set(factsForPage(store, sku, page).filter(fact => fact.confirmed).map(fact => fact.id));
    if (page.sourceFactIds.some(id => !confirmedFacts.has(id))) issues.push('文案引用了未确认的产品事实');
    const combined = [page.headline, page.subtitle, page.body].join(' ');
    if (page.templateId === 'D10' && !combined.includes(sku.specification)) issues.push('规格参数页缺少当前 SKU 规格');
    const statedSizes = [...combined.matchAll(/\d+(?:\.\d+)?\s*(?:ml|mL|ML|L|g|kg|克|毫升)/g)].map(match => match[0]!.toLowerCase().replace(/\s/g, ''));
    if (statedSizes.some(size => size !== sku.specification.toLowerCase().replace(/\s/g, ''))) issues.push('页面出现与 SKU 不一致的规格');
    if (/(?:7天见效|零刺激|绝对安全|包治|根治|100%有效)/u.test(combined)) issues.push('包含高风险功效或绝对化表述');
    const duplicates = kit.pages.filter(item => item.id !== page.id && item.headline && item.headline === page.headline);
    if (duplicates.length) issues.push('主标题与其他页面重复');
    if (page.body.trim().length >= 8 && kit.pages.some(item => item.id !== page.id && item.body.trim() === page.body.trim())) issues.push('正文与其他页面重复');
    issues.push(...referencePageIssues(store,page));
    if(page.reviewed&&visualChecklist(store,page.visualArtifactId).some(item=>!page.visualReviewChecks?.includes(item.code)))issues.push('参考图完整候选尚未完成人工视觉清单');
    return [...new Set(issues)];
}
