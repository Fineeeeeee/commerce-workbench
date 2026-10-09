import { Select } from './components/Select.js';
import { MarketLearningPanel } from "./market-learning-panel.js";
import { reviewReasonLabels } from "../../../packages/contracts/market-learning.js";
import { useRoutedState } from './workspace-route.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, json } from './api.js';
import { verdicts, marketSignals, type Batch, type BatchInput, type Entry, type Review, type MarketRow, type MarketAnalysis } from '../../../packages/contracts/market.js';
import type { OpportunityPreview, ProductOpportunity } from '../../../packages/contracts/market-opportunity.js';
import type { Category, ProductProject } from '../../../packages/contracts/business.js';
import './market.css';
import './market-opportunity.css';
import { MarketInsights } from './market-insights.js';
import { Modal } from './components/Modal.js';
import { InlineError } from './components/states.js';
import { StatusBadge } from './components/StatusBadge.js';
import { MarketResearchPanel } from './market-research-panel.js';
import { MarketMonitoringPanel } from './market-monitoring-panel.js';
import type { MarketResearchJob } from '../../../packages/contracts/market-research.js';
import { opportunityDisplayTitle, batchDisplayName } from './display-text.js';
import { currentMarketOpportunityPromptVersion } from '../../../packages/contracts/market-ai.js';

type Candidate = { entry: Entry; reason: string; batch: Batch };
type AnalyzedEntry = Entry & { analysis: MarketAnalysis };
const initial: BatchInput = { name: '', source: '', platform: '', periodStart: '', periodEnd: '', metricName: '', metricUnit: '' };
export function Market({ onEvidenceChange, initialBatchId, initialOpportunityId, initialResearchProjectId, onBatchSelected, onProject }: { onEvidenceChange?: () => void; initialBatchId?: string | null; initialOpportunityId?: string | null; initialResearchProjectId?: string | null; onBatchSelected?: (id: string) => void; onProject: (id: string) => void }) {
  const openedOpportunity = useRef<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]), [batchId, setBatchId] = useState('');
  const [entries, setEntries] = useState<AnalyzedEntry[]>([]);
  const [importing, setImporting] = useRoutedState<boolean>('importForm',false), [form, setForm] = useState(initial), [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ count: number; rows: { data: MarketRow }[] } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [entryId,setEntryId]=useRoutedState<string|null>('sourceEntry',null);
  const selected=entries.find(item=>item.id===entryId)??null;
  const setSelected=(entry:AnalyzedEntry|null)=>setEntryId(entry?.id??null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]), [opportunityPreview, setOpportunityPreview] = useState<OpportunityPreview | null>(null);
  const [overview, setOverview] = useState<OpportunityPreview | null>(null), [reviewingId,setReviewingId]=useRoutedState<string|null>('opportunityReview',null);
  const [opportunities, setOpportunities] = useState<ProductOpportunity[]>([]), [projects, setProjects] = useState<ProductProject[]>([]), [categories, setCategories] = useState<Category[]>([]), [projectChoice, setProjectChoice] = useState<Record<string,string>>({});
  const [projectResearchJobs, setProjectResearchJobs] = useState<MarketResearchJob[]>([]);
  const [allResearchJobs,setAllResearchJobs]=useState<MarketResearchJob[]>([]);
  const [monitoringBatchId,setMonitoringBatchId]=useState<string|null>(null);
  const reviewing=opportunities.find(item=>item.id===reviewingId)??null;
  const setReviewing=(item:ProductOpportunity|null)=>setReviewingId(item?.id??null);
  const [creatingProjectId,setCreatingProjectId]=useRoutedState<string|null>('opportunityProject',null);
  const creatingProject=opportunities.find(item=>item.id===creatingProjectId)??null;
  const setCreatingProject=(item:ProductOpportunity|null)=>setCreatingProjectId(item?.id??null);
  const [creationKey,setCreationKey]=useState<string>(()=>crypto.randomUUID());
  useEffect(()=>{if(!creatingProjectId)return;const name=`project-creation:${creatingProjectId}`,key=sessionStorage.getItem(name)??crypto.randomUUID();sessionStorage.setItem(name,key);setCreationKey(key);},[creatingProjectId]);
  const loadedBatch=useRef<string|null>(null);
  const [review, setReview] = useState<{ relatedEntryId: string | null; verdict: Review['verdict']; reason: string; evidence: string; reviewer: string }>({ relatedEntryId: null, verdict: 'unknown', reason: '', evidence: '', reviewer: '' });
  const batch = batches.find(b => b.id === batchId);
  const selectedResearchJob=allResearchJobs.find(job=>job.marketBatchId===batchId);
  const selectedCategory=categories.find(item=>item.code===(selectedResearchJob?.collectionProfile==='facial_cleanser'?'facial-cleanser':'shampoo'));
  const [readRevision,setReadRevision]=useState(0);
  async function refresh() { const list = await api<Batch[]>('/market/batches'); setBatches(list); setBatchId(id => id || (initialBatchId && list.some(item => item.id === initialBatchId) ? initialBatchId : list[0]?.id || '')); }
  async function refreshOpportunities() { const [items, projectItems, categoryItems,jobs] = await Promise.all([api<ProductOpportunity[]>('/product-opportunities'), api<ProductProject[]>('/product-projects'), api<Category[]>('/categories'),api<MarketResearchJob[]>('/market-research-jobs')]); setOpportunities(items); setProjects(projectItems); setCategories(categoryItems);setAllResearchJobs(jobs); }
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  useEffect(() => { refresh().catch(e => setError(e.message)); refreshOpportunities().catch(e => setError(e.message)); }, [readRevision]);
  useEffect(() => { if (initialBatchId && batches.some(item => item.id === initialBatchId)) setBatchId(initialBatchId); }, [initialBatchId, batches]);
  useEffect(() => {
    const item = opportunities.find(value => value.id === initialOpportunityId);
    if (!item || openedOpportunity.current === item.id || batchId !== item.analysis.batch.id) return;
    document.getElementById(`opportunity-${item.id}`)?.scrollIntoView({ block: 'center' });
    if (item.status === 'DRAFT' && item.analysis.modelMetadata?.promptVersion === currentMarketOpportunityPromptVersion) setReviewing(item);
    openedOpportunity.current = item.id;
  }, [initialOpportunityId, opportunities, batchId]);
  useEffect(() => { if (batchId) onBatchSelected?.(batchId); }, [batchId]);
  useEffect(() => { if (!initialResearchProjectId) { setProjectResearchJobs([]); return; } api<MarketResearchJob[]>(`/product-projects/${initialResearchProjectId}/market-research-jobs`).then(setProjectResearchJobs).catch(e => setError(e.message)); }, [initialResearchProjectId]);
  useEffect(() => { let active = true;if(loadedBatch.current&&loadedBatch.current!==batchId)setSelected(null);if(batchId)loadedBatch.current=batchId;setSelectedEntryIds([]); setOverview(null); if (!batchId) return; Promise.all([api<{ entries: AnalyzedEntry[] }>(`/market/batches/${batchId}/entries`), api<OpportunityPreview>(`/market/batches/${batchId}/opportunity-overview`)]).then(([r, overviewValue]) => { if (active) { setEntries(r.entries); setOverview(overviewValue); } }).catch(e => { if (active) { setEntries([]); setError(e.message); } }); return () => { active = false; }; }, [batchId,readRevision]);
  useEffect(()=>{if(!entryId)return;let active=true;setCandidates([]);api<Candidate[]>(`/market/entries/${entryId}/candidates`).then(items=>{if(active)setCandidates(items);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[entryId]);
  async function open(entry: AnalyzedEntry) { const list = await api<Candidate[]>(`/market/entries/${entry.id}/candidates`); setCandidates(list); setSelected(entry); setReview({ relatedEntryId: null, verdict: 'unknown', reason: '', evidence: '', reviewer: '' }); }
  async function saveReview() {
    if (!selected) return;
    await api<Entry>(`/market/entries/${selected.id}/reviews`, json(review));
    const result = await api<{ entries: AnalyzedEntry[] }>(`/market/batches/${batchId}/entries`); setEntries(result.entries); setSelected(null);
  }
  async function analyzeSelected() { await api('/market/ai-analysis', json({ batchId, entryIds: selectedEntryIds, categoryId: selectedCategory?.id ?? null })); setSelectedEntryIds([]); await refreshOpportunities(); onEvidenceChange?.(); }
  async function saveOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!opportunityPreview) return;
    const data = new FormData(event.currentTarget), selectedTerms = new Set(data.getAll('keyword').map(String));
    const keywords = opportunityPreview.keywords.filter(item => selectedTerms.has(item.term)).map(({ term, sourceEntryIds }) => ({ term, sourceEntryIds }));
    const manualKeyword = String(data.get('manualKeyword') || '').trim(); if (manualKeyword && !keywords.some(item => item.term === manualKeyword)) keywords.push({ term: manualKeyword, sourceEntryIds: opportunityPreview.included.map(item => item.id) });
    if (!keywords.length) throw new Error('至少保留一个带来源的关键词');
    await api('/product-opportunities', json({ batchId: opportunityPreview.batch.id, entryIds: [...opportunityPreview.included, ...opportunityPreview.excluded].map(item => item.id), categoryId: String(data.get('categoryId') || '') || null, title: data.get('title'), summary: data.get('summary'), status: data.get('status'), keywords, replicability: data.get('replicability'), replicabilityReason: data.get('replicabilityReason'), risks: String(data.get('risks') || '').split(/\n/).map(value => value.trim()).filter(Boolean), missingEvidence: opportunityPreview.missingEvidence }));
    setOpportunityPreview(null); setSelectedEntryIds([]); await refreshOpportunities(); onEvidenceChange?.();
  }
  async function attachOpportunity(opportunityId: string, targetProjectId?: string) {
    const projectId = targetProjectId ?? projectChoice[opportunityId]; if (!projectId) throw new Error('请选择产品项目');
    await api(`/product-projects/${projectId}/opportunities`, json({ opportunityId, note: '由市场机会分析加入项目' })); await refreshOpportunities(); onEvidenceChange?.();
  }
  async function createOpportunityProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!creatingProject) return;
    const data = new FormData(event.currentTarget);
    const result = await api<{ projectId: string }>(`/product-opportunities/${creatingProject.id}/projects`, {
      ...json({ name: String(data.get('name')).trim(), scope: String(data.get('scope')).trim(), projectType: data.get('projectType'), ...(creatingProject.categoryId ? {} : { categoryId: String(data.get('categoryId')) }) }),
      headers: { 'Idempotency-Key': creationKey },
    });
    await refreshOpportunities(); onEvidenceChange?.();if(creatingProjectId)sessionStorage.removeItem(`project-creation:${creatingProjectId}`);setCreatingProject(null); onProject(result.projectId);
  }
  async function reviewOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!reviewing) return; const data = new FormData(event.currentTarget);
    await api(`/product-opportunities/${reviewing.id}/review`, json({ decision: data.get('decision'), reviewer: data.get('reviewer'), note: data.get('note'), reasonCodes:data.get('decision')==='REJECTED'?data.getAll('reasonCode'):[] }));
    setReviewing(null); await refreshOpportunities(); onEvidenceChange?.();
  }
  const opportunityResearch=allResearchJobs.find(job=>job.marketBatchId===opportunityPreview?.batch.id);
  const suggestedCategory=categories.find(item=>item.code===(opportunityResearch?.collectionProfile==='facial_cleanser'?'facial-cleanser':opportunityResearch?.collectionProfile==='shampoo'?'shampoo':''));
  const [workspaceTab,setWorkspaceTab]=useRoutedState<'research'|'opportunities'|'monitoring'|'learning'|'briefs'>('marketTab',initialOpportunityId?'opportunities':'research',['research','opportunities','monitoring','learning','briefs']);
  const planningWorkspace=['opportunities','learning','briefs'].includes(workspaceTab);
  const [,setLearningOpportunity]=useRoutedState<string|null>('opportunityDrawer',null);
  const [,setLearningOpportunityTab]=useRoutedState<string>('opportunityTab','overview');
  return <section className="standard-page market-page">
    <div className="workspace-reference-tabs" role="tablist" aria-label="市场工作区">{(planningWorkspace?([['opportunities','市场机会'],['briefs','产品企划'],['learning','AI 评估']] as const):([['research','研究任务'],['monitoring','市场监控']] as const)).map(([key,label])=><button key={key} role="tab" aria-selected={workspaceTab===key} className={workspaceTab===key?'active':''} onClick={()=>setWorkspaceTab(key)}>{label}</button>)}</div>
    <div hidden={workspaceTab!=='research'}>
    <MarketResearchPanel selectedBatchId={batchId||initialBatchId||undefined} onBatchReady={id=>{setBatchId(id);void refreshOpportunities();}} onChanged={()=>{void refresh();void refreshOpportunities();onEvidenceChange?.();}} onProject={onProject}/>
    {batch && projectResearchJobs.some(job => job.marketBatchId === batch.id) && <div className="notice">由产品项目“{projects.find(project => project.id === initialResearchProjectId)?.name ?? '当前项目'}”发起。研究结果不会自动纳入项目。</div>}
    </div><div hidden={workspaceTab==='monitoring'||workspaceTab==='learning'||workspaceTab==='briefs'} className={`market-tab-content market-tab-${workspaceTab}`}>
    <MarketInsights focusedOpportunityId={initialOpportunityId??undefined} onResearch={()=>setWorkspaceTab('research')} onOpportunities={()=>setWorkspaceTab('opportunities')} batch={batch} overview={overview} entries={entries} opportunities={opportunities} projects={projects} categories={categories} monitoringActive={batchId===monitoringBatchId} originProject={batch ? projects.find(project => project.id === initialResearchProjectId && projectResearchJobs.some(job => job.marketBatchId === batch.id)) : undefined} projectChoice={projectChoice} setProjectChoice={setProjectChoice} selectedEntryIds={selectedEntryIds} setSelectedEntryIds={setSelectedEntryIds} busy={busy} onAnalyze={() => run(analyzeSelected)} onAttach={id => run(() => attachOpportunity(id))} onInclude={id => initialResearchProjectId && run(() => attachOpportunity(id, initialResearchProjectId))} onCreate={item => { setCreationKey(crypto.randomUUID()); setCreatingProject(item); }} onProject={onProject} onOpen={entry => run(() => open(entry))} onReview={setReviewing}/>
    </div><div hidden={workspaceTab!=='learning'}>{workspaceTab==='learning'&&<MarketLearningPanel categories={categories} batchId={batchId} onOpportunity={(id,opportunityId)=>{setBatchId(id);setWorkspaceTab('opportunities');setLearningOpportunity(opportunityId);setLearningOpportunityTab('overview');}}/>}</div><div hidden={workspaceTab!=='monitoring'}><MarketMonitoringPanel onBatch={id=>{setBatchId(id);void refresh();}} onCurrentBatchId={setMonitoringBatchId}/></div>
    <div hidden={workspaceTab!=='research'} className="market-import-entry"><span>已有外部商品样本？</span><button className="text-button" onClick={() => setImporting(true)}>导入电商榜单 →</button></div>
    {error && <InlineError onRetry={()=>{setError('');setReadRevision(value=>value+1);}} onClose={() => setError('')}>{error}</InlineError>}
    {workspaceTab==='briefs'&&<section className="card planning-project-list"><h2>产品企划</h2>{projects.filter(project=>project.projectType==='NEW_PRODUCT').map(project=><article className="compact-row" key={project.id}><div><strong>{project.name}</strong><small>{project.brief.objective}</small></div><a className="text-button" href={`#/projects?project=${project.id}&ui.projectStage=project-brief`}>进入项目企划 →</a></article>)}{!projects.some(project=>project.projectType==='NEW_PRODUCT')&&<p className="muted">暂无新品项目</p>}</section>}
    {opportunities.some(item=>item.analysis.batch.id!==batchId) && <details hidden={workspaceTab!=='opportunities'} className="market-opportunities other-opportunities"><summary>其他批次机会 · {opportunities.filter(item=>item.analysis.batch.id!==batchId).length} 项</summary><div className="other-opportunity-list">{opportunities.filter(item=>item.analysis.batch.id!==batchId).map(item => <article className="compact-row" key={item.id}><StatusBadge domain="opportunity" status={item.status}/><div><strong>{opportunityDisplayTitle(item.title)}</strong><small>{batchDisplayName(item.analysis.batch.name)} · {item.analysis.batch.platform}</small></div><button onClick={() => setBatchId(item.analysis.batch.id)}>查看机会与依据</button></article>)}</div></details>}
    {!batches.length && <div className="empty card"><h2>从一份真实榜单开始</h2><p>提供商品记录、榜单来源、统计区间与指标。首次出现只代表新线索，不代表首次上市。</p><a className="button" href="/api/market/template" download>下载 CSV 字段模板</a></div>}
    {importing && <Modal className="market-modal" title="导入商品榜单" onClose={() => setImporting(false)}><form onSubmit={e => { e.preventDefault(); run(async () => setPreview(await api('/market/preview', json({ batch: form, csv })))); }}><fieldset disabled={busy}><div className="form-grid">{([['name', '批次名称'], ['source', '榜单来源'], ['platform', '平台'], ['periodStart', '统计开始日期'], ['periodEnd', '统计结束日期'], ['metricName', '指标名称'], ['metricUnit', '指标单位']] as const).map(([key, label]) => <label key={key}>{label}<input required maxLength={160} type={key.startsWith('period') ? 'date' : 'text'} value={form[key]} onChange={e => { setPreview(null); setForm(f => ({ ...f, [key]: e.target.value })); }}/></label>)}</div><p>UTF-8 CSV，每批 1–500 条；使用模板列名与顺序，不混合不同指标口径。</p><a href="/api/market/template" download>下载字段模板</a><label>选择 CSV 文件<input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; setPreview(null); setCsv(''); if (file) run(async () => { if (file.size > 350000) throw new Error('文件过大，请分批导入'); setCsv(await file.text()); }); }}/></label><button type="submit" disabled={!csv}>校验并预览</button>{preview && <div className="card"><h3>校验通过，共 {preview.count} 条</h3><p>前 5 条预览；提交后保留全部原始记录。</p>{preview.rows.slice(0, 5).map((r, i) => <p key={i}>{r.data.title} · {r.data.value} {form.metricUnit}</p>)}<button type="button" className="primary" onClick={() => run(async () => { const added = await api<Batch>('/market/batches', json({ batch: form, csv })); await refresh(); setBatchId(added.id); setImporting(false); setPreview(null); setCsv(''); setForm(initial); })}>确认导入 {preview.count} 条</button></div>}</fieldset></form></Modal>}
    {selected && <Modal className="market-modal" title={selected.data.title} onClose={() => setSelected(null)}><p>{selected.data.brand} · {selected.data.specification} · {selected.data.shop}</p>{selected.data.url && <a href={selected.data.url} target="_blank" rel="noreferrer">查看商品来源</a>}<p>提供的时间证据：{selected.data.timeEvidence || '未提供'}</p><details><summary>查看导入原始行（第 {selected.rowNumber} 行）</summary><pre>{JSON.stringify(selected.raw, null, 2)}</pre></details><h3>历史同款线索 · {selected.analysis.matches.length}</h3><p className="muted">系统只负责找出跨链接、跨店铺的疑似同款。首次出现仍需要结合发布时间、评价时间和历史销售证据确认。</p>{selected.analysis.matches.map(match => <article className="market-candidate" key={match.entryId}><strong>{match.title}</strong><p>{match.shop || '店铺未提供'} · {match.reason}</p></article>)}<form onSubmit={e => { e.preventDefault(); run(saveReview); }}><fieldset disabled={busy}><label>关联记录<Select value={review.relatedEntryId ?? ''} onChange={e => setReview(r => ({ ...r, relatedEntryId: e.target.value || null }))}><option value="">不关联记录</option>{candidates.map(c => <option key={c.entry.id} value={c.entry.id}>{c.batch.name} · {c.entry.data.title} · {c.entry.data.shop}</option>)}</Select></label><label>核对结论<Select value={review.verdict} onChange={e => setReview(r => ({ ...r, verdict: e.target.value as Review['verdict'] }))}>{Object.entries(verdicts).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Select></label><label>判断理由<textarea required maxLength={1000} value={review.reason} onChange={e => setReview(r => ({ ...r, reason: e.target.value }))}/></label><label>依据与待核实事项<textarea required maxLength={2000} value={review.evidence} onChange={e => setReview(r => ({ ...r, evidence: e.target.value }))} placeholder="写明资料来源、时间及支持该结论的内容；证据不足时写明缺项"/></label><label>确认人<input required maxLength={160} value={review.reviewer} onChange={e => setReview(r => ({ ...r, reviewer: e.target.value }))}/></label><button className="primary">保存核对记录</button></fieldset></form><h3>核对历史</h3>{selected.reviews.length ? selected.reviews.map(r => <article className="market-candidate" key={r.id}><strong>{verdicts[r.verdict]}</strong><p>{r.reason}</p><p>{r.evidence}</p><small>{r.reviewer} · {new Date(r.createdAt).toLocaleString('zh-CN')}</small></article>) : <p>尚无核对记录。</p>}</Modal>}
    {opportunityPreview && <Modal className="market-modal opportunity-modal" title="形成市场机会" eyebrow="PRODUCT OPPORTUNITY" onClose={() => setOpportunityPreview(null)}><div className="opportunity-summary"><div><strong>{opportunityPreview.included.length}</strong><span>纳入分析</span></div><div><strong>{opportunityPreview.excluded.length}</strong><span>排除 / 待核对</span></div><div><strong>{opportunityPreview.keywords.length}</strong><span>候选关键词</span></div></div>{opportunityPreview.excluded.length > 0 && <details><summary>查看被排除的记录</summary>{opportunityPreview.excluded.map(item => <p key={item.id}>{item.data.title}：{item.exclusionReason}</p>)}</details>}<form onSubmit={e => run(() => saveOpportunity(e))}><fieldset disabled={busy}><label>机会名称<input name="title" required maxLength={160} defaultValue={`${opportunityPreview.keywords.slice(0, 3).map(item => item.term).join(' · ')} 市场机会`}/></label><label>分析摘要<textarea name="summary" required maxLength={2000} rows={4} placeholder="说明榜单表现、目标需求、已排除的不可复刻因素和仍需核实的风险"/></label><label>产品类目<Select name="categoryId" defaultValue={suggestedCategory?.id ?? ''}><option value="">暂不指定</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label><label>机会状态<Select name="status" defaultValue="READY"><option value="READY">可加入项目</option><option value="DRAFT">分析草稿</option><option value="REJECTED">否决</option></Select></label><label>复刻可行性<Select name="replicability" defaultValue="UNKNOWN"><option value="HIGH">高</option><option value="MEDIUM">中</option><option value="LOW">低</option><option value="UNKNOWN">待判断</option></Select></label><label>判断依据<textarea name="replicabilityReason" maxLength={2000} rows={3} placeholder="从配方、包材、营销依赖等已导入信息判断；资料不足就写明待核实"/></label><fieldset className="keyword-picker"><legend>关键词及来源商品</legend>{opportunityPreview.keywords.slice(0, 16).map((keyword, index) => <label key={keyword.term}><input type="checkbox" name="keyword" value={keyword.term} defaultChecked={index < 8}/><span>{keyword.term}</span><small>{keyword.coverage} 条商品支持</small></label>)}</fieldset><label>补充关键词<input name="manualKeyword" maxLength={30} placeholder="可选；将引用本次全部纳入记录"/></label><label>风险（每行一项）<textarea name="risks" maxLength={4000} rows={3}/></label>{opportunityPreview.missingEvidence.length > 0 && <div className="notice warning">仍缺少：{opportunityPreview.missingEvidence.join('、')}。</div>}<button className="primary">保存市场机会</button></fieldset></form></Modal>}
    {reviewing && <Modal className="market-modal" title={opportunityDisplayTitle(reviewing.title)} eyebrow="人工审核" onClose={() => setReviewing(null)}><p>{reviewing.summary}</p><form onSubmit={event=>run(()=>reviewOpportunity(event))}><fieldset disabled={busy}><label>审核结论<Select name="decision" defaultValue="APPROVED"><option value="APPROVED">通过并成为正式机会</option><option value="REJECTED">否决候选</option></Select></label><fieldset><legend>驳回原因（通过时无需填写）</legend>{Object.entries(reviewReasonLabels).map(([key,label])=><label key={key}><input type="checkbox" name="reasonCode" value={key}/>{label}</label>)}</fieldset><label>审核人<input name="reviewer" required maxLength={100}/></label><label>审核说明<textarea name="note" required minLength={1} maxLength={1000} rows={4} placeholder="说明证据是否充分，以及仍需核实的事项"/></label><button className="primary">保存审核结论</button></fieldset></form></Modal>}
    {creatingProject && <Modal className="market-modal opportunity-modal" title="从市场机会创建产品项目" onClose={() => setCreatingProject(null)}><p><strong>{opportunityDisplayTitle(creatingProject.title)}</strong> · {batchDisplayName(creatingProject.analysis.batch.name)}</p><p className="muted">机会依据会随项目保留；请确认项目目标。</p><form onSubmit={event => run(() => createOpportunityProject(event))}><fieldset disabled={busy}><label>项目名称<input name="name" required maxLength={120} defaultValue={opportunityDisplayTitle(creatingProject.title)}/></label><label>项目性质<Select name="projectType" required defaultValue=""><option value="" disabled>请选择项目性质</option><option value="NEW_PRODUCT">新品/机会型（建议）</option><option value="EXISTING_PRODUCT">已有商品运营型</option></Select></label><label>项目范围与目标<textarea name="scope" required maxLength={1000} rows={3} placeholder="写明本次拟研究或开发的范围；尚未证实的功效请勿写成确定事实"/></label>{creatingProject.categoryId ? <p>产品类目：{categories.find(item => item.id === creatingProject.categoryId)?.name ?? '已关联类目'}</p> : <label>产品类目<Select name="categoryId" required defaultValue=""><option value="">选择类目</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</Select></label>}<button className="primary" type="submit">确认并创建项目</button></fieldset></form></Modal>}
  </section>;
}
