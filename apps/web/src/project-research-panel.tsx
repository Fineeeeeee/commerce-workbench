import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Plus, RefreshCw } from 'lucide-react';
import type { MarketResearchJob } from '../../../packages/contracts/market-research.js';
import { api, json } from './api.js';
import { researchStateLabels } from './market-research-panel.js';
import './project-research-panel.css';

export function ProjectResearchPanel({ projectId, projectName, categoryCode, categoryName, open, onOpen, onMarket, onManualEvidence }: {
  projectId: string; projectName: string; categoryCode: string | null; categoryName: string;
  open: boolean; onOpen: (open: boolean) => void; onMarket: (batchId: string, projectId: string) => void;
  onManualEvidence:()=>void;
}) {
  const [jobs, setJobs] = useState<MarketResearchJob[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const supported = categoryCode === 'shampoo' || categoryCode === 'facial-cleanser';
  async function load() { setJobs(await api<MarketResearchJob[]>(`/product-projects/${projectId}/market-research-jobs`)); }
  useEffect(() => { let active = true; const refresh = () => api<MarketResearchJob[]>(`/product-projects/${projectId}/market-research-jobs`).then(values => { if (active) setJobs(values); }).catch(e => { if (active) setError((e as Error).message); }); void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => { active = false; clearInterval(timer); }; }, [projectId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !supported) return;
    const targetCount = Number(new FormData(event.currentTarget).get('targetCount'));
    setBusy(true); setError('');
    try {
      await api(`/product-projects/${projectId}/market-research-jobs`, { ...json({ targetCount }), headers: { 'Idempotency-Key': submissionKey } });
      setSubmissionKey(crypto.randomUUID()); onOpen(false); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function retry(jobId: string) {
    if (busy) return; setBusy(true); setError('');
    try { await api(`/market-research-jobs/${jobId}/retry`, json({})); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const renderJob = (job: MarketResearchJob) => <article className="project-research-job" key={job.id}>
    <div><strong>京东联盟 · {job.collectionProfile === 'facial_cleanser' ? '洗面奶' : '洗发水'}</strong><small>目标 {job.targetCount} 条 / 最多 {job.maxPages} 页 · 由本项目发起</small><small>{new Date(job.createdAt).toLocaleString('zh-CN')}</small></div>
    <span className={`badge ${job.state === 'FAILED' ? 'badge-danger' : job.state === 'REVIEW_REQUIRED' ? 'badge-warning' : job.state === 'COMPLETED' ? 'badge-success' : 'badge-neutral'}`}>{researchStateLabels[job.state]}</span>
    <div className="project-research-metrics"><span>已扫描 {job.scannedCount}</span><span>有效样本 {job.validCount}</span><span>机会 {job.opportunityCount}</span></div>
    {job.safeMessage && <p role="alert" className="notice-error">{job.safeMessage}</p>}
    <div className="project-research-job-actions">{job.marketBatchId && <button onClick={() => onMarket(job.marketBatchId!, projectId)}>查看分析<ArrowRight size={14}/></button>}{job.state === 'FAILED' && <button disabled={busy} onClick={() => void retry(job.id)}><RefreshCw size={14}/>重试当前步骤</button>}</div>
  </article>;
  if (!jobs.length && !open && !error) return <section id="project-research" className="card project-research project-research-empty" aria-label="本项目市场研究"><span>项目发起的市场研究 <small className="muted">尚无研究</small></span><button onClick={()=>{setSubmissionKey(crypto.randomUUID());onOpen(true);}}>{supported?'发起市场研究':'查看研究范围'}</button></section>;
  return <section id="project-research" className="card project-research" aria-label="本项目市场研究">
    <div className="project-research-heading"><div><h3>项目发起的市场研究</h3><p>本项目是研究发起者；批次与商品记录属于市场资料，只有选中的机会和证据才会纳入项目。</p></div>{supported && <button onClick={() => { if (!open) setSubmissionKey(crypto.randomUUID()); onOpen(!open); }}><Plus size={14}/>发起市场研究</button>}</div>
    {!supported && <div><p className="muted">{categoryName}暂不支持自动采集。当前自动研究支持京东联盟洗发水和洗面奶。可人工记录来源并纳入本项目，继续开展产品定义。</p><button onClick={onManualEvidence}>记录本品类市场资料</button></div>}
    {error && <p role="alert" className="notice-error">{error}</p>}
    {open && supported && <form className="project-research-form" onSubmit={create}><p><strong>项目：</strong>{projectName}</p><p><strong>品类：</strong>{categoryName}　<strong>数据源：</strong>京东联盟　<strong>研究配置：</strong>{categoryName}</p>{categoryCode==='facial-cleanser'&&<p className="muted">洗面奶当前样本较少，本次实际数量以采集结果为准；结论不能扩展为京东全站市场。</p>}<label>目标样本数<input name="targetCount" type="number" min="1" max="100" defaultValue="50" required/></label><button className="primary" disabled={busy}>开始研究</button></form>}
    {jobs.length > 0 ? <><div className="project-research-group"><h4>最近研究</h4>{renderJob(jobs[0]!)}</div>{jobs.length > 1 && <details className="project-research-history"><summary>历史研究 · {jobs.length - 1} 次</summary><div>{jobs.slice(1).map(renderJob)}</div></details>}</> : <p className="muted">尚无由本项目发起的研究。</p>}
  </section>;
}
