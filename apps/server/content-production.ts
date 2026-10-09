import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, type Store } from './store.js';
import { requireModelProfile } from './model-router.js';
import { requestStructured } from './structured-model-provider.js';
import { deliveryPageIssues, factsForPage, spuFacts } from './content-service.js';
import { visualChecklist } from './visual-guide.js';
import { productFacts } from '../../packages/contracts/content-template.js';

const uuid = z.string().uuid();
const now = () => new Date().toISOString();
const idOf = (params: unknown) => z.object({ id: uuid }).parse(params).id;
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

function projectForSku(store: Store, skuId: string): string | null {
  const sku = store.product(skuId);
  if (sku.spuId) {
    const row = store.db.prepare('SELECT product_project_id FROM spus WHERE id=?').get(sku.spuId);
    return row ? String(row.product_project_id) : null;
  }
  const row = store.db.prepare('SELECT project_id FROM project_independent_skus WHERE sku_id=?').get(skuId);
  return row ? String(row.project_id) : null;
}

export function qualityAppliesToCurrentPage(store: Store, result: Record<string, unknown>): boolean {
  const current = store.kit(String(result.kit_id));
  const evaluated = store.kit(current.id, Number(result.kit_version));
  if (current.productVersion !== evaluated.productVersion) return false;
  if (current.spuId) {
    const spu = store.db.prepare('SELECT updated_at FROM spus WHERE id=?').get(current.spuId);
    if (!spu || String(spu.updated_at) > String(result.created_at)) return false;
  }
  const page = current.pages.find(item => item.id === result.page_id);
  const original = evaluated.pages.find(item => item.id === result.page_id);
  if (!page || !original) return false;
  const content = (value: typeof page) => JSON.stringify({ ...value, reviewed: false, visualReviewChecks: undefined });
  if (content(page) !== content(original)) return false;
  if (result.human_decision === 'APPROVE') return page.reviewed;
  if (result.human_decision === 'REJECT') return !page.reviewed;
  // AI text checks include other pages; reuse only when their content is unchanged.
  return JSON.stringify(current.pages.map(content)) === JSON.stringify(evaluated.pages.map(content));
}

export function registerContentProduction(app: FastifyInstance, store: Store) {
  app.get('/api/products/:id/existing-project', async request => {
    const skuId = idOf(request.params);
    const projectId = projectForSku(store, skuId);
    const project = projectId ? store.db.prepare('SELECT id,name,project_type FROM product_projects WHERE id=?').get(projectId) : null;
    return { skuId, project: project ? { id: String(project.id), name: String(project.name), projectType: project.project_type } : null };
  });

  app.post('/api/products/:id/existing-project/confirm', async request => {
    const skuId = idOf(request.params);
    z.object({ confirmExistingProduct: z.literal(true) }).strict().parse(request.body);
    const projectId = projectForSku(store, skuId);
    if (!projectId) throw new AppError('PROJECT_REQUIRED', '此商品尚未关联项目', 409);
    const project = store.db.prepare('SELECT project_type FROM product_projects WHERE id=?').get(projectId);
    if (!project || project.project_type === 'NEW_PRODUCT') throw new AppError('PROJECT_TYPE_CONFLICT', '新品项目不能改作已有商品运营项目', 409);
    if (project.project_type === null) store.transaction(() => {
      store.db.prepare("UPDATE product_projects SET project_type='EXISTING_PRODUCT',updated_at=? WHERE id=? AND project_type IS NULL").run(now(), projectId);
      store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, null, 'PROJECT_TYPE_CONFIRMED', '确认项目性质：已有商品运营', now());
    });
    return { projectId, projectType: 'EXISTING_PRODUCT' };
  });

  app.post('/api/products/:id/existing-project', async (request, reply) => {
    const skuId = idOf(request.params), sku = store.product(skuId);
    const input = z.object({ projectName: z.string().trim().min(1).max(120), categoryId: uuid, confirmExistingProduct: z.literal(true) }).strict().parse(request.body);
    const existing = projectForSku(store, skuId);
    if (existing) throw new AppError('SKU_ALREADY_ASSIGNED', '该商品已有所属项目，请进入原项目', 409);
    if (sku.spuId) throw new AppError('SKU_ALREADY_ASSIGNED', '该商品属于已有 SPU，请进入原项目', 409);
    if (!store.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId)) throw new AppError('CATEGORY_NOT_FOUND', '请选择真实类目', 404);
    const projectId = randomUUID(), time = now();
    store.transaction(() => {
      store.db.prepare('INSERT INTO product_projects (id,category_id,name,status,brief_data,checklist_data,created_at,updated_at,project_type) VALUES (?,?,?,?,?,?,?,?,?)').run(projectId, input.categoryId, input.projectName, 'DRAFT', JSON.stringify({ objective: '', positioning: '', constraints: [], notes: '' }), JSON.stringify({ formulaConfirmed: false, packagingConfirmed: false, contentCompleted: false }), time, time, 'EXISTING_PRODUCT');
      store.db.prepare('INSERT INTO project_independent_skus VALUES (?,?,?)').run(skuId, projectId, time);
      store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, null, 'DRAFT', 'EXISTING_SKU_ATTACHED', `关联已有 SKU：${sku.name} ${sku.specification}`, time);
    });
    return reply.code(201).send({ projectId, skuId });
  });

  app.get('/api/product-projects/:id/content-directions', async request => {
    const projectId = idOf(request.params);
    if (!store.db.prepare('SELECT id FROM product_projects WHERE id=?').get(projectId)) throw new AppError('NOT_FOUND', '项目不存在', 404);
    return store.db.prepare('SELECT * FROM content_direction_candidates WHERE project_id=? ORDER BY created_at DESC').all(projectId).map(row => ({
      id: String(row.id), projectId, skuId: String(row.sku_id), title: String(row.title), objective: String(row.objective), factRefs: parse<string[]>(row.fact_refs), marketRefs: parse<string[]>(row.market_refs), aiSuggestion: row.ai_suggestion ? parse<unknown>(row.ai_suggestion) : null, selectedAt: row.selected_at ? String(row.selected_at) : null, createdAt: String(row.created_at),
    }));
  });

  app.post('/api/product-projects/:id/content-directions', async (request, reply) => {
    const projectId = idOf(request.params);
    const input = z.object({ skuId: uuid, title: z.string().trim().min(1).max(120), objective: z.string().trim().min(1).max(1000), factRefs: z.array(z.string().max(120)).min(1).max(30), marketRefs: z.array(uuid).max(30) }).strict().parse(request.body);
    const project = store.db.prepare('SELECT project_type FROM product_projects WHERE id=?').get(projectId);
    if (!project || project.project_type !== 'EXISTING_PRODUCT' || projectForSku(store, input.skuId) !== projectId) throw new AppError('OWNERSHIP_MISMATCH', '请选择该已有商品运营项目中的 SKU', 409);
    const sku = store.product(input.skuId);
    const allowedFacts = new Set(productFacts(sku, undefined, spuFacts(store, sku)).filter(fact => fact.confirmed && fact.type !== 'asset').map(fact => fact.id));
    if (input.factRefs.some(id => !allowedFacts.has(id))) throw new AppError('FACT_NOT_CONFIRMED', '内容方向只能引用已确认商品事实', 409);
    for (const evidenceId of input.marketRefs) if (!store.db.prepare('SELECT 1 FROM project_evidence WHERE project_id=? AND evidence_id=?').get(projectId, evidenceId)) throw new AppError('EVIDENCE_NOT_LINKED', '市场依据尚未被该项目采用', 409);
    const id = randomUUID(), time = now();
    store.db.prepare('INSERT INTO content_direction_candidates VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, projectId, input.skuId, input.title, input.objective, JSON.stringify(input.factRefs), JSON.stringify(input.marketRefs), null, null, time);
    return reply.code(201).send({ id, projectId, ...input, aiSuggestion: null, selectedAt: null, createdAt: time });
  });

  app.post('/api/product-projects/:id/content-directions/suggest', async (request, reply) => {
    const projectId = idOf(request.params), input = z.object({ skuId: uuid }).strict().parse(request.body);
    const project = store.db.prepare('SELECT project_type FROM product_projects WHERE id=?').get(projectId);
    if (!project || project.project_type !== 'EXISTING_PRODUCT' || projectForSku(store, input.skuId) !== projectId) throw new AppError('OWNERSHIP_MISMATCH', '请选择该已有商品运营项目中的 SKU', 409);
    const sku = store.product(input.skuId);
    const facts = productFacts(sku, undefined, spuFacts(store, sku)).filter(fact => fact.confirmed && fact.type !== 'asset').map(({ id, value }) => ({ id, value }));
    const evidence = store.db.prepare('SELECT e.id,e.title,e.summary FROM market_evidence e JOIN project_evidence pe ON pe.evidence_id=e.id WHERE pe.project_id=? LIMIT 12').all(projectId).map(row => ({ id: String(row.id), title: String(row.title), summary: String(row.summary) }));
    const item = z.object({ title: z.string().trim().min(1).max(120), objective: z.string().trim().min(1).max(1000), fact_refs: z.array(z.string()).min(1).max(10), market_refs: z.array(uuid).max(8), rationale: z.string().trim().min(1).max(600) }).strict();
    const outputSchema = z.object({ candidates: z.array(item).min(1).max(3) }).strict();
    const fieldSchema = { type: 'object', additionalProperties: false, required: ['candidates'], properties: { candidates: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['title','objective','fact_refs','market_refs','rationale'], properties: { title: { type: 'string' }, objective: { type: 'string' }, fact_refs: { type: 'array', items: { type: 'string' } }, market_refs: { type: 'array', items: { type: 'string' } }, rationale: { type: 'string' } } } } } };
    const result = await requestStructured(requireModelProfile('content_direction'), [
      { role: 'system', content: '仅根据已确认商品事实与已关联市场依据提出 1 至 3 个内容表达方向。市场依据只描述市场样本，绝不能把竞品卖点当作本商品功效；本商品主张只能来自 facts。商品事实是客观依据，内容方向是待人工选择的 AI 建议。不得称为热点或新增功效、成分、销量、认证。严格引用输入 ID，只输出 JSON。' },
      { role: 'user', content: JSON.stringify({ facts, project_evidence: evidence }) },
    ], 'content_direction', fieldSchema, outputSchema);
    const factIds = new Set(facts.map(fact => fact.id)), evidenceIds = new Set(evidence.map(item => item.id));
    if (result.output.candidates.some(item => item.fact_refs.some(id => !factIds.has(id)) || item.market_refs.some(id => !evidenceIds.has(id)))) throw new AppError('INVALID_AI_EVIDENCE', 'AI 建议引用了未确认或未关联的资料', 409);
    const time = now(), ids = result.output.candidates.map(() => randomUUID());
    store.transaction(() => result.output.candidates.forEach((item, index) => store.db.prepare('INSERT INTO content_direction_candidates VALUES (?,?,?,?,?,?,?,?,?,?)').run(ids[index]!, projectId, input.skuId, item.title, item.objective, JSON.stringify(item.fact_refs), JSON.stringify(item.market_refs), JSON.stringify({ rationale: item.rationale, modelId: result.modelVersion, requestId: result.requestId }), null, time)));
    return reply.code(201).send({ candidates: result.output.candidates.map((item, index) => ({ id: ids[index], title: item.title, objective: item.objective, factRefs: item.fact_refs, marketRefs: item.market_refs, aiSuggestion: item.rationale })), modelId: result.modelVersion });
  });

  app.post('/api/content-directions/:id/select', async request => {
    const id = idOf(request.params), time = now();
    const row = store.db.prepare('SELECT * FROM content_direction_candidates WHERE id=?').get(id);
    if (!row) throw new AppError('NOT_FOUND', '内容方向不存在', 404);
    store.transaction(() => {
      store.db.prepare('UPDATE content_direction_candidates SET selected_at=NULL WHERE project_id=? AND sku_id=?').run(String(row.project_id), String(row.sku_id));
      store.db.prepare('UPDATE content_direction_candidates SET selected_at=? WHERE id=?').run(time, id);
    });
    return { id, selectedAt: time };
  });

  app.post('/api/content-production-batches', async (request, reply) => {
    const input = z.object({ directionId: uuid, kitId: uuid, pageIds: z.array(uuid).min(1).max(25) }).strict().parse(request.body);
    const key = uuid.parse(request.headers['idempotency-key']);
    const requestHash = createHash('sha256').update(JSON.stringify({ ...input, pageIds: [...input.pageIds].sort() })).digest('hex');
    const scope = `content-batch:${input.kitId}`;
    const previous = store.db.prepare('SELECT * FROM operation_keys WHERE scope=? AND key=?').get(scope, key);
    if (previous) {
      if (previous.request_hash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', '同一提交标识不能用于不同批次', 409);
      return reply.code(200).send({ id: String(previous.resource_id), reused: true });
    }
    const direction = store.db.prepare('SELECT * FROM content_direction_candidates WHERE id=?').get(input.directionId);
    if (!direction || !direction.selected_at) throw new AppError('DIRECTION_NOT_SELECTED', '请先人工选择内容方向', 409);
    const kit = store.kit(input.kitId);
    if (kit.productId !== direction.sku_id || new Set(input.pageIds).size !== input.pageIds.length || input.pageIds.some(id => !kit.pages.some(page => page.id === id))) throw new AppError('BATCH_INPUT_INVALID', '内容方案或页面与所选商品不一致', 409);
    const id = randomUUID(), time = now();
    store.transaction(() => {
      store.db.prepare('INSERT INTO content_production_batches VALUES (?,?,?,?,?,?,?)').run(id, String(direction.project_id), String(direction.sku_id), input.kitId, input.directionId, JSON.stringify(input.pageIds), time);
      store.db.prepare('INSERT INTO operation_keys VALUES (?,?,?,?,?)').run(scope, key, requestHash, id, time);
    });
    return reply.code(201).send({ id, projectId: direction.project_id, skuId: direction.sku_id, ...input, createdAt: time });
  });

  app.get('/api/products/:id/content-production-batches', async request => {
    const skuId = idOf(request.params);
    store.product(skuId);
    const query = z.object({ kitId: uuid.optional() }).parse(request.query);
    return store.db.prepare('SELECT id FROM content_production_batches WHERE sku_id=? AND (? IS NULL OR kit_id=?) ORDER BY created_at DESC').all(skuId, query.kitId ?? null, query.kitId ?? null).map(row => String(row.id));
  });

  app.get('/api/content-production-batches/:id', async request => {
    const id = idOf(request.params), batch = store.db.prepare('SELECT * FROM content_production_batches WHERE id=?').get(id);
    if (!batch) throw new AppError('NOT_FOUND', '生产批次不存在', 404);
    const plannedPageIds = parse<string[]>(batch.planned_page_ids);
    const tasks = store.db.prepare('SELECT j.id job_id,j.operation,t.page_id,t.state FROM jobs j JOIN tasks t ON t.job_id=j.id WHERE j.production_batch_id=? ORDER BY j.created_at,t.ordinal').all(id);
    const quality = store.db.prepare('SELECT * FROM content_quality_results WHERE batch_id=? ORDER BY created_at').all(id);
    const copyGenerated = new Set(tasks.filter(row => row.state === 'succeeded' && row.operation === 'copy').map(row => String(row.page_id)));
    const visualGenerated = new Set(tasks.filter(row => row.state === 'succeeded' && row.operation === 'image').map(row => String(row.page_id)));
    const generated = new Set([...copyGenerated, ...visualGenerated]);
    const submitted = tasks.filter(row => row.operation === 'copy' || row.operation === 'image');
    const attemptedPages = new Set(submitted.map(row => String(row.page_id)));
    const submissions = new Map<string, number>();
    for (const row of submitted) { const key = `${row.operation}:${row.page_id}`; submissions.set(key, (submissions.get(key) ?? 0) + 1); }
    const retries = [...submissions.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
    const firstByPage = new Map<string, Record<string, unknown>>();
    for (const row of quality) if (!firstByPage.has(String(row.page_id))) firstByPage.set(String(row.page_id), row);
    const first = [...firstByPage.values()];
    const firstHumanByPage = new Map<string, Record<string, unknown>>();
    for (const row of quality) if (row.human_decision && !firstHumanByPage.has(String(row.page_id))) firstHumanByPage.set(String(row.page_id), row);
    const firstHuman = [...firstHumanByPage.values()];
    const humanDecisions = quality.filter(row => row.human_decision);
    return { id, projectId: String(batch.project_id), skuId: String(batch.sku_id), kitId: String(batch.kit_id), directionId: String(batch.direction_id), plannedPageIds, tasks, quality: quality.map(row => ({ ...row, appliesToCurrentPage: qualityAppliesToCurrentPage(store, row), visualChecks:visualChecklist(store,store.kit(String(batch.kit_id),Number(row.kit_version)).pages.find(page=>page.id===row.page_id)?.visualArtifactId??null), ruleIssues: parse<unknown>(row.rule_issues), aiIssues: parse<unknown>(row.ai_issues) })), metrics: {
      planned: plannedPageIds.length, generated: generated.size, copyGenerated: copyGenerated.size, visualGenerated: visualGenerated.size,
      ruleEvaluated: first.length, firstRulePassed: first.filter(row => row.rule_status === 'PASS').length,
      firstRulePassRate: first.length ? first.filter(row => row.rule_status === 'PASS').length / first.length : null,
      firstHumanReviewed: firstHuman.length, firstHumanApproved: firstHuman.filter(row => row.human_decision === 'APPROVE').length,
      firstHumanPassRate: firstHuman.length ? firstHuman.filter(row => row.human_decision === 'APPROVE').length / firstHuman.length : null,
      humanRejected: humanDecisions.filter(row => row.human_decision === 'REJECT').length,
      humanDecisionCount: humanDecisions.length,
      returnRate: humanDecisions.length ? humanDecisions.filter(row => row.human_decision === 'REJECT').length / humanDecisions.length : null,
      retries, attemptedPageCount: attemptedPages.size, averageRetries: attemptedPages.size ? retries / attemptedPages.size : null,
    } };
  });

  app.post('/api/content-production-batches/:id/quality/:pageId', async (request, reply) => {
    const params = z.object({ id: uuid, pageId: uuid }).parse(request.params);
    const batch = store.db.prepare('SELECT * FROM content_production_batches WHERE id=?').get(params.id);
    if (!batch || !parse<string[]>(batch.planned_page_ids).includes(params.pageId)) throw new AppError('BATCH_PAGE_NOT_FOUND', '页面不属于该生产批次', 404);
    const kit = store.kit(String(batch.kit_id)), page = kit.pages.find(value => value.id === params.pageId)!;
    const existing = store.db.prepare('SELECT id FROM content_quality_results WHERE batch_id=? AND page_id=? AND kit_version=?').get(params.id, params.pageId, kit.version);
    if (existing) throw new AppError('QUALITY_ALREADY_RECORDED', '当前内容版本已完成质检；修改页面后可重新评估', 409);
    const sku = store.product(String(batch.sku_id), kit.productVersion);
    const issues = deliveryPageIssues(store, kit, page);
    const ruleIssues = [...new Set(issues)];
    let aiStatus: 'NOT_RUN'|'PASS'|'REVIEW'|'FAILED' = 'NOT_RUN';
    let aiIssues: string[] = [];
    if (ruleIssues.length === 0) {
      const aiSchema = z.object({ decision: z.enum(['PASS','REVIEW']), issues: z.array(z.string().trim().min(1).max(200)).max(8) }).strict();
      const jsonSchema = { type: 'object', additionalProperties: false, required: ['decision','issues'], properties: { decision: { type: 'string', enum: ['PASS','REVIEW'] }, issues: { type: 'array', items: { type: 'string' } } } };
      try {
        const result = await requestStructured(requireModelProfile('content_quality'), [
          { role: 'system', content: '仅评价表达是否空泛、卖点是否突出、购买理由是否不足、内容方向是否偏离、多页是否高度同质。不得新增商品事实。只输出 JSON；你的判断仅供人工审核。' },
          { role: 'user', content: JSON.stringify({ direction: store.db.prepare('SELECT title,objective FROM content_direction_candidates WHERE id=?').get(String(batch.direction_id)), page: { headline: page.headline, subtitle: page.subtitle, body: page.body }, otherPages: kit.pages.filter(item => item.id !== page.id).map(item => ({ headline: item.headline, body: item.body })).slice(0, 16) }) },
        ], 'content_quality', jsonSchema, aiSchema);
        aiStatus = result.output.decision;
        aiIssues = result.output.issues;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        aiStatus = 'FAILED'; aiIssues = ['AI 辅助检查未完成，请人工复核'];
      }
    }
    const id = randomUUID(), time = now();
    store.db.prepare('INSERT INTO content_quality_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, params.id, kit.id, kit.version, page.id, ruleIssues.length ? 'FAIL' : 'PASS', JSON.stringify(ruleIssues), aiStatus, JSON.stringify(aiIssues), null, null, time);
    return reply.code(201).send({ id, ruleStatus: ruleIssues.length ? 'FAIL' : 'PASS', ruleIssues, aiStatus, aiIssues, humanDecision: null });
  });

  app.post('/api/content-quality-results/:id/decision', async request => {
    const id = idOf(request.params), input = z.object({ decision: z.enum(['APPROVE','REJECT']), visualChecks:z.array(z.string().max(80)).max(40).default([]) }).strict().parse(request.body);
    const result = store.db.prepare('SELECT * FROM content_quality_results WHERE id=?').get(id);
    if (!result) throw new AppError('NOT_FOUND', '质检记录不存在', 404);
    if (result.human_decision) throw new AppError('ALREADY_REVIEWED', '此版本已有人工作出决定', 409);
    if (input.decision === 'APPROVE' && result.rule_status !== 'PASS') throw new AppError('QUALITY_RULE_FAILED', '确定性规则未通过，不能批准', 409);
    const kit = store.kit(String(result.kit_id));
    if (!qualityAppliesToCurrentPage(store, result)) throw new AppError('VERSION_CONFLICT', '质检依据已改变，请对当前页面重新质检', 409);
    const currentPage = kit.pages.find(page => page.id === result.page_id)!;
    const checklist=visualChecklist(store,currentPage.visualArtifactId);
    if(input.decision==='APPROVE'&&checklist.some(item=>!input.visualChecks.includes(item.code)))throw new AppError('VISUAL_REVIEW_REQUIRED','请逐项核对商品主体、中文和类目禁忌清单',409);
    if (input.decision === 'APPROVE' && deliveryPageIssues(store, kit, currentPage).length) throw new AppError('QUALITY_RULE_FAILED', '当前页面未满足交付规则，请修改后重新质检', 409);
    const saved = store.saveKit(kit.id, kit.version, { name: kit.name, productVersion: kit.productVersion, pages: kit.pages.map(page => page.id === result.page_id ? { ...page, ...(page.visualMode==='REFERENCE_IMAGE'?{visualReviewChecks:input.decision==='APPROVE'?input.visualChecks:[]}:{}), reviewed: input.decision === 'APPROVE' } : page) }, () => {
      const changed = store.db.prepare('UPDATE content_quality_results SET human_decision=?,reviewed_at=? WHERE id=? AND human_decision IS NULL').run(input.decision, now(), id);
      if (changed.changes !== 1) throw new AppError('ALREADY_REVIEWED', '此版本已有人工作出决定', 409);
    });
    return { id, decision: input.decision, kitVersion: saved.version };
  });
}
