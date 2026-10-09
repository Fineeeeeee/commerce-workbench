import { Select } from './components/Select.js';
import { useEffect, useRef, useState } from 'react';
import { api, json } from './api.js';
import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';
import { BlockSkeleton, EmptyState, InlineError } from './components/states.js';
import { useRoutedState } from './workspace-route.js';
import { elapsedLabel } from '../../../packages/contracts/task-presentation.js';

const labels: Record<string, string> = { partial: '部分完成', queued: '等待执行', running: '正在制作', saving_result: '正在打包', succeeded: '已完成', failed: '未完成', cancelled: '已取消', needs_reconciliation: '结果待核实', waiting_external: '处理中' };
export function JobPanel({ refresh, onSettled }: { refresh: number; onSettled?: () => void }) {
  const [selectedJob,setSelectedJob]=useRoutedState<string|null>('backgroundJob',null);
  const [jobs, setJobs] = useState<JobInfo[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pageCursor, setPageCursor] = useState<string | undefined>(), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading,setLoading]=useState(true);
  const [now,setNow]=useState(()=>new Date().toISOString());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date().toISOString()),1000);return()=>clearInterval(timer);},[]);
  const resumeKeys = useRef(new Map<string, string>());
  const settledCallback = useRef(onSettled), lastSignature = useRef(''); settledCallback.current = onSettled;
  useEffect(() => {
    let active = true, inFlight = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = selectedJob ? {items:[await api<JobInfo>(`/jobs/${selectedJob}`,{signal:controller.signal})],nextCursor:null} : await api<{ items: JobInfo[]; nextCursor: string | null }>(`/jobs?limit=20${pageCursor ? `&cursor=${pageCursor}` : ''}`, { signal: controller.signal });
        if (!active) return; setJobs(result.items); setNextCursor(result.nextCursor); setError('');setLoading(false);
        const signature = result.items.map(j => `${j.id}:${j.state}`).join('|');
        if (signature !== lastSignature.current) { lastSignature.current = signature; settledCallback.current?.(); }
        timer = setTimeout(load, document.hidden ? 10000 : 5000);
      } catch (e) { if (active) {setLoading(false); setError('无法读取任务进度，连接恢复后会重新检查'); timer = setTimeout(load, 10000); } }
      finally { inFlight = false; }
    }
    const reload = () => { if (timer) clearTimeout(timer); void load(); };
    void load(); window.addEventListener('online', reload);
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); window.removeEventListener('online', reload); };
  }, [refresh, revision, pageCursor,selectedJob]);
  async function act(fn: () => Promise<unknown>) { if (busy) return; setBusy(true); try { await fn(); setRevision(v => v + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="standard-page history-page">
    <div className="section-heading"><div><h2>后台制作任务</h2><p className="muted">文案、视觉与导出使用提交时的内容方案和资料版本；状态自动更新。</p></div>{selectedJob&&<button onClick={()=>setSelectedJob(null)}>查看全部任务</button>}</div>
    {error && <InlineError onRetry={()=>setRevision(value=>value+1)}>{error}</InlineError>}
    {loading&&<BlockSkeleton/>}
    <div className="card card-pad">{jobs.length ? jobs.map(job => <article className="history-row" key={job.id}><div className="job-body">
      <strong>{job.name} · 方案修订记录 #{job.kitVersion} · {job.operation === 'copy' ? '候选文案' : job.operation === 'image' ? '视觉候选' : '整套导出'}</strong><small>{new Date(job.createdAt).toLocaleString('zh-CN')} · {terminal(job.state)?'总用时':'已用时（含排队）'} {elapsedLabel(job.createdAt,terminal(job.state)?job.tasks.reduce((latest,task)=>task.updatedAt>latest?task.updatedAt:latest,job.createdAt):now)}</small>{!selectedJob&&<><span>{labels[job.state]??job.state} · {job.tasks.length} 项</span><button className="text-button" onClick={()=>setSelectedJob(job.id)}>查看此任务</button></>}{selectedJob&&<>
      {job.operation === 'copy' && <p className="small">已记录输入：{job.usage.inputTokens ?? '未知'} · 已记录输出：{job.usage.outputTokens ?? '未知'} Token · 费用以服务账单为准</p>}
      {job.operation === 'image' && <p className="small">已保存图片：{job.usage.imageCount ?? '未知'} 张 · 费用以服务账单为准</p>}
      {job.tasks.map(task => <div key={task.id}><p>{labels[task.state] || task.state} · {task.stage}</p>{job.operation==='export'&&<small>已处理 {task.progress} / {task.total} 页</small>}{task.error && <InlineError>{task.error}</InlineError>}
        <div className="actions">
          {task.state === 'queued' && <button disabled={busy} onClick={() => act(() => api(`/jobs/${job.id}/cancel`, json({})))}>取消排队</button>}
          {task.state === 'failed' && ['resume_local', 'resume_copy_save', 'resume_image_save'].includes(task.recoveryAction ?? '') && <button disabled={busy} onClick={() => act(async () => { let key = resumeKeys.current.get(task.id); if (!key) { key = crypto.randomUUID(); resumeKeys.current.set(task.id, key); } const result = await api(`/tasks/${task.id}/resume`, { ...json({}), headers: { 'Idempotency-Key': key } }); resumeKeys.current.delete(task.id); return result; })}>{job.operation === 'export' ? '恢复导出' : '恢复结果保存'}</button>}
          {task.state === 'succeeded' && task.exportId && <a className="button" href={`/api/exports/${task.exportId}/download`} download>下载整套图片</a>}
          {task.state === 'succeeded' && job.operation === 'copy' && <span>候选已保存，返回内容制作即可核对并采用。</span>}
        </div>
        {task.state === 'needs_reconciliation' && ['copy', 'image'].includes(job.operation) && <Reconciliation taskId={task.id} onDone={() => setRevision(v => v + 1)}/>}
      </div>)}
    </>}</div></article>) : !loading&&!error?<EmptyState title="暂无内容制作任务" desc="提交文案、视觉或导出后，可在这里查看执行结果。"/>:null}</div>
    <div className="actions job-pager">{pageCursor && <button onClick={() => setPageCursor(undefined)}>返回最新</button>}{nextCursor && <button onClick={() => setPageCursor(nextCursor)}>下一页</button>}</div>
  </section>;
}

function Reconciliation({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [conclusion, setConclusion] = useState('not_completed'), [evidence, setEvidence] = useState(''), [reviewer, setReviewer] = useState('');
  if (!open) return <button onClick={() => setOpen(true)}>记录人工核对结果</button>;
  return <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); try { await api(`/tasks/${taskId}/reconciliation`, json({ conclusion, evidence, reviewer })); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
    <p>先核对供应商请求记录。保存此结论不会自动重发，也不会把费用改成零。</p>
    <label>核对结论<Select value={conclusion} onChange={e => setConclusion(e.target.value)}><option value="not_completed">确认未完成生成</option><option value="completed_unretrievable">已完成，但无法取回结果</option></Select></label>
    <label>依据<textarea minLength={5} maxLength={1000} required value={evidence} onChange={e => setEvidence(e.target.value)}/></label><label>核对人<input maxLength={100} required value={reviewer} onChange={e => setReviewer(e.target.value)}/></label>
    {error && <p role="alert">{error}</p>}<button disabled={busy}>保存核对结果</button>
  </form>;
}
