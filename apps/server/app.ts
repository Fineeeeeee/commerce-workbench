import { registerMarketLearning } from "./market-learning.js";
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import { createReadStream, existsSync } from 'node:fs';
import sharp from 'sharp';
import { join, resolve } from 'node:path';
import { Store, AppError } from './store.js';
import { registerMarket } from './market.js';
import { registerBusiness } from './business.js';
import { registerMarketOpportunities } from './market-opportunity.js';
import { uploadAsset, imageData, transparentSubjectData, exportIssues } from './media.js';
import { registerTasks } from './task-routes.js';
import { copyProfile } from './copy-provider.js';
import { deliveryPageIssues, templateOverview } from './content-service.js';
import { imageProfile } from './image-provider.js';
import { artifactImageData } from './image-service.js';
import { randomUUID } from 'node:crypto';
import { diagnostics } from './diagnostics.js';
import type { MarketAiRunner } from './market-ai-service.js';
import { registerMarketResearch } from './market-research.js';
import { registerOverviewWork } from './overview-work.js';
import { registerWorkQueue } from './work-queue.js';
import { registerSystemCopilot } from './system-copilot.js';
import { registerContentProduction } from './content-production.js';
import { registerProductIntelligence } from './product-intelligence.js';
import { registerVisualGuides } from './visual-guide.js';
import { registerVisionInspection } from './vision-inspection.js';
import { registerMarketMonitoring } from './market-monitoring.js';
import { createPages, productInputSchema, kitInputSchema, normalizeReviews, pageIssues, type KitInput } from '../../packages/contracts/domain.js';
import { layoutIssues, renderSvg } from '../../packages/contracts/render.js';

export async function createApp(directory: string, webRoot?: string, marketAiRunner?: MarketAiRunner) {
  const store = new Store(directory);
  const log = diagnostics(directory);
  const app = Fastify({ logger: false, genReqId: () => randomUUID(), requestIdHeader: false, bodyLimit: 512 * 1024, requestTimeout: 120_000 });
  const requestErrors = new WeakMap<object, string>();
  app.addHook('onSend', async (request, reply, payload) => { reply.header('X-Request-Id', request.id); return payload; });
  app.addHook('onResponse', async (request, reply) => { log({ event: 'request', requestId: request.id, method: request.method, route: request.routeOptions.url ?? '/unknown', status: reply.statusCode, durationMs: reply.elapsedTime, code: requestErrors.get(request) }); });
  const hosts = new Set(['127.0.0.1:4380', 'localhost:4380', '127.0.0.1:5178', 'localhost:5178']);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  app.addHook('onRequest', async (request, reply) => {
    if (!hosts.has(request.headers.host ?? '') || (request.headers.origin && !origins.has(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: { code: 'LOCAL_ONLY', message: '仅允许本机工作台访问' } });
    }
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, request, reply) => {
    const send = (status: number, code: string, message: string) => { requestErrors.set(request, code); return reply.code(status).send({ error: { code, message, requestId: request.id, resolution: status === 409 ? 'review_current_state' : status >= 500 ? 'check_service' : 'check_input' } }); };
    if (error instanceof ZodError) return send(400, 'INVALID_INPUT', error.issues.map(i => `${i.path.join('.') || '输入'}：${i.message}`).join('\n'));
    if (error instanceof AppError) return send(error.status, error.code, error.message);
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status === 413) return send(413, 'FILE_TOO_LARGE', '图片超过 15 MB 或请求过大');
    if (status >= 400 && status < 500) return send(status, 'INVALID_REQUEST', '请求格式不正确');
    return send(500, 'INTERNAL_ERROR', '操作未完成，请检查文件和服务状态；数据不会被标记为成功');
  });
  app.addHook('onClose', async () => store.close());
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2, parts: 3 } });
  const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  app.get('/api/health', async () => ({ ok: true, mode: 'local', version: '0.1.0' }));
  registerMarket(app, store);
  registerBusiness(app, store);
  registerMarketOpportunities(app, store, marketAiRunner); registerMarketLearning(app,store);
  registerMarketResearch(app, store);
  registerMarketMonitoring(app, store);
  registerOverviewWork(app, store);
  registerWorkQueue(app, store);
  registerSystemCopilot(app, store);
  registerContentProduction(app, store);
  registerProductIntelligence(app, store);
  registerVisionInspection(app, store);
  registerVisualGuides(app, store);
  registerTasks(app, store, (requestId, jobId) => log({ event: 'task_submitted', requestId, jobId }));
  app.get('/api/products', async () => store.listProducts());
  app.post('/api/products', async (request, reply) => reply.code(201).send(store.createProduct(productInputSchema.parse(request.body))));
  app.get('/api/products/:id', async request => store.product(idOf(request.params)));
  app.get('/api/products/:id/versions/:version', async request => {
    const params = z.object({ id: z.string().uuid(), version: z.coerce.number().int().positive() }).parse(request.params);
    return store.product(params.id, params.version);
  });
  app.put('/api/products/:id', async request => {
    const body = z.object({ baseVersion: z.number().int().positive(), data: productInputSchema }).strict().parse(request.body);
    return store.saveProduct(idOf(request.params), body.baseVersion, body.data);
  });
  app.get('/api/products/:id/assets', async request => store.listAssets(idOf(request.params)));
  app.post('/api/products/:id/assets', async (request, reply) => {
    const productId = idOf(request.params); store.product(productId);
    const file = await request.file();
    if (!file) throw new AppError('INVALID_IMAGE', '请选择图片');
    const buffer = await file.toBuffer();
    const fields = file.fields;
    const source = fields.source && 'value' in fields.source ? String(fields.source.value) : '';
    const rights = fields.rights && 'value' in fields.rights ? String(fields.rights.value) : '';
    if (!source.trim() || source.length > 160 || rights !== 'confirmed') throw new AppError('SOURCE_REQUIRED', '请填写来源并确认具有本次制作的素材使用权');
    return reply.code(201).send(await uploadAsset(store, productId, buffer, file.filename, source));
  });
  app.get('/api/assets/:id/content', async (request, reply) => {
    const { asset, path } = store.asset(idOf(request.params));
    if (!existsSync(join(directory, path))) throw new AppError('ASSET_MISSING', '原始素材文件缺失，请重新上传', 404);
    const { preview }=z.object({preview:z.literal('1').optional()}).parse(request.query);
    if(preview){
      const thumbnail=await sharp(join(directory,path)).rotate().resize({width:400,height:400,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
      return reply.header('Cache-Control','private, max-age=86400, immutable').type('image/webp').send(thumbnail);
    }
    return reply.type(asset.mime).send(createReadStream(join(directory, path)));
  });
  app.get('/api/artifacts/:id/content', async (request, reply) => {
    const artifactId = idOf(request.params);
    const row = store.db.prepare("SELECT relative_path,mime FROM artifacts WHERE id=? AND kind='image'").get(artifactId);
    if (!row?.relative_path || row.mime !== 'image/png' || !existsSync(join(directory, String(row.relative_path)))) throw new AppError('NOT_FOUND', '视觉候选不存在', 404);
    return reply.type('image/png').send(createReadStream(join(directory, String(row.relative_path))));
  });
  app.get('/api/products/:id/kits', async request => { store.product(idOf(request.params)); return store.listKits(idOf(request.params)); });
  app.post('/api/products/:id/kits', async (request, reply) => {
    const product = store.product(idOf(request.params));
    const body = z.object({ name: z.string().trim().min(1).max(80), detailCount: z.number().int().min(11).max(20) }).strict().parse(request.body);
    const assets = store.listAssets(product.id);
    const data = kitInputSchema.parse({ name: body.name, productVersion: product.version, pages: createPages(product, body.detailCount, assets[0]?.id ?? null) });
    return reply.code(201).send(store.createKit(product.id, data));
  });
  app.get('/api/kits/:id', async request => store.kit(idOf(request.params)));
  app.get('/api/kits/:id/template-overview', async request => { const kit = store.kit(idOf(request.params)); return templateOverview(store, kit); });
  function validateKit(kitId: string, productId: string, data: KitInput) {
    const product = store.product(productId, data.productVersion), assets = store.listAssets(productId);
    for (const page of data.pages) {
      if (page.assetId && !assets.some(a => a.id === page.assetId)) throw new AppError('ASSET_OWNERSHIP', '不能引用其他商品的素材');
      if (page.visualArtifactId) {
        const visual = store.db.prepare("SELECT a.id,a.validated_data FROM artifacts a JOIN tasks t ON t.id=a.task_id JOIN jobs j ON j.id=t.job_id WHERE a.id=? AND a.kind='image' AND t.state='succeeded' AND j.kit_id=?").get(page.visualArtifactId, kitId);
        if (!visual) throw new AppError('ARTIFACT_OWNERSHIP', '不能引用其他设计稿或未完成的视觉候选');
        const metadata=JSON.parse(String(visual.validated_data));
        if((metadata.visualMode??'BACKGROUND')!==(page.visualMode??'BACKGROUND'))throw new AppError('ARTIFACT_TYPE_MISMATCH','视觉产物类型不能自行修改',409);
        if(metadata.visualMode==='REFERENCE_IMAGE'&&metadata.pageId!==page.id)throw new AppError('ARTIFACT_PAGE_MISMATCH','完整视觉仅能用于生成时的页面',409);
      }
      if (page.claimIds.some(id => !product.claims.some(c => c.id === id))) throw new AppError('CLAIM_REFERENCE', '卖点引用无效，请重新选择');
      if (page.reviewed) {
        const errors = deliveryPageIssues(store, { ...store.kit(kitId), ...data }, page);
        if (errors.length) throw new AppError('REVIEW_REQUIRED', `${page.purpose}：${errors.join('、')}`, 409);
      }
    }
  }
  app.put('/api/kits/:id', async request => {
    const id = idOf(request.params), previous = store.kit(id);
    const body = z.object({ baseVersion: z.number().int().positive(), data: kitInputSchema }).strict().parse(request.body);
    if (body.data.productVersion !== store.product(previous.productId).version) throw new AppError('PRODUCT_CHANGED', '商品资料已更新，请先同步最新资料', 409);
    const data = normalizeReviews(body.data, previous);
    for (const page of data.pages) if (page.reviewed && !previous.pages.find(item => item.id === page.id)?.reviewed) {
      const batch = store.db.prepare('SELECT id FROM content_production_batches WHERE kit_id=? AND EXISTS (SELECT 1 FROM json_each(planned_page_ids) WHERE value=?) ORDER BY created_at DESC LIMIT 1').get(id, page.id);
      if (batch && !store.db.prepare("SELECT id FROM content_quality_results WHERE batch_id=? AND page_id=? AND kit_version=? AND rule_status='PASS' AND human_decision='APPROVE'").get(String(batch.id), page.id, previous.version)) throw new AppError('QUALITY_REVIEW_REQUIRED', '该生产批次页面须先通过质检并完成人工审核', 409);
    }
    validateKit(id, previous.productId, data);
    return store.saveKit(id, body.baseVersion, data);
  });
  app.get('/api/kits/:id/revisions', async request => store.revisions(idOf(request.params)));
  app.get('/api/kits/:id/revisions/:version', async request => {
    const params = z.object({ id: z.string().uuid(), version: z.coerce.number().int().positive() }).parse(request.params);
    return store.kit(params.id, params.version);
  });
  app.post('/api/kits/:id/restore', async request => {
    const id = idOf(request.params), current = store.kit(id);
    const body = z.object({ version: z.number().int().positive(), baseVersion: z.number().int().positive() }).strict().parse(request.body);
    const old = store.kit(id, body.version), product = store.product(current.productId);
    const data = kitInputSchema.parse({ name: old.name, productVersion: product.version, pages: old.pages.map(p => ({ ...p, reviewed: false, claimIds: p.claimIds.filter(id => product.claims.some(c => c.id === id)) })) });
    validateKit(id, current.productId, data);
    return store.saveKit(id, body.baseVersion, data);
  });
  app.get('/api/kits/:id/check', async request => ({ issues: exportIssues(store, store.kit(idOf(request.params))) }));
  app.get('/api/kits/:id/pages/:pageId/preview', async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), pageId: z.string().uuid() }).parse(request.params);
    const kit = store.kit(params.id), page = kit.pages.find(p => p.id === params.pageId);
    if (!page) throw new AppError('NOT_FOUND', '页面不存在', 404);
    reply.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    return reply.type('image/svg+xml').send(renderSvg(page, store.product(kit.productId, kit.productVersion), await transparentSubjectData(store, page.assetId), page.visualArtifactId ? await artifactImageData(store, page.visualArtifactId) : null));
  });
  app.get('/api/exports', async () => store.exports());
  app.get('/api/exports/:id/download', async (request, reply) => {
    const id = idOf(request.params), path = join(directory, store.exportPath(id));
    if (!existsSync(path)) throw new AppError('EXPORT_MISSING', '导出文件缺失，请重新导出', 404);
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="commerce-${id.slice(0, 8)}.zip"`).send(createReadStream(path));
  });
  app.get('/api/connections', async () => [
    { id: 'copy', name: '广告文案', state: copyProfile() ? 'ready' : 'unconfigured', description: copyProfile() ? '文字服务已配置，可提交单页试运行；尚需人工审核输出。' : '文字服务尚未配置，未发起模型请求。' },
    { id: 'image', name: '视觉候选', state: imageProfile('quality') ? 'ready' : 'unconfigured', description: imageProfile('quality') ? '可基于商品原图生成高质量视觉候选；采用后仍需人工审核。' : '图片服务尚未配置，当前只提供真实素材的模板排版。' },
    { id: 'hot', name: '热点信息', state: 'not_connected', description: 'DailyHotApi 尚未接入；热点榜不能替代淘宝销量。' },
    { id: 'ps', name: 'Photoshop', state: 'not_connected', description: '待确认 PS 版本及分层模板；当前导出 PNG 和设计参数。' },
  ]);
  app.post('/api/ai/:capability', async () => { throw new AppError('CONFIGURATION_MISSING', '真实模型尚未接入，未发起请求，也未产生费用', 503); });
  if (webRoot && existsSync(join(webRoot, 'index.html'))) await app.register(staticFiles, { root: resolve(webRoot), index: 'index.html', dotfiles: 'deny' });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面或接口不存在' } }));
  return { app, store };
}
