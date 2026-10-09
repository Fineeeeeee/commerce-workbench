import { useEffect, useRef, useState } from 'react';
import type { Kit } from '../../../packages/contracts/domain.js';
import type { Fact, TemplateState } from '../../../packages/contracts/content-template.js';
import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';
import { useContentJobs, notifyContentJob } from './content-job-polling.js';
import { generationSubmissionKey } from './generation-submission.js';
import { api, json } from './api.js';
import { BlockSkeleton, InlineError } from './components/states.js';
import { factDisplayValue } from './display-text.js';
import { AsyncTaskCard, ProgressClaim } from './components/semantic-work.js';
import { contentPageStateLabels as pageStateLabels, contentStageLabels, deriveContentPageState, deriveContentWorkflow, eligibleCopyPageIds } from './content-workflow.js';

export type PageOverview = { pageId:string; templateId:string; name:string; generationMode:string; state:TemplateState; missingLabels:string[]; copyStatus:'draft'|'confirmed'; canGenerateCopy:boolean; canGenerateVisual:boolean; hasCopyCandidate:boolean; hasVisualCandidate:boolean };
export type TemplateOverview = { templateName:string; facts:Fact[]; pages:PageOverview[] };


export function TemplatePanel({ kit, dirty, copyReady, imageReady, productionBatchId, onOverview, onPage, onHistory, onExport }: { kit:Kit; dirty:boolean; copyReady:boolean; imageReady:boolean; productionBatchId?:string|null; onOverview?:(value:TemplateOverview|null)=>void; onPage:(id:string)=>void; onHistory:()=>void; onExport:()=>void }) {
  const [data,setData] = useState<TemplateOverview|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  useEffect(()=>{onOverview?.(data);},[data,onOverview]);
  const polled=useContentJobs(kit.id);
  const currentKit=useRef(kit.id);currentKit.current=kit.id;
  const generating=polled.jobs.filter(job=>job.operation!=='export'&&!terminal(job.state));
  async function load() { const next=await api<TemplateOverview>(`/kits/${kit.id}/template-overview`);if(currentKit.current===kit.id){setData(next);setError('');} }
  useEffect(() => { let active=true; setData(null); setError(''); api<TemplateOverview>(`/kits/${kit.id}/template-overview`).then(value=>{ if(active)setData(value); }).catch(e=>{if(active)setError(e.message);}); return()=>{active=false;}; },[kit.id,kit.version]);
  useEffect(() => { const timer=setInterval(()=>{ if (!document.hidden) load().catch(e=>setError(e.message)); },5000); return()=>clearInterval(timer); },[kit.id]);
  async function submit(operation:'copy'|'image', pageIds:string[]) {
    if (busy || !pageIds.length) return; setBusy(true); setError('');
    try { const keyName=`template-${operation}:${kit.id}:${kit.version}:${pageIds.join(',')}`, previousId=sessionStorage.getItem(`${keyName}:job`);
      const previous=previousId?await api<JobInfo>(`/jobs/${previousId}`):polled.jobs.find(job=>job.operation===operation&&job.kitVersion===kit.version&&job.tasks.length===pageIds.length&&job.tasks.every(task=>task.pageId&&pageIds.includes(task.pageId)))??null;
      if(previous&&!terminal(previous.state)){setMessage('当前批量任务仍在进行，状态会自动更新。');return;}
      const key=generationSubmissionKey(sessionStorage,keyName,previous);
      const created=await api<JobInfo>(`/kits/${kit.id}/jobs`,{...json(operation==='copy'?{kitVersion:kit.version,operation,pageIds,...(productionBatchId?{productionBatchId}:{})}:{kitVersion:kit.version,operation,pageIds,imageMode:'quality',...(productionBatchId?{productionBatchId}:{})}),headers:{'Idempotency-Key':key}});
      sessionStorage.setItem(`${keyName}:job`,created.id);
      notifyContentJob();setMessage(`已提交 ${pageIds.length} 页${operation==='copy'?'文案':'背景'}制作任务`); await load();
    } catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  const reload=()=>{setError('');void load().catch(e=>setError(e.message));};
  if(!data) return <section className="template-panel">{error?<InlineError onRetry={reload}>{error}</InlineError>:<BlockSkeleton/>}</section>;
  const copyPages=eligibleCopyPageIds(data.pages);
  const imagePages=data.pages.filter(page=>page.canGenerateVisual&&!page.hasVisualCandidate&&['READY','FAILED'].includes(page.state)).map(page=>page.pageId);
  const workflow=deriveContentWorkflow(data.pages);
  const reviewPage=data.pages.find(item=>item.state==='GENERATED'&&item.copyStatus==='confirmed');
  const candidatePage=data.pages.find(item=>item.hasVisualCandidate&&item.copyStatus==='confirmed'&&item.state==='READY');
  const stages=[
    {id:'product' as const,meta:`${data.facts.length} 条事实`},
    {id:'copy' as const,meta:'逐页确认'},
    {id:'visual' as const,meta:'制作背景'},
    {id:'review' as const,meta:'人工核对'},
    {id:'history' as const,meta:'保存与交付'},
  ];
  const primaryAction=workflow.current==='copy'&&copyPages.length?<button className={onOverview?'content-stage-action':'primary'} disabled={busy||dirty||!copyReady} onClick={()=>submit('copy',copyPages)}>批量生成 {copyPages.length} 页文案</button>
    :workflow.current==='visual'&&candidatePage?<button className={onOverview?'content-stage-action':'primary'} onClick={()=>onPage(candidatePage.pageId)}>核对视觉候选</button>
    :workflow.current==='visual'&&imagePages.length?<button className={onOverview?'content-stage-action':'primary'} disabled={busy||dirty||!imageReady} onClick={()=>submit('image',imagePages)}>生成 {imagePages.length} 页视觉背景</button>
    :workflow.current==='review'&&reviewPage?<button className={onOverview?'content-stage-action':'primary'} onClick={()=>onPage(reviewPage.pageId)}>审核下一页</button>
    :workflow.current==='history'?<button className={onOverview?'content-stage-action':'primary'} onClick={onExport}>检查并导出整套</button>
    :<button className={onOverview?'content-stage-action':'primary'} onClick={()=>document.getElementById('studio-pages')?.scrollIntoView({behavior:'smooth'})}>查看缺失资料</button>;
  return <section className={onOverview?"content-workflow card content-workflow-compact":"content-workflow card"}><div className="content-next-action"><div><span className="eyebrow">当前工作 · {contentStageLabels[workflow.current]}</span><h2>{workflow.current==='copy'?'把产品事实整理成可用文案':workflow.current==='visual'?(workflow.candidatePending?'核对视觉候选':'为已确认文案制作视觉'):workflow.current==='review'?'核对页面并完成审核':workflow.current==='history'?'保存并交付内容版本':'补齐制作所需的产品资料'}</h2>{workflow.current==='copy'&&!copyReady&&<small className="content-block-reason">当前未连接文案服务，暂不能提交生成任务。</small>}{workflow.current==='visual'&&!workflow.candidatePending&&!imageReady&&<small className="content-block-reason">当前未连接图片服务，暂不能提交生成任务。</small>}{dirty&&<small className="content-block-reason">请先保存当前修改，再执行批量操作。</small>}</div><div className="content-primary-action">{primaryAction}</div></div>
    <ProgressClaim workflow={workflow} onDetails={()=>{const details=document.getElementById('studio-pages') as HTMLDetailsElement|null;if(details){const parent=details.closest('.content-tools-disclosure') as HTMLDetailsElement|null;if(parent)parent.open=true;details.open=true;details.scrollIntoView({behavior:'smooth'});}}}/>
    {generating.length>0&&<div className="semantic-task-list">{generating.map(job=><AsyncTaskCard key={job.id} job={job} title={job.operation==='copy'?'文案制作':'视觉制作'}/>)}</div>}
    {polled.error&&<InlineError onRetry={polled.refresh}>{polled.error}</InlineError>}
    {error&&<InlineError onRetry={reload}>{error}</InlineError>}{message&&<p role="status" className="small">{message}</p>}
    <details className="content-tools-disclosure"><summary>{onOverview?'制作流程与产品事实':'流程、产品事实与逐页状态'}</summary>
    <details className="content-stage-disclosure"><summary>制作流程 <span>产品资料 → 文案 → 视觉 → 审核 → 版本与导出</span></summary><div className="content-stage-track" aria-label="各环节独立进度">{stages.map(stage=><button type="button" key={stage.id} className={stage.id===workflow.current?'current':''} onClick={()=>{if(stage.id==='history'){onHistory();return;}const target=stage.id==='product'?'studio-facts':stage.id==='copy'?'studio-copy':stage.id==='visual'?'studio-visual':'studio-review';const element=document.getElementById(target);if(stage.id==='product'&&element instanceof HTMLDetailsElement)element.open=true;else document.querySelector<HTMLButtonElement>(`.editor-stage-tabs button[data-stage="${stage.id}"]`)?.click();requestAnimationFrame(()=>element?.scrollIntoView({behavior:'smooth',block:'center'}));}}><span aria-hidden="true">·</span><strong>{contentStageLabels[stage.id]}</strong><small>{stage.meta}</small></button>)}</div></details>
    <details id="studio-facts"><summary>查看已确认产品事实 · {data.facts.length} 条</summary><div className="fact-list">{data.facts.map(fact=><span key={fact.id} title={`来源：${fact.source}`}>✓ {fact.label}：{factDisplayValue(fact)}</span>)}</div></details>
    {!onOverview&&<details id="studio-pages" className="content-page-overview" open={workflow.current==='product'}><summary><span><strong>查看逐页状态</strong></span></summary>{workflow.current!=='copy'&&copyPages.length>0&&<div className="actions"><button disabled={busy||dirty||!copyReady} onClick={()=>submit('copy',copyPages)}>批量生成 {copyPages.length} 页可用文案</button></div>}<div className="template-status-grid">{data.pages.map(item=>{const page=kit.pages.find(candidate=>candidate.id===item.pageId)!;const state=deriveContentPageState(item,page);return <button key={item.pageId} className={`template-state page-state-${state}`} onClick={()=>onPage(item.pageId)}><strong>{item.templateId} · {item.name}</strong><span>{pageStateLabels[state]}</span>{item.missingLabels.length>0&&<small>缺少：{item.missingLabels.join('、')}</small>}</button>;})}</div></details>}
    </details>
  </section>;
}
