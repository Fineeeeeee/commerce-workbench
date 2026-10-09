import { Select } from './components/Select.js';
import { InlineError } from './components/states.js';
import { useEffect, useRef, useState } from 'react';
import type { Kit, Product } from '../../../packages/contracts/domain.js';
import { api, json } from './api.js';

type ProjectLink = { skuId: string; project: { id: string; name: string; projectType: string | null } | null };
type Direction = { id: string; skuId: string; title: string; objective: string; factRefs: string[]; marketRefs: string[]; aiSuggestion: { rationale?: string } | null; selectedAt: string | null };
type Batch = { id: string; plannedPageIds: string[]; metrics: { planned: number; generated: number; copyGenerated: number; visualGenerated: number; ruleEvaluated: number; firstRulePassed: number; firstRulePassRate: number|null; firstHumanReviewed: number; firstHumanApproved: number; firstHumanPassRate: number|null; humanRejected: number; humanDecisionCount: number; returnRate: number|null; retries: number; attemptedPageCount: number; averageRetries: number|null } };
type Category = { id: string; name: string; parentId: string | null };

export function ContentProductionPanel({ product, kit, onBatch }: { product: Product; kit: Kit | null; onBatch: (id: string | null) => void }) {
  const [link, setLink] = useState<ProjectLink | null>(null);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const batchKey = useRef<string | null>(null);
  const context = `${product.id}:${kit?.id ?? ''}`;
  const currentContext = useRef(context); currentContext.current = context;
  const loadSequence = useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    const next = await api<ProjectLink>(`/products/${product.id}/existing-project`);
    const nextDirections = next.project ? await api<Direction[]>(`/product-projects/${next.project.id}/content-directions`) : [];
    const ids = kit ? await api<string[]>(`/products/${product.id}/content-production-batches?kitId=${kit.id}`) : [];
    const latest = ids.length ? await api<Batch>(`/content-production-batches/${ids[0]}`) : null;
    if (currentContext.current !== context || loadSequence.current !== sequence) return;
    setLink(next); setDirections(nextDirections.filter(item => item.skuId === product.id));
    setBatch(latest); onBatch(latest?.id ?? null);
  }
  useEffect(() => { let active=true; onBatch(null); setBatch(null); setDirections([]); setLink(null); setError(''); setLoading(true); setBusy(false); batchKey.current = null; load().catch(error => {if(active)setError(error.message);}).finally(() => {if(active)setLoading(false);}); api<Category[]>('/categories').then(value=>{if(active)setCategories(value);}).catch(error=>{if(active)setError(error.message);}); return()=>{active=false;loadSequence.current++;}; }, [context]);
  useEffect(() => { if (!batch) return; let active=true,inFlight=false; const timer = setInterval(async () => { if (document.hidden || inFlight) return; inFlight=true; try { const next=await api<Batch>(`/content-production-batches/${batch.id}`); if(active&&currentContext.current===context)setBatch(next); }catch{if(active)setError('生产指标暂未同步，当前显示上次结果；系统会继续同步。');}finally{inFlight=false;} }, 5000); return () => {active=false;clearInterval(timer);}; }, [batch?.id,context]);
  async function run(action: () => Promise<unknown>) { if(busy)return;setBusy(true); setError(''); try { await action(); if(currentContext.current===context)await load(); } catch (error) { if(currentContext.current===context)setError((error as Error).message); } finally { if(currentContext.current===context)setBusy(false); } }
  const selected = directions.find(item => item.selectedAt);
  return <div className="content-production-inline">
    <div className="content-production-title"><strong>内容生产</strong><span>{link?.project ? `${link.project.name} · ${selected?.title ?? '待选择内容方向'}` : '先明确商品所属项目'}</span></div>
    {!loading && !link?.project && <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(() => api(`/products/${product.id}/existing-project`, json({ projectName: data.get('projectName'), categoryId: data.get('categoryId'), confirmExistingProduct: true }))); }}>
      <input name="projectName" required maxLength={120} defaultValue={`${product.name} 内容运营`} aria-label="已有商品项目名称"/>
      <Select name="categoryId" required aria-label="真实商品类目"><option value="">请选择真实类目</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
      <button disabled={busy}>将已有商品纳入项目</button>
    </form>}
    {link?.project?.projectType === null && <button disabled={busy} onClick={() => void run(() => api(`/products/${product.id}/existing-project/confirm`, json({ confirmExistingProduct: true })))}>确认这是已有商品运营项目</button>}
    {link?.project?.projectType === 'NEW_PRODUCT' && <p>当前商品属于新品项目，沿用项目原有内容制作路径。</p>}
    {link?.project?.projectType === 'EXISTING_PRODUCT' && <>
      <details className="content-direction-details"><summary>内容方向 · {selected?.title ?? '待选择'}{directions.length ? ` · ${directions.length} 个候选` : ''}</summary>
        <div className="content-production-actions"><button disabled={busy} onClick={() => void run(() => api(`/product-projects/${link.project!.id}/content-directions/suggest`, json({ skuId: product.id })))}>AI 提议内容方向</button><span>建议只使用已确认商品事实与项目采用的市场依据</span></div>
        {!!directions.length && <div className="content-direction-list">{directions.map(item => <div key={item.id}><strong>{item.title}</strong><span>内容方向：{item.objective}</span><small>客观依据：{item.factRefs.length} 项已确认商品事实 · {item.marketRefs.length} 条项目已采用市场依据</small><small>{item.aiSuggestion ? `AI 建议：${item.aiSuggestion.rationale ?? '待人工选择'}` : '人工提出的方向'}</small><button disabled={busy || !!item.selectedAt} onClick={() => void run(() => api(`/content-directions/${item.id}/select`, json({})))}>{item.selectedAt ? '已选择' : '选用此方向'}</button></div>)}</div>}
      </details>
      {!kit && <p>选择内容方向后，先建立该 SKU 的内容方案。</p>}
      {kit && selected && !batch && !loading && <button disabled={busy} onClick={() => void run(() => { batchKey.current ??= crypto.randomUUID(); return api('/content-production-batches', { ...json({ directionId: selected.id, kitId: kit.id, pageIds: kit.pages.map(page => page.id) }), headers: { 'Idempotency-Key': batchKey.current } }); })}>按当前内容方案建立生产批次</button>}
      {batch && <details className="content-metrics-details"><summary>本批次 · 计划 {batch.metrics.planned} 页 · 已生成 {batch.metrics.generated} 页 · 人工已处理 {batch.metrics.firstHumanReviewed} 页</summary><div className="content-production-metrics"><span>文案候选 {batch.metrics.copyGenerated} 页</span><span>视觉候选 {batch.metrics.visualGenerated} 页</span><span>首轮规则通过 {batch.metrics.firstRulePassed}/{batch.metrics.ruleEvaluated} 页 · {batch.metrics.firstRulePassRate === null ? '—' : `${Math.round(batch.metrics.firstRulePassRate*100)}%`}</span><span>首次人工通过 {batch.metrics.firstHumanApproved}/{batch.metrics.firstHumanReviewed} 页 · {batch.metrics.firstHumanPassRate === null ? '—' : `${Math.round(batch.metrics.firstHumanPassRate*100)}%`}</span><span>人工退回 {batch.metrics.humanRejected}/{batch.metrics.humanDecisionCount} 次审核 · {batch.metrics.returnRate === null ? '—' : `${Math.round(batch.metrics.returnRate*100)}%`}</span><span>基于 {batch.metrics.attemptedPageCount} 页实际提交，平均重新提交 {batch.metrics.averageRetries === null ? '—' : batch.metrics.averageRetries.toFixed(2)} 次/页</span></div><small>仅反映本批实际处理记录，不代表稳定的内容质量通过率。</small></details>}
    </>}
    {error && <InlineError onRetry={()=>{setError('');void load().catch(e=>setError(e.message));}}>{error}</InlineError>}
  </div>;
}
