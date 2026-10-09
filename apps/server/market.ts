import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Store, AppError } from './store.js';
import { batchSchema, reviewSchema, parseMarketCsv, candidateReason, analyzeMarketEntry, csvText, columns, verdicts, hydrateMarketRow, sourceMetadataSchema, type Batch, type Entry, type Review, type MarketMatch, type MarketSignal, type MarketSummary } from '../../packages/contracts/market.js';

export function registerMarket(app: FastifyInstance, store: Store) {
  const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  function batches(): Batch[] {
    return store.db.prepare('SELECT b.*, (SELECT count(*) FROM market_entries e WHERE e.batch_id=b.id) AS count FROM market_batches b ORDER BY imported_at DESC, rowid DESC').all().map(r => ({ id: String(r.id), name: String(r.name), source: String(r.source), platform: String(r.platform), periodStart: String(r.period_start), periodEnd: String(r.period_end), metricName: String(r.metric_name), metricUnit: String(r.metric_unit), importedAt: String(r.imported_at), count: Number(r.count) }));
  }
  function entry(id: string): Entry {
    const r = store.db.prepare('SELECT * FROM market_entries WHERE id=?').get(id);
    if (!r) throw new AppError('NOT_FOUND', '榜单记录不存在', 404);
    const reviews = store.db.prepare('SELECT * FROM market_reviews WHERE entry_id=? ORDER BY rowid DESC').all(id).map(v => ({ id: String(v.id), entryId: id, relatedEntryId: v.related_entry_id ? String(v.related_entry_id) : null, verdict: v.verdict as Review['verdict'], reason: String(v.reason), evidence: String(v.evidence), reviewer: String(v.reviewer), createdAt: String(v.created_at) }));
    return { id, batchId: String(r.batch_id), rowNumber: Number(r.row_number), raw: JSON.parse(String(r.raw_data)), data: hydrateMarketRow(JSON.parse(String(r.normalized_data))), sourceProductId: r.source_product_id === null ? null : String(r.source_product_id), sourceMetadata: sourceMetadataSchema.parse(JSON.parse(String(r.source_metadata))), reviews };
  }
  function selected(batchId: string, query: unknown) {
    const batch = batches().find(b => b.id === batchId);
    if (!batch) throw new AppError('NOT_FOUND', '导入批次不存在', 404);
    const filter = z.object({ q: z.string().max(160).default(''), verdict: z.enum(['all', 'unreviewed', 'old', 'candidate', 'different', 'unknown']).default('all'), signal: z.enum(['all', 'confirmed', 'firstSeen', 'suspectedRelist', 'old', 'pending']).default('all') }).parse(query);
    const priorBatches = batches().filter(other => other.id !== batchId && other.periodEnd <= batch.periodEnd);
    const priorEntries = priorBatches.flatMap(other => store.db.prepare('SELECT id FROM market_entries WHERE batch_id=? ORDER BY row_number').all(other.id).map(row => ({ batch: other, entry: entry(String(row.id)) })));
    const sourceEntries = store.db.prepare('SELECT id FROM market_entries WHERE batch_id=? ORDER BY row_number').all(batchId).map(r => entry(String(r.id)));
    const analyzed = sourceEntries.map(item => {
      const matches: MarketMatch[] = priorEntries.flatMap(previous => { const reason = candidateReason(item.data, previous.entry.data); return reason ? [{ entryId: previous.entry.id, batchId: previous.batch.id, title: previous.entry.data.title, shop: previous.entry.data.shop, reason }] : []; });
      return { ...item, analysis: analyzeMarketEntry(item, matches) };
    });
    const summary = analyzed.reduce<MarketSummary>((total, item) => ({ ...total, [item.analysis.signal]: total[item.analysis.signal] + 1 }), { confirmed: 0, firstSeen: 0, suspectedRelist: 0, old: 0, pending: 0 });
    const entries = analyzed.filter(e => `${e.data.title} ${e.data.brand} ${e.data.shop}`.includes(filter.q) && (filter.verdict === 'all' || (e.reviews[0]?.verdict ?? 'unreviewed') === filter.verdict) && (filter.signal === 'all' || e.analysis.signal === filter.signal)).sort((a, b) => b.data.value - a.data.value || a.rowNumber - b.rowNumber);
    return { batch, entries, summary };
  }
  const input = z.object({ batch: batchSchema, csv: z.string().max(350_000) }).strict();
  function parse(body: unknown) { const value = input.parse(body); try { return { ...value, rows: parseMarketCsv(value.csv) }; } catch (error) { throw new AppError('INVALID_CSV', (error as Error).message); } }
  app.get('/api/market/template', async (_request, reply) => reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="market-template.csv"').send(csvText([[...columns]])));
  app.get('/api/market/batches', async () => batches());
  app.post('/api/market/preview', async request => { const { rows } = parse(request.body); return { count: rows.length, rows }; });
  app.post('/api/market/batches', async (request, reply) => {
    const { batch, rows } = parse(request.body), id = randomUUID(), time = new Date().toISOString();
    store.transaction(() => {
      store.db.prepare('INSERT INTO market_batches VALUES (?,?,?,?,?,?,?,?,?)').run(id, batch.name, batch.source, batch.platform, batch.periodStart, batch.periodEnd, batch.metricName, batch.metricUnit, time);
      const insert = store.db.prepare('INSERT INTO market_entries (id,batch_id,row_number,raw_data,normalized_data,created_at,source_product_id,source_metadata) VALUES (?,?,?,?,?,?,NULL,?)');
      rows.forEach((row, i) => insert.run(randomUUID(), id, i + 2, JSON.stringify(row.raw), JSON.stringify(row.data), time, '{}'));
    });
    return reply.code(201).send(batches().find(b => b.id === id));
  });
  app.get('/api/market/batches/:id/entries', async request => selected(idOf(request.params), request.query));
  app.get('/api/market/entries/:id/candidates', async request => {
    const current = entry(idOf(request.params));
    const batchList = batches();
    return store.db.prepare('SELECT id FROM market_entries WHERE id<>? ORDER BY created_at, row_number').all(current.id).flatMap(r => {
      const other = entry(String(r.id)), reason = candidateReason(current.data, other.data);
      return reason ? [{ entry: other, reason, batch: batchList.find(b => b.id === other.batchId)! }] : [];
    });
  });
  app.post('/api/market/entries/:id/reviews', async (request, reply) => {
    const id = idOf(request.params), body = reviewSchema.parse(request.body); entry(id);
    if (body.relatedEntryId) { entry(body.relatedEntryId); if (body.relatedEntryId === id) throw new AppError('INVALID_RELATION', '不能关联自身'); }
    store.db.prepare('INSERT INTO market_reviews VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, body.relatedEntryId, body.verdict, body.reason, body.evidence, body.reviewer, new Date().toISOString());
    return reply.code(201).send(entry(id));
  });
  app.get('/api/market/batches/:id/export', async (request, reply) => {
    const { batch, entries } = selected(idOf(request.params), request.query);
    const signalLabels = { confirmed: '已确认新品候选', firstSeen: '本库首次出现', suspectedRelist: '疑似老品换链接/店铺', old: '已有老品证据', pending: '需要人工核对' } as const;
    const cells = (e: Entry) => [e.data.title,e.data.url,e.data.brand,e.data.specification,e.data.shop,e.data.barcode,e.data.value,e.data.timeEvidence,e.data.category,e.data.price ?? '',e.data.sellingPoints,e.data.ingredients,e.data.packaging,e.data.marketingMode,e.data.externalDependence];
    const rows = entries.map(e => { const review = e.reviews[0]; return [e.id, ...cells(e), batch.name, batch.source, batch.platform, batch.periodStart, batch.periodEnd, batch.metricName, batch.metricUnit, signalLabels[e.analysis.signal], e.analysis.matches.length, `${e.analysis.completeness}%`, e.analysis.missing.join('、'), review ? verdicts[review.verdict] : '未核对', review?.reason, review?.evidence, review?.reviewer, review?.createdAt, review?.relatedEntryId]; });
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="market-opportunities.csv"').send(csvText([['记录编号', ...columns, '批次', '来源', '平台', '统计开始', '统计结束', '指标', '单位', '系统新品判断', '历史命中数', '资料完整度', '缺失字段', '人工核对结论', '理由', '依据', '确认人', '核对时间', '关联记录编号'], ...rows]));
  });
}
