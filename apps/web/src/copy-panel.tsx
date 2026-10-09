import { InlineError } from './components/states.js';
import { Modal } from './components/Modal.js';
import { useRoutedState } from './workspace-route.js';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { api, json } from './api.js';
import { factDisplayValue } from './display-text.js';
import { copyLayoutIssues, type CopyCandidate, type Copy } from '../../../packages/contracts/copy.js';
import type { Kit, DesignPage } from '../../../packages/contracts/domain.js';
import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';
import { useContentJobs, pageGenerationJob, notifyContentJob } from './content-job-polling.js';
import { contentRevisionLabel } from './display-text.js';
import { generationSubmissionKey } from './generation-submission.js';

const taskLabels: Record<string,string> = { active:'文案生成中',queued:'等待执行',running:'正在生成文案',saving_result:'正在保存结果',succeeded:'文案候选已生成',failed:'文案生成失败',partial:'部分文案未完成',cancelled:'已取消',needs_reconciliation:'结果状态异常' };

export type CopyControls={generate:(slot?:'headline'|'subtitle'|'body')=>void;open:(slot?:'headline'|'subtitle'|'body')=>void};
export type CopyAvailability={active:boolean;busy:boolean;count:number;failed:boolean};
export const CopyPanel=forwardRef<CopyControls,{kit:Kit;page:DesignPage;dirty:boolean;ready:boolean;blocked?:boolean;onAvailability?:(value:CopyAvailability)=>void;onAdopted:(kit:Kit)=>void}>(function CopyPanel({kit,page,dirty,ready,blocked,onAvailability,onAdopted},ref){
  const [drawer,setDrawer]=useRoutedState<'all'|'headline'|'subtitle'|'body'|null>('copyDrawer',null,['all','headline','subtitle','body']);
  const [candidateId,setCandidateId]=useRoutedState<string|null>('copyCandidate',null);
  const [candidatePage,setCandidatePage]=useState(0);

  const issueId = useId();
  const [list, setList] = useState<CopyCandidate[]>([]), [chosen, setChosen] = useState<CopyCandidate | null>(null), [edit, setEdit] = useState<Copy | null>(null);
  const [job, setJob] = useState<JobInfo | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const submitting = useRef(false), jobKey = `copy-job:${kit.id}:${page.id}`, submissionKey = `copy-submission:${kit.id}:${page.id}`;
  async function load() { setList(await api<CopyCandidate[]>(`/kits/${kit.id}/copy-candidates`)); }
  const polled=useContentJobs(kit.id);
  useEffect(()=>{setJob(pageGenerationJob(polled.jobs,'copy',page.id));let mounted=true;api<CopyCandidate[]>(`/kits/${kit.id}/copy-candidates`).then(values=>{if(mounted)setList(values);}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[polled.jobs,kit.id,page.id]);
  useEffect(()=>{setChosen(null);setEdit(null);setError("");setMessage("");},[kit.id,page.id]);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function submit(copySlot?: 'headline'|'subtitle'|'body') {
    if (submitting.current) return; submitting.current = true;
    try {
      const existingId=sessionStorage.getItem(jobKey);
      const current=existingId?await api<JobInfo>(`/jobs/${existingId}`):job;
      if(current&&!terminal(current.state)){setJob(current);setMessage('当前文案任务仍在执行，没有重复提交。');return;}
      const key=generationSubmissionKey(sessionStorage,submissionKey,current);
      const created=await api<JobInfo>(`/kits/${kit.id}/jobs`,{...json({kitVersion:kit.version,operation:'copy',pageIds:[page.id],...(copySlot?{copySlot}:{})}),headers:{'Idempotency-Key':key}});
      sessionStorage.setItem(jobKey,created.id);setJob(created);notifyContentJob();setMessage(`已提交${copySlot ? {headline:'主标题',subtitle:'副标题',body:'正文/卖点'}[copySlot] : '本页'}文案任务，状态会自动更新。`);
    } finally { submitting.current=false; }
  }
  const issues = edit ? copyLayoutIssues(edit, page) : [];
  const active=!!job&&!terminal(job.state), failed=job?.state==='failed'||job?.state==='needs_reconciliation', task=job?.tasks.find(item=>item.state!=='succeeded'&&item.state!=='cancelled')??job?.tasks[0];
  useImperativeHandle(ref,()=>({generate:slot=>{if(busy||active||dirty||blocked||!ready)return;setDrawer(slot??'all');void run(()=>submit(slot));},open:slot=>{setDrawer(slot??'all');setCandidatePage(0);}}));
  const pageCandidates=list.filter(c=>c.pageId===page.id);
  useEffect(()=>{onAvailability?.({active,busy,count:pageCandidates.length,failed});},[active,busy,pageCandidates.length,failed,onAvailability]);
  function choose(c:CopyCandidate){setChosen(c);setCandidateId(c.id);const value=structuredClone(c.data),evidenceIds=[...new Set([...(page.sourceFactIds??[]),...value.evidenceIds])];setEdit(c.requestedSlot?{...value,headline:c.requestedSlot==='headline'?value.headline:page.headline,subtitle:c.requestedSlot==='subtitle'?value.subtitle:page.subtitle,body:c.requestedSlot==='body'?value.body:page.body,evidenceIds}:value);setError('');}
  useEffect(()=>{const c=pageCandidates.find(item=>item.id===candidateId);if(drawer&&c&&chosen?.id!==c.id)choose(c);},[candidateId,drawer,list]);
  const visibleCandidates=pageCandidates.filter(c=>drawer==='all'||!c.requestedSlot||c.requestedSlot===drawer);
  return <div className="copy-panel copy-inline-status">
    {job&&<div className={`image-task-state ${failed?'failed':job.state==='succeeded'?'succeeded':''}`} role="status"><strong>{taskLabels[job.state]??job.state}</strong><span>{task?.stage}</span>{task?.error&&<p role="alert">{task.error}</p>}{active&&<small>可以离开或刷新页面，任务状态会自动恢复。</small>}</div>}
    {(error||polled.error) && <InlineError onRetry={()=>{setError('');polled.refresh();void load().catch(e=>setError(e.message));}}>{error||polled.error}</InlineError>}{message && <p role="status" className="small">{message}</p>}
    {drawer&&<Modal title={drawer==='all'?'本页文案候选':`${{headline:'主标题',subtitle:'副标题',body:'正文'}[drawer]}候选`} className="workspace-drawer" onClose={()=>setDrawer(null)}>
    <p className="muted small">生成新的候选，不覆盖当前稿；采用后需重新审核。</p>
    <button disabled={busy||active||dirty||blocked||!ready} onClick={()=>void run(()=>submit(drawer==='all'?undefined:drawer))}>{active?'生成中…':failed?'重试生成候选':'生成新候选'}</button>
    {!ready&&<p>文案服务暂不可用。</p>}{dirty&&<p>请先保存当前修改。</p>}
    <div className="copy-candidate-options">{visibleCandidates.slice(candidatePage*3,candidatePage*3+3).map(c=><article key={c.id}><p>{drawer==='all'?c.data.headline:c.data[drawer]}</p><small>{new Date(c.createdAt).toLocaleString('zh-CN')} · 基于{contentRevisionLabel(c.kitVersion)}</small><button onClick={()=>choose(c)}>查看与采用</button></article>)}</div>
    {!visibleCandidates.length&&<p className="muted">尚无候选。</p>}
    {visibleCandidates.length>3&&<div className="actions"><button disabled={!candidatePage} onClick={()=>setCandidatePage(value=>value-1)}>上一组</button><span>{candidatePage+1} / {Math.ceil(visibleCandidates.length/3)}</span><button disabled={(candidatePage+1)*3>=visibleCandidates.length} onClick={()=>setCandidatePage(value=>value+1)}>下一组</button></div>}
    {chosen && edit && <div className="copy-review"><details className="candidate-current-copy"><summary>对比当前稿</summary><p>主标题：{page.headline||'未填写'}</p><p>副标题：{page.subtitle||'未填写'}</p><p>正文：{page.body||'未填写'}</p></details><p className="small">商品资料 v{chosen.productVersion} · {new Date(chosen.createdAt).toLocaleString('zh-CN')}</p>{(['headline', 'subtitle', 'body'] as const).map(field => <label key={field}>{{ headline: '候选主标题', subtitle: '候选副标题', body: '候选正文' }[field]}<textarea maxLength={{ headline: 36, subtitle: 64, body: 180 }[field]} value={edit[field]} aria-invalid={issues.length > 0} aria-describedby={issues.length ? issueId : undefined} onChange={e => setEdit(v => v && ({ ...v, [field]: e.target.value }))}/></label>)}<p className="small">资料依据：</p>{chosen.facts.filter(f => edit.evidenceIds.includes(f.id)).map(f => <p className="muted small" key={f.id}>{f.label}：{factDisplayValue(f)} · 来源：{f.source}</p>)}{edit.notes && <p className="small">需留意：{edit.notes}</p>}{issues.length > 0 && <div id={issueId}>{issues.map(issue => <p key={issue} className="small" role="alert">{issue}</p>)}</div>}<button disabled={busy || active || blocked || dirty || !!issues.length} onClick={() => run(async () => {
      const body = { baseVersion: kit.version, artifactId: chosen.id, content: edit }, signature = JSON.stringify(body), storage = `adoption:${kit.id}`;
      let key = crypto.randomUUID();
      // Store only a digest of edited copy with the operation key, never persist the copy itself.
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)))).map(v => v.toString(16).padStart(2, '0')).join('');
      const stored = sessionStorage.getItem(storage); if (stored) { const value = JSON.parse(stored); if (value.signature === digest) key = value.key; }
      sessionStorage.setItem(storage, JSON.stringify({ signature: digest, key }));
      const updated = await api<Kit>(`/kits/${kit.id}/adoptions`, { ...json(body), headers: { 'Idempotency-Key': key } }); sessionStorage.removeItem(storage); onAdopted(updated); setChosen(null); setCandidateId(null);setDrawer(null);setEdit(null);setMessage('已采用为新版本，本页需要重新审核。');
    })}>采用并保存为新版本</button></div>}
    </Modal>}
  </div>;
});
