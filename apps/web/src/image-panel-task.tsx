import { Select } from './components/Select.js';
import { Modal } from './components/Modal.js';
import { useRoutedState } from './workspace-route.js';
import { useEffect, useRef, useState } from 'react';
import { api, json } from './api.js';
import type { DesignPage, Kit } from '../../../packages/contracts/domain.js';
import { productionImageMode, productionImageModel, selectableImageModels, type ImageCandidate, type ImageMode, type ImageModel } from '../../../packages/contracts/image.js';
import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';
import { InlineError, MissingDataHint } from './components/states.js';
import { useContentJobs, pageGenerationJob, notifyContentJob } from './content-job-polling.js';
import { contentRevisionLabel } from './display-text.js';
import { generationSubmissionKey } from './generation-submission.js';
import { AsyncTaskCard } from './components/semantic-work.js';
import type { EditStrategy } from '../../../packages/contracts/image-type-guide.js';

const labels: Record<ImageMode, string> = { draft: '快速场景草图', background: '商品场景背景', quality: '标准场景背景', premium: '精细场景背景' };
export const imageJobKeys = (kitId: string, pageId: string, mode: ImageMode, model: ImageModel = productionImageModel) => ({ job: `image-job:${kitId}:${pageId}:${mode}:${model}`, submission: `image-submission:${kitId}:${pageId}:${mode}:${model}` });

export function ImagePanel({ kit, page, dirty, ready, blocked, blockedReason, onAdopted }: { kit: Kit; page: DesignPage; dirty: boolean; ready: boolean; blocked?:boolean; blockedReason?: string; onAdopted: (kit: Kit) => void }) {
  const [list, setList] = useState<ImageCandidate[]>([]), [job, setJob] = useState<JobInfo | null>(null);
  const [candidateId,setCandidateId]=useRoutedState<string|null>('imageCandidate',null);
  const [candidateGroup,setCandidateGroup]=useRoutedState<string>('imageGroup','1');
  const [model,setModel]=useState<ImageModel>(productionImageModel);
  const [editStrategy,setEditStrategy]=useState<EditStrategy>('PRESERVE_SUBJECT'),[seed,setSeed]=useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const submitting = useRef(false), mode: ImageMode = productionImageMode;
  useEffect(()=>{let active=true;api<{currentModels:Record<string,string>}>('/model-settings').then(value=>{if(active&&selectableImageModels.includes(value.currentModels.IMAGE_GENERATION as ImageModel))setModel(value.currentModels.IMAGE_GENERATION as ImageModel);}).catch(()=>{});return()=>{active=false;};},[]);
  const keys = imageJobKeys(kit.id, page.id, mode,model);
  async function load() { setList(await api<ImageCandidate[]>(`/kits/${kit.id}/image-candidates`)); }
  const polled=useContentJobs(kit.id);
  useEffect(()=>{setJob(pageGenerationJob(polled.jobs,'image',page.id));let mounted=true;api<ImageCandidate[]>(`/kits/${kit.id}/image-candidates`).then(values=>{if(mounted)setList(values);}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[polled.jobs,kit.id,page.id]);

  useEffect(()=>{setError("");setMessage("");},[kit.id,page.id]);
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function submit(pageIds: string[]) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const storedId = sessionStorage.getItem(keys.job);
      const current=storedId?await api<JobInfo>(`/jobs/${storedId}`):job;
      if (current && !terminal(current.state)) { setJob(current); setMessage('当前图片任务仍在执行，没有重复提交。'); return; }
      const key = generationSubmissionKey(sessionStorage, keys.submission, current);
      const created = await api<JobInfo>(`/kits/${kit.id}/jobs`, { ...json({ kitVersion: kit.version, operation: 'image', imageMode: mode, imageModel:model, pageIds,editStrategy,...(seed!==''?{seed:Number(seed)}:{}) }), headers: { 'Idempotency-Key': key } });
      for (const pageId of pageIds) sessionStorage.setItem(imageJobKeys(kit.id, pageId, mode,model).job, created.id);
      setJob(created); notifyContentJob(); setMessage(`已提交 ${pageIds.length} 页视觉任务，页面会持续更新状态。`);
    } finally { submitting.current = false; }
  }
  async function retry() { await submit([page.id]); }
  const candidates = list.filter(candidate => candidate.pageId === page.id), allReady = kit.pages.every(item => item.assetId);
  const selectedCandidate=candidates.find(item=>item.id===candidateId);
  const group=Math.min(Math.max(Number(candidateGroup)||1,1),Math.max(Math.ceil(candidates.length/3),1));
  const active = !!job && !terminal(job.state), failed = job?.state === 'failed' || job?.state === 'needs_reconciliation';
  const task = job?.tasks.find(item => item.pageId === page.id) ?? job?.tasks.find(item => item.state !== 'succeeded' && item.state !== 'cancelled') ?? job?.tasks[0];
  return <div className="image-panel"><h3>参考图视觉生成</h3><p className="muted small">以本商品参考图、已确认类目指南和文案生成完整候选，仍需核对瓶身、标签与中文。</p><details><summary>高级生成设置</summary><label>视觉模型<Select value={model} disabled={active||busy} onChange={event=>setModel(event.target.value as ImageModel)}>{selectableImageModels.filter(item=>['qwen-image-edit-plus','qwen-image-2.0','qwen-image-2.0-pro','qwen-image-3.0-pro'].includes(item)).map(item=><option key={item} value={item}>{item}</option>)}</Select></label></details>
    {!ready && <MissingDataHint>{blockedReason ?? '图片服务尚未开通，暂不能生成。'}</MissingDataHint>}{blocked&&<MissingDataHint>本页文案任务仍在运行，完成后可生成视觉。</MissingDataHint>}{dirty && <MissingDataHint>先保存当前修改，再生成或采用候选。</MissingDataHint>}
    <details><summary>编辑策略与对比实验</summary><label>编辑策略<Select value={editStrategy} disabled={active||busy} onChange={e=>setEditStrategy(e.target.value as EditStrategy)}><option value="PRESERVE_SUBJECT">保留主体，局部编辑</option><option value="RECOMPOSE_SCENE">重构场景，保留商品身份</option></Select></label><p className="small muted">策略通过提示词约束，不是模型硬锁；包装、标签和中文仍需人工核验。</p><label>实验 seed（选填）<input type="number" min="0" max="2147483647" disabled={active||busy} value={seed} onChange={e=>setSeed(e.target.value)}/></label></details>
    <div className="actions"><button className="content-stage-action" disabled={busy || active || blocked || dirty || !ready || !page.assetId} onClick={() => run(() => failed ? retry() : submit([page.id]))}>{failed ? '重新生成本页视觉' : active ? '本页正在生成' : '生成本页高质量视觉'}</button><button disabled={busy || active || blocked || dirty || !ready || !allReady} onClick={() => run(() => submit(kit.pages.map(item => item.id)))}>生成整套 · {kit.pages.length}页</button></div>
    {!allReady && <MissingDataHint>整套生成前，需要为每一页选择商品素材。</MissingDataHint>}
    {job && <AsyncTaskCard job={job} title="本页视觉任务" detail={task?.stage} action={active ? <small>离开页面后任务继续运行，返回时自动恢复状态。</small> : undefined}/>}
    {(error||polled.error) && <InlineError onRetry={()=>{setError('');polled.refresh();void load().catch(e=>setError(e.message));}}>{error||polled.error}</InlineError>}{message && <p role="status" className="small">{message}</p>}
    <div className="image-candidates">{candidates.slice((group-1)*3,group*3).map(candidate => <article key={candidate.id}><button className="visual-candidate-thumbnail" onClick={()=>setCandidateId(candidate.id)}><img loading="lazy" decoding="async" src={candidate.contentUrl} alt={`${candidate.pagePurpose}视觉候选`}/></button><div><strong>{candidate.visualMode==='REFERENCE_IMAGE'?'参考图完整视觉':labels[candidate.mode]}</strong><small>{candidate.width} × {candidate.height} · 基于{contentRevisionLabel(candidate.kitVersion)}</small><details><summary>查看生成记录</summary><small>{candidate.model}</small></details><button onClick={()=>setCandidateId(candidate.id)}>查看候选</button></div></article>)}</div>
    {candidates.length>3&&<div className="actions"><button disabled={group<=1} onClick={()=>setCandidateGroup(String(group-1))}>上一组</button><small>{group} / {Math.ceil(candidates.length/3)} · {candidates.length} 个候选</small><button disabled={group>=Math.ceil(candidates.length/3)} onClick={()=>setCandidateGroup(String(group+1))}>下一组</button></div>}
    {selectedCandidate&&<Modal className="workspace-drawer" title="视觉候选预览" onClose={()=>setCandidateId(null)}><img className="visual-candidate-preview" src={selectedCandidate.contentUrl} alt="视觉候选预览"/><p className="muted small">先核对候选。采用后仍需核对商品主体、中文和版式。</p><details><summary>生成与来源记录</summary><p>{selectedCandidate.model} · {new Date(selectedCandidate.createdAt).toLocaleString('zh-CN')} · 基于{contentRevisionLabel(selectedCandidate.kitVersion)}</p>{selectedCandidate.generationContext&&<p>图型指南 v{selectedCandidate.generationContext.imageTypeVersion} · 类目指南 v{selectedCandidate.generationContext.categoryGuideVersion}<br/>编辑策略：{selectedCandidate.generationContext.editStrategy==='PRESERVE_SUBJECT'?'保留主体':'重构场景'}（提示词约束） · seed：{selectedCandidate.generationContext.seed??'随机'}<br/>AI Run：{selectedCandidate.generationContext.sourceInferenceRunId}</p>}</details><button disabled={busy || active || blocked || dirty || selectedCandidate.mode === 'draft'} title={selectedCandidate.mode === 'draft' ? '场景草图不含真实商品，不能作为交付底图' : undefined} onClick={() => run(async () => {
        const body = { baseVersion: kit.version, artifactId: selectedCandidate.id }, key = crypto.randomUUID();
        const updated = await api<Kit>(`/kits/${kit.id}/image-adoptions`, { ...json(body), headers: { 'Idempotency-Key': key } }); onAdopted(updated);setCandidateId(null); setMessage('视觉候选已采用为新版本，本页需要重新审核。');
      })}>{selectedCandidate.mode === 'draft' ? '仅供构图参考' : '采用为本页视觉'}</button></Modal>}
  </div>;
}
