import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, type Store } from './store.js';
import { categoryInputSchema, evidenceInputSchema, feedbackInputSchema, projectInputSchema, projectUpdateSchema, skuInputSchema, spuInputSchema, deliveryInputSchema, type BusinessFeedback, type Category, type CategoryTemplate, type ChannelDelivery, type MarketEvidence, type ProductProject, type ProjectDetail, type ProjectEvent, type Spu } from '../../packages/contracts/business.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export function registerBusiness(app: FastifyInstance, store: Store) {
  const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  const projectRow = (row: Row): ProductProject => {
    const brief = parse<{ objective: string; positioning: string; constraints: string[]; notes: string }>(row.brief_data);
    return { id: String(row.id), categoryId: row.category_id ? String(row.category_id) : null, name: String(row.name), status: String(row.status) as ProductProject['status'], projectType: row.project_type ? String(row.project_type) as ProductProject['projectType'] : null, brief, checklist: parse<ProductProject['checklist']>(row.checklist_data), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  };
  const project = (id: string) => { const row = store.db.prepare('SELECT * FROM product_projects WHERE id=?').get(id); if (!row) throw new AppError('NOT_FOUND', '产品项目不存在', 404); return projectRow(row); };
  const evidenceRow = (row: Row): MarketEvidence => ({ id: String(row.id), title: String(row.title), sourceType: String(row.source_type), sourceUrl: row.source_url ? String(row.source_url) : '', summary: String(row.summary), rawContent: String(row.raw_content), createdAt: String(row.created_at) });
  const evidence = (id: string) => { const row = store.db.prepare('SELECT * FROM market_evidence WHERE id=?').get(id); if (!row) throw new AppError('NOT_FOUND', '市场证据不存在', 404); return evidenceRow(row); };
  const spuRow = (row: Row): Spu => ({ id: String(row.id), productProjectId: String(row.product_project_id), categoryId: String(row.category_id), brand: String(row.brand), name: String(row.name), positioning: String(row.positioning), targetAudience: String(row.target_audience), coreClaims: parse<string[]>(row.core_claims), dynamicAttributes: parse<Record<string,string|string[]>>(row.dynamic_attributes), status: String(row.status) as Spu['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) });
  const spu = (id: string) => { const row = store.db.prepare('SELECT * FROM spus WHERE id=?').get(id); if (!row) throw new AppError('NOT_FOUND', 'SPU不存在', 404); return spuRow(row); };
  const deliveryRow = (row: Row): ChannelDelivery => ({ id: String(row.id), projectId: String(row.project_id), spuId: String(row.spu_id), skuId: row.sku_id ? String(row.sku_id) : null, channel: String(row.channel), kitId: row.kit_id ? String(row.kit_id) : null, kitVersion: row.kit_version === null ? null : Number(row.kit_version), deliveredAt: String(row.delivered_at), status: String(row.status) as ChannelDelivery['status'], notes: String(row.notes), createdAt: String(row.created_at) });
  const feedbackRow = (row: Row): BusinessFeedback => ({ id: String(row.id), projectId: String(row.project_id), skuId: String(row.sku_id), channel: String(row.channel), periodStart: String(row.period_start), periodEnd: String(row.period_end), sales: row.sales === null ? null : Number(row.sales), impressions: row.impressions === null ? null : Number(row.impressions), clickRate: row.click_rate === null ? null : Number(row.click_rate), conversionRate: row.conversion_rate === null ? null : Number(row.conversion_rate), refundRate: row.refund_rate === null ? null : Number(row.refund_rate), operationFeedback: String(row.operation_feedback), userFeedback: String(row.user_feedback), createdAt: String(row.created_at) });
  const addEvent = (projectId: string, eventType: string, note: string, fromStatus: string | null = null, toStatus: string | null = null) => store.db.prepare('INSERT INTO project_stage_events VALUES (?,?,?,?,?,?,?)').run(randomUUID(), projectId, fromStatus, toStatus, eventType, note, now());
  const eventRows = (projectId: string): ProjectEvent[] => store.db.prepare('SELECT * FROM project_stage_events WHERE project_id=? ORDER BY created_at DESC,rowid DESC').all(projectId).map(row => ({ id: String(row.id), projectId, fromStatus: row.from_status ? String(row.from_status) as ProductProject['status'] : null, toStatus: row.to_status ? String(row.to_status) as ProductProject['status'] : null, eventType: String(row.event_type), note: String(row.note), createdAt: String(row.created_at) }));
  const category = (id: string): Category => {
    const row = store.db.prepare('SELECT * FROM categories WHERE id=?').get(id); if (!row) throw new AppError('NOT_FOUND', '类目不存在', 404);
    const template = store.db.prepare('SELECT * FROM category_template_versions WHERE category_id=? ORDER BY version DESC LIMIT 1').get(id);
    const templateData = template ? parse<Pick<CategoryTemplate, 'name' | 'fields'>>(template.schema_data) : null;
    return { id, parentId: row.parent_id ? String(row.parent_id) : null, code: String(row.code), name: String(row.name), template: template && templateData ? { categoryId: id, version: Number(template.version), ...templateData } : null };
  };
  const details = (id: string): ProjectDetail => {
    const value = project(id), categoryValue = value.categoryId ? category(value.categoryId) : null;
    const evidenceList = store.db.prepare('SELECT e.* FROM market_evidence e JOIN project_evidence pe ON pe.evidence_id=e.id WHERE pe.project_id=? ORDER BY pe.created_at DESC').all(id).map(evidenceRow);
    const spus = store.db.prepare('SELECT * FROM spus WHERE product_project_id=? ORDER BY created_at').all(id).map(row => { const value = spuRow(row), skus = store.db.prepare('SELECT id FROM products WHERE spu_id=? ORDER BY updated_at DESC').all(value.id).map(item => store.product(String(item.id))); return { ...value, skus, kits: skus.flatMap(sku => store.listKits(sku.id)) }; });
    const independentSkus = store.db.prepare('SELECT sku_id FROM project_independent_skus WHERE project_id=? ORDER BY created_at DESC').all(id).map(row => store.product(String(row.sku_id)));
    return { project: value, category: categoryValue, evidence: evidenceList, spus, independentSkus, independentKits: independentSkus.flatMap(sku => store.listKits(sku.id)), deliveries: store.db.prepare('SELECT * FROM channel_deliveries WHERE project_id=? ORDER BY delivered_at DESC,rowid DESC').all(id).map(deliveryRow), feedback: store.db.prepare('SELECT * FROM business_feedback WHERE project_id=? ORDER BY period_end DESC,rowid DESC').all(id).map(feedbackRow), events: eventRows(id) };
  };

  app.get('/api/categories', async () => store.db.prepare('SELECT id FROM categories ORDER BY rowid').all().map(row => category(String(row.id))));
  app.post('/api/categories', async (request, reply) => {
    const input=categoryInputSchema.parse(request.body), id=randomUUID(),time=now();
    const parent=input.preset ? store.db.prepare("SELECT id FROM categories WHERE code='personal-care'").get() : input.parentId ? store.db.prepare('SELECT id FROM categories WHERE id=?').get(input.parentId) : null;
    if ((input.preset || input.parentId) && !parent) throw new AppError('CATEGORY_PARENT_MISSING','上级类目不存在',409);
    const code=input.preset==='facial_cleanser'?'facial-cleanser':`custom-${id.slice(0,12)}`;
    if (store.db.prepare('SELECT id FROM categories WHERE code=?').get(code)) throw new AppError('CATEGORY_ALREADY_EXISTS','该品类已存在，请在列表中选择',409);
    if (store.db.prepare('SELECT id FROM categories WHERE name=? AND parent_id IS ?').get(input.preset==='facial_cleanser'?'洗面奶':input.name,parent?String(parent.id):null)) throw new AppError('CATEGORY_ALREADY_EXISTS','同一层级已有该类目，请在列表中选择',409);
    store.db.prepare('INSERT INTO categories (id,parent_id,code,name,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,parent?String(parent.id):null,code,input.preset==='facial_cleanser'?'洗面奶':input.name,time,time);
    return reply.code(201).send(category(id));
  });
  app.get('/api/content-templates', async () => store.db.prepare('SELECT id,name,channel,category_id,version,status FROM content_templates ORDER BY name').all().map(row => ({ id: String(row.id), name: String(row.name), channel: String(row.channel), categoryId: row.category_id ? String(row.category_id) : null, version: Number(row.version), status: String(row.status) })));
  app.get('/api/market-evidence', async () => store.db.prepare('SELECT * FROM market_evidence ORDER BY created_at DESC,rowid DESC').all().map(row => ({ ...evidenceRow(row), references: {
    projects: store.db.prepare('SELECT p.id,p.name FROM project_evidence link JOIN product_projects p ON p.id=link.project_id WHERE link.evidence_id=? ORDER BY p.name,p.id').all(String(row.id)).map(project => ({id:String(project.id),name:String(project.name)})),
    opportunities: store.db.prepare('SELECT id,title,status FROM product_opportunities WHERE evidence_id=? ORDER BY created_at,id').all(String(row.id)).map(opportunity => ({id:String(opportunity.id),title:String(opportunity.title),status:String(opportunity.status)})),
  } })));
  app.post('/api/market-evidence', async (request, reply) => { const input = evidenceInputSchema.parse(request.body), id = randomUUID(), time = now(); store.db.prepare('INSERT INTO market_evidence VALUES (?,?,?,?,?,?,?)').run(id, input.title, input.sourceType, input.sourceUrl || null, input.summary, input.rawContent, time); return reply.code(201).send(evidence(id)); });
  app.get('/api/product-projects', async () => store.db.prepare('SELECT * FROM product_projects ORDER BY updated_at DESC,rowid DESC').all().map(projectRow));
  app.get('/api/products/:id/business-context', async request => {
    const product = store.product(idOf(request.params));
    if (!product.spuId) { const row = store.db.prepare('SELECT p.id,p.name FROM product_projects p JOIN project_independent_skus link ON link.project_id=p.id WHERE link.sku_id=?').get(product.id); return { project: row ? { id: String(row.id), name: String(row.name) } : null, spu: null }; }
    const row = store.db.prepare(`SELECT s.id AS spu_id,s.brand,s.name AS spu_name,p.id AS project_id,p.name AS project_name
      FROM spus s JOIN product_projects p ON p.id=s.product_project_id WHERE s.id=?`).get(product.spuId);
    if (!row) return { project: null, spu: null };
    return { project: { id: String(row.project_id), name: String(row.project_name) }, spu: { id: String(row.spu_id), brand: String(row.brand), name: String(row.spu_name) } };
  });
  app.post('/api/product-projects', async (request, reply) => { const input = projectInputSchema.parse(request.body), id = randomUUID(), time = now(); if (input.categoryId) category(input.categoryId); store.transaction(() => { store.db.prepare('INSERT INTO product_projects (id,category_id,name,status,brief_data,checklist_data,created_at,updated_at,project_type) VALUES (?,?,?,?,?,?,?,?,?)').run(id, input.categoryId, input.name, 'DRAFT', JSON.stringify({ objective: input.objective, positioning: input.positioning, constraints: input.constraints, notes: input.notes }), JSON.stringify({ formulaConfirmed: false, packagingConfirmed: false, contentCompleted: false }), time, time, input.projectType); addEvent(id, 'PROJECT_CREATED', '建立产品项目', null, 'DRAFT'); }); return reply.code(201).send(details(id)); });
  app.get('/api/product-projects/:id', async request => details(idOf(request.params)));
  app.put('/api/product-projects/:id', async request => {
    const id = idOf(request.params), input = projectUpdateSchema.parse(request.body), current = project(id); if (current.updatedAt !== input.expectedUpdatedAt) throw new AppError('VERSION_CONFLICT', '产品项目已更新，请重新加载', 409); if (input.data.categoryId) category(input.data.categoryId); if (current.projectType !== null && input.data.projectType === null) throw new AppError('PROJECT_TYPE_REQUIRED', '已确认的项目性质不能清空', 409);
    const allowed: Record<ProductProject['status'], ProductProject['status'][]> = { DRAFT: ['DRAFT','EVALUATING','CLOSED'], EVALUATING: ['DRAFT','EVALUATING','APPROVED','CLOSED'], APPROVED: ['APPROVED','DEVELOPING','CLOSED'], DEVELOPING: ['DEVELOPING','READY','CLOSED'], READY: ['DEVELOPING','READY','LAUNCHED','CLOSED'], LAUNCHED: ['LAUNCHED','CLOSED'], CLOSED: ['CLOSED'] };
    if (!allowed[current.status].includes(input.status)) throw new AppError('INVALID_STAGE', `不能从${current.status}直接进入${input.status}`, 409);
    const time = now(); store.transaction(() => { store.db.prepare('UPDATE product_projects SET category_id=?,name=?,status=?,brief_data=?,checklist_data=?,updated_at=?,project_type=? WHERE id=?').run(input.data.categoryId, input.data.name, input.status, JSON.stringify({ objective: input.data.objective, positioning: input.data.positioning, constraints: input.data.constraints, notes: input.data.notes }), JSON.stringify(input.checklist), time, input.data.projectType, id); if (current.projectType === null && input.data.projectType !== null) addEvent(id, 'PROJECT_TYPE_CONFIRMED', `确认项目性质：${input.data.projectType === 'NEW_PRODUCT' ? '新品/机会型' : '已有商品运营型'}`); addEvent(id, current.status === input.status ? 'PROJECT_UPDATED' : 'STAGE_CHANGED', input.note, current.status, input.status); }); return details(id);
  });
  app.post('/api/product-projects/:id/evidence', async (request, reply) => { const projectId = idOf(request.params), input = z.object({ evidenceId: z.string().uuid(), note: z.string().trim().max(1000) }).strict().parse(request.body); project(projectId); evidence(input.evidenceId); store.transaction(() => { store.db.prepare('INSERT INTO project_evidence VALUES (?,?,?,?)').run(projectId, input.evidenceId, input.note, now()); addEvent(projectId, 'EVIDENCE_LINKED', input.note || '关联市场证据'); }); return reply.code(201).send(details(projectId)); });
  app.post('/api/product-projects/:id/spus', async (request, reply) => { const projectId = idOf(request.params), projectValue = project(projectId), input = spuInputSchema.parse(request.body); category(input.categoryId); if (projectValue.categoryId && projectValue.categoryId !== input.categoryId) throw new AppError('CATEGORY_MISMATCH', 'SPU类目必须与产品项目一致', 409); const id = randomUUID(), time = now(); store.transaction(() => { store.db.prepare('INSERT INTO spus VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, input.categoryId, input.brand, input.name, input.positioning, input.targetAudience, JSON.stringify(input.coreClaims), JSON.stringify(input.dynamicAttributes), input.status, time, time); addEvent(projectId, 'SPU_CREATED', `建立SPU：${input.name}`); }); return reply.code(201).send(spu(id)); });
  app.patch('/api/spus/:id/ingredients', async request => {
    const id = idOf(request.params), current = spu(id);
    const input = z.object({ expectedUpdatedAt: z.string().min(1), ingredients: z.array(z.string().trim().min(1).max(200)).min(1).max(50) }).strict().parse(request.body);
    if (current.updatedAt !== input.expectedUpdatedAt) throw new AppError('VERSION_CONFLICT', '产品定义已更新，请重新加载', 409);
    if (category(current.categoryId).code !== 'shampoo') throw new AppError('CATEGORY_MISMATCH', '当前类目不使用洗发水成分模板', 409);
    const ingredients = [...new Set(input.ingredients)];
    store.transaction(() => {
      store.db.prepare('UPDATE spus SET dynamic_attributes=?,updated_at=? WHERE id=?').run(JSON.stringify({ ...current.dynamicAttributes, ingredients }), now(), id);
      addEvent(current.productProjectId, 'SPU_INGREDIENTS_UPDATED', `补录${current.name}的主要成分（${ingredients.length}项）`);
    });
    return spu(id);
  });
  app.patch('/api/spus/:id/fragrance-notes', async request => {
    const id = idOf(request.params), current = spu(id);
    const input = z.object({
      expectedUpdatedAt: z.string().min(1),
      topNotes: z.string().trim().min(1).max(200),
      middleNotes: z.string().trim().min(1).max(200),
      baseNotes: z.string().trim().min(1).max(200),
    }).strict().parse(request.body);
    if (current.updatedAt !== input.expectedUpdatedAt) throw new AppError('VERSION_CONFLICT', '产品定义已更新，请重新加载', 409);
    if (category(current.categoryId).code !== 'shampoo') throw new AppError('CATEGORY_MISMATCH', '当前类目不使用洗发水香调模板', 409);
    store.transaction(() => {
      store.db.prepare('UPDATE spus SET dynamic_attributes=?,updated_at=? WHERE id=?').run(JSON.stringify({
        ...current.dynamicAttributes,
        topNotes: input.topNotes,
        middleNotes: input.middleNotes,
        baseNotes: input.baseNotes,
      }), now(), id);
      addEvent(current.productProjectId, 'SPU_FRAGRANCE_NOTES_UPDATED', `补录${current.name}的前中后调`);
    });
    return spu(id);
  });
  app.post('/api/spus/:id/skus', async (request, reply) => { const spuValue = spu(idOf(request.params)), input = skuInputSchema.parse(request.body); const product = store.createProduct({ name: spuValue.name, brand: spuValue.brand, variant: input.variant, specification: input.specification, audience: spuValue.targetAudience, origin: input.origin, notes: input.notes, claims: input.claims }, spuValue.id); addEvent(spuValue.productProjectId, 'SKU_CREATED', `建立SKU：${input.specification}${input.variant ? ` · ${input.variant}` : ''}`); return reply.code(201).send(product); });
  app.get('/api/channel-deliveries', async request => { const query = z.object({ projectId: z.string().uuid().optional() }).parse(request.query); return (query.projectId ? store.db.prepare('SELECT * FROM channel_deliveries WHERE project_id=? ORDER BY delivered_at DESC').all(query.projectId) : store.db.prepare('SELECT * FROM channel_deliveries ORDER BY delivered_at DESC').all()).map(deliveryRow); });
  app.post('/api/channel-deliveries', async (request, reply) => { const input = deliveryInputSchema.parse(request.body), projectValue = project(input.projectId), spuValue = spu(input.spuId); if (spuValue.productProjectId !== projectValue.id) throw new AppError('OWNERSHIP_MISMATCH', 'SPU不属于该产品项目', 409); if (input.skuId && store.product(input.skuId).spuId !== input.spuId) throw new AppError('OWNERSHIP_MISMATCH', 'SKU不属于该SPU', 409); if (input.kitId) { const kit = store.kit(input.kitId, input.kitVersion!); if (input.skuId && kit.productId !== input.skuId) throw new AppError('OWNERSHIP_MISMATCH', '内容版本不属于该SKU', 409); } const id = randomUUID(), time = now(); store.transaction(() => { store.db.prepare('INSERT INTO channel_deliveries VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, input.projectId, input.spuId, input.skuId, input.channel, input.kitId, input.kitVersion, input.deliveredAt, input.status, input.notes, time); addEvent(input.projectId, 'CHANNEL_DELIVERY', `${input.channel} · ${input.status}`); }); return reply.code(201).send(deliveryRow(store.db.prepare('SELECT * FROM channel_deliveries WHERE id=?').get(id)!)); });
  app.get('/api/business-feedback', async request => { const query = z.object({ projectId: z.string().uuid().optional() }).parse(request.query); return (query.projectId ? store.db.prepare('SELECT * FROM business_feedback WHERE project_id=? ORDER BY period_end DESC').all(query.projectId) : store.db.prepare('SELECT * FROM business_feedback ORDER BY period_end DESC').all()).map(feedbackRow); });
  app.post('/api/business-feedback', async (request, reply) => { const input = feedbackInputSchema.parse(request.body), projectValue = project(input.projectId), product = store.product(input.skuId), spuValue = product.spuId ? spu(product.spuId) : null; if (!spuValue || spuValue.productProjectId !== projectValue.id) throw new AppError('OWNERSHIP_MISMATCH', 'SKU不属于该产品项目', 409); const id = randomUUID(), time = now(); store.transaction(() => { store.db.prepare('INSERT INTO business_feedback VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.projectId, input.skuId, input.channel, input.periodStart, input.periodEnd, input.sales, input.impressions, input.clickRate, input.conversionRate, input.refundRate, input.operationFeedback, input.userFeedback, time); addEvent(input.projectId, 'FEEDBACK_RECORDED', `${input.channel} · ${input.periodStart} 至 ${input.periodEnd}`); }); return reply.code(201).send(feedbackRow(store.db.prepare('SELECT * FROM business_feedback WHERE id=?').get(id)!)); });
  app.get('/api/business-summary', async () => ({
    projects: store.db.prepare('SELECT status,count(*) count FROM product_projects GROUP BY status').all(),
    evidenceCount: Number(store.db.prepare('SELECT count(*) count FROM market_evidence').get()!.count),
    spuCount: Number(store.db.prepare('SELECT count(*) count FROM spus').get()!.count),
    skuCount: Number(store.db.prepare('SELECT count(*) count FROM products').get()!.count),
    recentEvents: store.db.prepare('SELECT e.*,p.name project_name FROM project_stage_events e JOIN product_projects p ON p.id=e.project_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT 8').all().map(row => ({ ...row, id: String(row.id) })),
    recentContent: store.db.prepare('SELECT k.id,k.product_id,k.version,k.updated_at,pv.data product_data,kv.data kit_data FROM kits k JOIN products p ON p.id=k.product_id JOIN product_versions pv ON pv.product_id=p.id AND pv.version=p.version JOIN kit_versions kv ON kv.kit_id=k.id AND kv.version=k.version ORDER BY k.updated_at DESC LIMIT 6').all().map(row => ({ id: String(row.id), skuId: String(row.product_id), version: Number(row.version), updatedAt: String(row.updated_at), productName: parse<{ name: string }>(row.product_data).name, name: parse<{ name: string }>(row.kit_data).name })),
  }));
}
