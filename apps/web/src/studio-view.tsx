import { Select } from './components/Select.js';
import { useContentJobs, pageGenerationJob } from './content-job-polling.js';
import { terminal } from '../../../packages/contracts/tasks.js';
import { useRoutedState } from './workspace-route.js';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, Clock3, FileImage, Layers3, Package, Plus, Save, SlidersHorizontal } from 'lucide-react';
import type { Asset, DesignPage, ExportRecord, Kit, Product, Revision } from '../../../packages/contracts/domain.js';
import { renderSvg } from '../../../packages/contracts/render.js';
import { templateById } from '../../../packages/contracts/content-template.js';
import { PageHeader } from './components/PageHeader.js';
import { EmptyState, InlineError } from './components/states.js';
import { contentPageConclusion, contentPageStateLabels, deriveContentPageState } from './content-workflow.js';
import { TemplatePanel, type TemplateOverview } from './template-panel.js';
import { statusToneClass } from './status-vocabulary.js';
import { StatusBadge } from './components/StatusBadge.js';
import { VersionTag } from './components/semantic-work.js';
import { CopyPanel, type CopyControls, type CopyAvailability } from './copy-panel.js';
import { ImagePanel } from './image-panel-task.js';
import { VersionExportPanel } from './version-export-panel.js';
import type { Connection } from './workspace.js';
import { api } from './api.js';
import { sourceDisplayLabel } from './display-text.js';
import { ContentProductionPanel } from './content-production-panel.js';
import { VisualReviewChecklist } from './visual-review-checklist.js';
import { ContentQualityPanel } from './content-quality-panel.js';
import { ListingSeoPanel } from './listing-seo-panel.js';
import { Modal } from './components/Modal.js';
import type { WorkTarget } from '../../../packages/contracts/overview-work.js';

export type StudioTab = 'production' | 'history';

interface StudioViewProps {
  workTarget?: WorkTarget;
  onWorkHandled?: () => void;
  tab: StudioTab;
  products: Product[];
  productId: string;
  product: Product | undefined;
  assets: Asset[];
  kits: Kit[];
  draft: Kit | null;
  saved: Kit | null;
  page: DesignPage | undefined;
  pageProduct: Product | undefined;
  selectedPages: DesignPage[];
  kind: 'main' | 'detail';
  approved: number;
  dirty: boolean;
  busy: boolean;
  outdated: boolean;
  issues: string[];
  connections: Connection[];
  records: ExportRecord[];
  revisions: Revision[];
  jobRefresh: number;
  onTab: (tab: StudioTab) => void;
  onCreate: () => void;
  onCreateProduct: () => void;
  onProduct: (id: string) => void;
  onProducts: () => void;
  onProject: (projectId: string) => void;
  onCreateKit: () => void;
  onKit: (kit: Kit) => void;
  onKind: (kind: 'main' | 'detail') => void;
  onPage: (id: string) => void;
  onSave: () => void;
  onExport: () => void;
  onSync: () => void;
  onEdit: (change: Partial<DesignPage>) => void;
  onAdopted: (updated: Kit, source: Kit, type: 'copy' | 'image') => void;
  onReview: () => void;
  onRestore: (revision: Revision) => void;
  onJobsSettled: () => void;
}

export function StudioView(props: StudioViewProps) {
  const { tab, products, productId, product, assets, kits, draft, saved, page, pageProduct, selectedPages, kind, approved, dirty, busy, outdated, issues, connections, records, revisions, jobRefresh, onTab, onCreate, onCreateProduct, onProduct, onProducts, onCreateKit, onKit, onKind, onPage, onSave, onExport, onSync, onEdit, onAdopted, onReview, onRestore, onJobsSettled } = props;
  const [businessContextValue,setBusinessContext]=useState<{project:{id:string;name:string}|null;spu:{id:string;brand:string;name:string}|null}>({project:null,spu:null});
  const [businessContextProductId,setBusinessContextProductId]=useState<string|null>(null);
  const businessContext = businessContextProductId === productId ? businessContextValue : {project:{id:'',name:'正在读取项目归属…'},spu:null};
  const [productionBatchId,setProductionBatchId]=useState<string|null>(null);
  const [templateOverview,setTemplateOverview]=useState<TemplateOverview|null>(null);
  const copyControls=useRef<CopyControls>(null);
  const [copyAvailability,setCopyAvailability]=useState<CopyAvailability>({active:false,busy:false,count:0,failed:false});
  const contentJobs=useContentJobs(draft?.id??'');
  const pageJobs=contentJobs.jobs.filter(job=>job.tasks.some(task=>task.pageId===page?.id)&&!terminal(job.state));
  const pageBusy=pageJobs.length>0||copyAvailability.busy;
  const copyReady=connections.some(item=>item.id==='copy'&&['ready','available'].includes(item.state));
  const [editorTab,setEditorTab]=useRoutedState<'copy'|'visual'|'review'>('editorTab','copy',['copy','visual','review']);
  const [supportOpen,setSupportOpen]=useRoutedState<boolean>('productionDrawer',false);
  const [batchLoadError,setBatchLoadError]=useState('');
  const [batchLoaded,setBatchLoaded]=useState(false);
  const [batchReadRevision,setBatchReadRevision]=useState(0);
  useEffect(()=>{let active=true;setProductionBatchId(null);setBatchLoadError('');setBatchLoaded(false);if(productId&&draft?.id)api<string[]>(`/products/${productId}/content-production-batches?kitId=${draft.id}`).then(ids=>{if(active){setProductionBatchId(ids[0]??null);setBatchLoaded(true);}}).catch(()=>{if(active)setBatchLoadError('生产批次暂未读取成功，请重新加载后审核。');});return()=>{active=false;};},[productId,draft?.id,batchReadRevision]);
  useEffect(() => {
    const target = props.workTarget;
    if (!target?.contentAction || draft?.id !== target.kitId || (target.pageId && page?.id !== target.pageId) || tab !== 'production') return;
    const targetTab=target.contentAction==='candidate'?'visual':target.contentAction;
    if(editorTab!==targetTab){setEditorTab(targetTab);return;}
    const section = document.getElementById(target.contentAction === 'review' ? 'studio-review' : target.contentAction === 'copy' ? 'studio-copy' : 'studio-visual');
    if (!section) return;
    if (target.contentAction !== 'review') section.querySelectorAll('details').forEach(item => { item.open = true; });
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    section.querySelector<HTMLElement>('button:not(:disabled), input, summary')?.focus({ preventScroll: true });
    props.onWorkHandled?.();
  }, [props.workTarget, draft?.id, page?.id, tab, editorTab]);
  useEffect(()=>{if(!productId){setBusinessContext({project:null,spu:null});setBusinessContextProductId(null);return;}let active=true;api<{project:{id:string;name:string}|null;spu:{id:string;brand:string;name:string}|null}>(`/products/${productId}/business-context`).then(value=>{if(active){setBusinessContext(value);setBusinessContextProductId(productId);}}).catch(()=>{if(active){setBusinessContext({project:null,spu:null});setBusinessContextProductId(productId);}});return()=>{active=false;};},[productId]);
  return <div className="studio-view">
    {batchLoadError&&<InlineError onRetry={()=>setBatchReadRevision(value=>value+1)}>{batchLoadError}</InlineError>}
    <PageHeader className="page-heading" title="内容工坊" actions={<button disabled={!product || busy} onClick={onCreate}><Plus size={16}/>新建内容方案</button>}/>
    <div className="studio-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'production'} className={tab === 'production' ? 'selected' : ''} onClick={() => onTab('production')}>内容制作</button>
      <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'selected' : ''} disabled={!saved} onClick={() => onTab('history')}><Clock3 size={16}/>版本与导出</button>
    </div>
    {tab === 'history' && saved ? <VersionExportPanel busy={busy} current={saved} revisions={revisions} records={records} jobRefresh={jobRefresh} onRestore={onRestore} onJobsSettled={onJobsSettled}/> : !product ?
      <EmptyState icon={<Package size={38}/>} title="从第一款真实商品开始" desc="建立商品档案，再上传白底图和确认的卖点。" action={<button className="primary" onClick={onCreateProduct}><Plus size={16}/>建立商品档案</button>}/> : <>
      <section className="studio-context card"><div className="studio-context-product"><div className="ribbon-image">{assets[0] ? <img loading="lazy" decoding="async" src={`/api/assets/${assets[0].id}/content?preview=1`} alt="当前商品"/> : <Package/>}</div><div><small>商品 / SKU</small><strong className="studio-product-name">{product?.name} · {product?.specification}</strong>{products.length > 1 && <details className="studio-product-switch"><summary>切换商品</summary><div className="studio-product-options">{products.map(item => <button type="button" key={item.id} aria-current={item.id === productId ? 'true' : undefined} disabled={item.id === productId} onClick={() => onProduct(item.id)}>{item.name} · {item.specification}{item.id === productId ? ' · 当前' : ''}</button>)}</div></details>}</div></div><dl><div><dt>所属项目</dt><dd>{businessContext.project?.id ? <a className="text-button" href={`#/projects?project=${businessContext.project.id}&ui.projectStage=project-content`} onClick={event=>{if(dirty){event.preventDefault();props.onProject(businessContext.project!.id);}}}>{businessContext.project.name}<ArrowRight size={14}/></a> : businessContext.project?.name ?? '独立商品'}</dd></div><div className="context-kit"><dt>内容方案</dt><dd>{draft?<div className="kit-selector"><Select aria-label="当前内容方案" value={draft.id} onChange={event => { const kit = kits.find(item => item.id === event.target.value); if (kit) onKit(kit); }}>{kits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>:'尚未建立'}</dd></div><div className="context-secondary"><dt>模板</dt><dd>{draft ? `淘宝日化商品图 5+12 · ${draft.pages.length} 页` : '建立内容方案后选择'}</dd></div><div className="context-secondary"><dt>修订记录</dt><dd>{draft ? <VersionTag version={draft.version} date={draft.updatedAt} dirty={dirty}/> : '—'}</dd></div></dl><button className="text-button" onClick={onProducts}>商品资料<ChevronRight size={15}/></button></section>

      {supportOpen&&<Modal title="内容方向与生产管理" onClose={()=>setSupportOpen(false)}><ContentProductionPanel product={product} kit={draft} onBatch={setProductionBatchId}/><ListingSeoPanel product={product}/></Modal>}
      {!draft ? <EmptyState icon={<Layers3 size={34}/>} title="为这款商品编排一套图片" desc="5 张主图，默认 12 张详情图；先建立结构，再完善每一页。" action={<button className="primary" onClick={onCreateKit}>建立第一套图</button>}/> : <>
      <div className="kit-toolbar"><div className="actions"><button onClick={()=>setSupportOpen(true)}><Layers3 size={16}/>内容方向与生产管理</button><button disabled={busy || !dirty} onClick={onSave}><Save size={15}/>保存修改</button></div></div>
      <div id="studio-template"><TemplatePanel onOverview={setTemplateOverview} kit={draft} dirty={dirty} productionBatchId={productionBatchId} copyReady={connections.some(item => item.id === 'copy' && ['ready','available'].includes(item.state))} imageReady={connections.some(item => item.id === 'image' && ['ready','available'].includes(item.state))} onHistory={()=>onTab('history')} onExport={onExport} onPage={id => { onPage(id); onKind(draft.pages.find(item=>item.id===id)?.kind ?? 'main'); document.getElementById('studio-canvas')?.scrollIntoView({behavior:'smooth'}); }}/></div>
      {outdated && <div className="notice warning"><AlertCircle size={17}/><span>商品资料已更新。当前设计稿仍引用 v{draft.productVersion}，请同步后重新审核。</span><button onClick={onSync}>同步最新资料</button></div>}
      <div className="studio-grid reference-studio-grid" id="studio-canvas"><aside id="studio-pages" className="studio-page-navigation"><h3>内容页面 <span>{draft.pages.length}</span></h3>{(['main','detail'] as const).map(group=><div key={group}><h4>{group==='main'?'主图':'详情图'}</h4>{draft.pages.filter(item=>item.kind===group).map(item=><button key={item.id} className={item.id===page?.id?'selected':''} onClick={()=>{onKind(item.kind);onPage(item.id);}}><span>{item.templateId}<strong>{templateById(item.templateId)?.name??item.purpose}</strong></span>{(()=>{const overview=templateOverview?.pages.find(value=>value.pageId===item.id);const state=overview?deriveContentPageState(overview,item):null;return state?<span className={`badge ${statusToneClass(state)}`} title={overview?.missingLabels.join('、')}>{contentPageStateLabels[state]}</span>:<StatusBadge domain="content" status={item.reviewed?'reviewed':item.copyStatus}/>;})()}</button>)}</div>)}</aside><section className="canvas-workspace">
        {page && pageProduct && <><div className="canvas-meta"><strong>{contentPageConclusion(templateOverview?.pages.find(item=>item.pageId===page.id),page)}</strong><span>1080 × {page.kind==='main'?'1080':'1440'} px <i/> 模板预览</span></div><div className="canvas-stage"><div className={`artboard ${page.kind}`} aria-label="当前图片预览" dangerouslySetInnerHTML={{__html:renderSvg(page,pageProduct,page.assetId?`/api/assets/${page.assetId}/content`:null,page.visualArtifactId?`/api/artifacts/${page.visualArtifactId}/content`:null)}}/></div><div className="canvas-footer"><span><CircleHelp size={14}/>{page.visualArtifactId?(page.visualMode==='REFERENCE_IMAGE'?'已采用参考图完整候选 · 修改文案后须重新生成并审核':'已采用 AI 视觉底图 · 文字仍可编辑'):'原始商品图与可编辑文字排版'}</span><div><button className="icon-button" aria-label="上一张" disabled={selectedPages[0]?.id===page.id} onClick={()=>onPage(selectedPages[selectedPages.findIndex(item=>item.id===page.id)-1]!.id)}><ArrowLeft size={16}/></button><span>{selectedPages.findIndex(item=>item.id===page.id)+1} / {selectedPages.length}</span><button className="icon-button" aria-label="下一张" disabled={selectedPages.at(-1)?.id===page.id} onClick={()=>onPage(selectedPages[selectedPages.findIndex(item=>item.id===page.id)+1]!.id)}><ArrowRight size={16}/></button></div></div></>}
        {page&&pageProduct&&<div className="canvas-inline-editor"><div className="editor-stage-tabs" role="tablist" aria-label="文案与视觉编辑">{(['copy','visual','review'] as const).map(value=><button key={value} role="tab" data-stage={value} aria-selected={editorTab===value} className={editorTab===value?'selected':''} onClick={()=>setEditorTab(value)}>{{copy:'文案',visual:'视觉',review:'审核'}[value]}</button>)}</div>        <section className="editor-task" id="studio-copy" hidden={editorTab!=='copy'}><div className="field-section-heading"><h3>文案</h3><button disabled={dirty||pageBusy||!connections.some(item=>item.id==='copy'&&['ready','available'].includes(item.state))} onClick={()=>copyControls.current?.generate()}>AI 重试本页</button></div><CopyPanel ref={copyControls} onAvailability={setCopyAvailability} blocked={pageJobs.some(job=>job.operation!=='copy')} key={`${draft.id}:${page.id}`} kit={draft} page={page} dirty={dirty} ready={connections.some(item=>item.id==='copy'&&['ready','available'].includes(item.state))} onAdopted={updated=>onAdopted(updated,draft,'copy')}/><label><span className="field-action-heading">主标题 <span>{page.headline.length}/36</span><button type="button" aria-label="AI 重写主标题" disabled={dirty||pageBusy||!copyReady} onClick={()=>copyControls.current?.generate('headline')}>AI 重写</button></span><input maxLength={36} value={page.headline} onChange={event=>onEdit({headline:event.target.value})} placeholder="填写这一页最重要的一句话"/></label><label><span className="field-action-heading">副标题<button type="button" aria-label="AI 重写副标题" disabled={dirty||pageBusy||!copyReady} onClick={()=>copyControls.current?.generate('subtitle')}>AI 重写</button></span><input maxLength={64} value={page.subtitle} onChange={event=>onEdit({subtitle:event.target.value})} placeholder="补充香型、规格或产品信息"/></label><label><span className="field-action-heading">正文 / 卖点说明<span>{page.body.length}/180</span><button type="button" aria-label="AI 重写正文" disabled={dirty||pageBusy||!copyReady} onClick={()=>copyControls.current?.generate('body')}>AI 重写</button></span><textarea rows={4} maxLength={180} value={page.body} onChange={event=>onEdit({body:event.target.value})} placeholder="只使用本产品已确认的信息"/></label><div className="copy-confirm-row"><StatusBadge domain="content" status={page.copyStatus}/>{page.copyStatus==='draft'&&<button className="primary" disabled={pageBusy||!page.headline||!page.sourceFactIds.length} onClick={()=>onEdit({copyStatus:'confirmed'})}>确认本页文案</button>}</div><div className="copy-candidate-entry"><button className="text-button" onClick={()=>copyControls.current?.open()}>查看文案候选{copyAvailability.count>0?` · ${copyAvailability.count}`:''}</button></div></section>
        <section className="editor-task" id="studio-visual" hidden={editorTab!=='visual'}><h3>视觉</h3><label>商品图片<Select value={page.assetId??''} onChange={event=>onEdit({assetId:event.target.value||null})}><option value="">请选择素材</option>{assets.map((asset,index)=><option key={asset.id} value={asset.id}>素材 {index+1} · {asset.width} × {asset.height}</option>)}</Select></label><div className="editor-secondary"><ImagePanel key={`image:${draft.id}:${page.id}`} kit={draft} page={page} dirty={dirty} blocked={pageJobs.some(job=>job.operation!=='image')} ready={connections.some(item=>item.id==='image'&&['ready','available'].includes(item.state))&&page.copyStatus==='confirmed'} blockedReason={page.copyStatus!=='confirmed'?'请先生成、修改并确认本页文案，再生成视觉背景。':undefined} onAdopted={updated=>onAdopted(updated,draft,'image')}/></div></section>
</div>}
      </section>
      <aside className="editor-panel">{page && pageProduct && <><div className="editor-heading"><div><span className="eyebrow">当前页面 · {page.templateId}</span><h2>审核工作区</h2></div><SlidersHorizontal size={19}/></div><div className="quality-permanent-notice"><p>AI 质检可能漏判，请人工核对商品、标签和中文。</p></div><div id="studio-review" className="editor-bottom">{!batchLoaded?<p className="muted small">正在读取审核资料…</p>:productionBatchId ? <ContentQualityPanel batchId={productionBatchId} kit={draft} page={page} disabled={busy || dirty || pageBusy} primaryAction={editorTab==='review'||page.copyStatus==='confirmed'} onSavedKit={onKit}/> : <><VisualReviewChecklist kit={draft} page={page} onChange={onEdit}/>{page.reviewed&&<p className="muted small">修改后需重新审核。</p>}{page.reviewed ? <StatusBadge domain="content" status="reviewed"/> : <button className={editorTab==='review'?'primary':''} disabled={busy||dirty||pageBusy} onClick={onReview}><CheckCircle2 size={17}/>保存并审核本页</button>}</>}</div><div className="editor-content">
        <details className="editor-secondary review-support"><summary>审核引用与排版</summary><section className="editor-task" id="studio-review-facts"><h3>审核与追溯</h3><div className="field-label">引用卖点 <span>用于审核追溯</span></div><div className="claim-pills">{pageProduct.claims.map(claim=><label key={claim.id} title={`${claim.text}\n来源：${sourceDisplayLabel(claim.source)}`} className={page.claimIds.includes(claim.id)?'checked':''}><input type="checkbox" checked={page.claimIds.includes(claim.id)} onChange={event=>onEdit({claimIds:event.target.checked?[...page.claimIds,claim.id]:page.claimIds.filter(id=>id!==claim.id)})}/>{claim.label}{claim.status==='pending'&&' · 待核实'}</label>)}{!pageProduct.claims.length&&<p className="muted small">商品暂无卖点资料</p>}</div>{page.claimIds.length>0&&<details className="editor-secondary"><summary>查看引用证据原文</summary><div className="evidence-list">{pageProduct.claims.filter(claim=>page.claimIds.includes(claim.id)).map(claim=><div key={claim.id}><strong>{claim.label}</strong><p>{claim.text}</p><small>{sourceDisplayLabel(claim.source)}</small><button className="text-button" onClick={()=>onEdit({body:claim.text})}>将原文填入正文</button></div>)}</div></details>}<details className="editor-secondary advanced-layout"><summary>高级排版</summary><label>版式<Select value={page.layout} onChange={event=>onEdit({layout:event.target.value as DesignPage['layout']})}><option value="hero">居中首图 · 简短信息</option><option value="editorial">左右编排 · 信息说明</option><option value="focus">聚焦商品 · 简短信息</option></Select></label><div className="colors"><label>背景色<input type="color" value={page.background} onChange={event=>onEdit({background:event.target.value})}/></label><label>文字 / 强调色<input type="color" value={page.accent} onChange={event=>onEdit({accent:event.target.value})}/></label></div><label>商品大小 <span>{Math.round(page.productScale*100)}%</span><input type="range" min="0.75" max="1.15" step="0.01" value={page.productScale} onChange={event=>onEdit({productScale:Number(event.target.value)})}/></label></details>{issues.length>0&&<div className="inline-checks"><strong><ClipboardList size={14}/>本页待完善</strong>{issues.map(issue=><p key={issue}>· {issue}</p>)}</div>}</section></details>
      </div></>}</aside></div>
      </>}</>}
  </div>;
}
