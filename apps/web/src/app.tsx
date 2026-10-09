import { preserveWorkspaceUiHash, useRoutedState } from './workspace-route.js';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, CheckCircle2, ChevronRight, ClipboardList, Clock3, Layers3, LayoutGrid, Menu, Package, Plus, Search, Settings2, Upload, X } from 'lucide-react';
import type { Asset, DesignPage, ExportRecord, Kit, KitInput, Product, ProductInput, Revision } from '../../../packages/contracts/domain.js';
import { pageIssues } from '../../../packages/contracts/domain.js';
import { layoutIssues } from '../../../packages/contracts/render.js';
import { api, json } from './api.js';
import { ProductForm } from './product-form.js';
import type { JobInfo } from '../../../packages/contracts/tasks.js';
import { ServiceSettings, type Connection } from './workspace.js';
import { BusinessOverview, BusinessRecords, MarketInsights, ProductProjects } from './business-ui.js';
import { PageLoading } from './components/states.js';
import { Modal } from './components/Modal.js';
import { LibraryView } from './library-view.js';
import { StudioView, type StudioTab } from './studio-view.js';
import { contentEntryLocation, formatNavigationHash, parseNavigationHash, type StudioOrigin, type View } from './navigation.js';
import type { WorkTarget } from '../../../packages/contracts/overview-work.js';
import './navigation.css';
import './workspace-reference.css';
import { ShellTools } from './components/shell-tools.js';
import type { OperationFeedback } from './feedback-events.js';
import { useWorkspaceScroll, rememberWorkspaceScroll } from './workspace-scroll.js';

const kitData = (k: Kit): KitInput => ({ name: k.name, productVersion: k.productVersion, pages: k.pages });
const primaryNavigation = [
  ['overview', LayoutGrid, '工作总览'], ['market', ClipboardList, '市场研究'], ['market', Layers3, '产品规划'],
  ['projects', Clock3, '产品项目'], ['studio', Layers3, '内容工坊'],
  ['products', Package, '产品资料库'],
] as const;
const secondaryNavigation = [
  ['deliveries', ArrowDownToLine, '渠道交付'],
  ['feedback', CheckCircle2, '经营反馈'],
] as const;
const viewLabels: Record<View, string> = {
  overview: '工作总览', market: '市场洞察', projects: '产品项目', studio: '内容工坊',
  products: '产品资料库', deliveries: '渠道交付', feedback: '经营反馈', connections: '设置与系统',
};

export function App() {
  const [marketWorkspaceTab]=useRoutedState<string>('marketTab','research',['research','opportunities','monitoring','learning','briefs']);
  const marketWorkspaceLabel=marketWorkspaceTab==='opportunities'||marketWorkspaceTab==='learning'||marketWorkspaceTab==='briefs'?'产品规划':'市场研究';
  const initialNavigation = useRef(parseNavigationHash(window.location.hash)).current;
  const [view, setView] = useState<View>(initialNavigation.view);
  const [products, setProducts] = useState<Product[]>([]), [productId, setProductId] = useState(initialNavigation.skuId ?? '');
  const [assets, setAssets] = useState<Asset[]>([]), [kits, setKits] = useState<Kit[]>([]);
  const [saved, setSaved] = useState<Kit | null>(null), [draft, setDraft] = useState<Kit | null>(null);
  const currentEditor = useRef({ draft, productId }); currentEditor.current = { draft, productId };
  const [snapshot, setSnapshot] = useState<Product | null>(null);
  const [pageId, setPageId] = useState(''), [kind, setKind] = useState<'main' | 'detail'>('main');
  const [studioWorkTarget,setStudioWorkTarget]=useState<WorkTarget>();
  const [studioTab,setStudioTab]=useRoutedState<StudioTab>('studioTab','production',['production','history']);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState('');
  const [toastTone,setToastTone]=useState<'success'|'error'>('success');
  useEffect(()=>{const receive=(event:Event)=>{const feedback=(event as CustomEvent<OperationFeedback>).detail;setToastTone(feedback.tone);setToast(feedback.message);};window.addEventListener('workspace-operation-feedback',receive);return()=>window.removeEventListener('workspace-operation-feedback',receive);},[]);
  const [productForm, setProductForm] = useState<'create' | 'edit' | null>(null), [newKit, setNewKit] = useState(false);
  const [kitName, setKitName] = useState(''), [detailCount, setDetailCount] = useState(12);
  const [records, setRecords] = useState<ExportRecord[]>([]), [revisions, setRevisions] = useState<Revision[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]), [checks, setChecks] = useState<string[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false), [uploadSource, setUploadSource] = useState(''), [rights, setRights] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [jobRefresh, setJobRefresh] = useState(0);
  const [marketFocusBatchId, setMarketFocusBatchId] = useState<string | null>(initialNavigation.batchId);
  const [marketFocusOpportunityId, setMarketFocusOpportunityId] = useState<string | null>(initialNavigation.opportunityId ?? null);
  const [marketFocusProjectId, setMarketFocusProjectId] = useState<string | null>(initialNavigation.researchProjectId);
  const [projectFocusId, setProjectFocusId] = useState<string | null>(initialNavigation.projectId);
  const [projectWorkAction, setProjectWorkAction] = useState<WorkTarget['projectAction']>();
  const [studioOrigin, setStudioOrigin] = useState<StudioOrigin>(initialNavigation.studioOrigin);
  const [studioFocusKitId, setStudioFocusKitId] = useState<string | null>(initialNavigation.kitId ?? null);
  const [studioFocusPageId, setStudioFocusPageId] = useState<string | null>(initialNavigation.pageId ?? null);
  const [, setSecondaryOpen] = useState(false);
  const [navOpen,setNavOpen]=useState(false);
  const [mobileNav,setMobileNav]=useState(()=>window.matchMedia('(max-width:1023px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width:1023px)');const update=()=>{setMobileNav(media.matches);setNavOpen(false);};media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  useEffect(()=>{setNavOpen(false);},[view]);
  useEffect(()=>{if(!navOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setNavOpen(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[navOpen]);
  const product = products.find(p => p.id === productId);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const page = draft?.pages.find(p => p.id === pageId) ?? draft?.pages[0];
  const pageProduct = snapshot ?? product;
  const selectedPages = draft?.pages.filter(p => p.kind === kind) ?? [];
  const approved = draft?.pages.filter(p => p.reviewed).length ?? 0;
  const outdated = !!product && !!draft && product.version !== draft.productVersion;
  const issues = page && pageProduct ? [...pageIssues(page, pageProduct, assets), ...layoutIssues(page)] : [];

  function acceptKit(kit: Kit | null) { setSaved(kit); setDraft(kit); setChecks(null); if (kit) { const next = kit.pages.find(p => p.id === studioFocusPageId) ?? kit.pages.find(p => p.id === pageId) ?? kit.pages[0]; if (next) { setPageId(next.id); setKind(next.kind); } } }
  function message(value: string) {setToastTone('success'); setToast(value); }
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成'); } finally { setBusy(false); } }
  useWorkspaceScroll(view);
  function canLeave() { return (!dirty || window.confirm('当前修改未保存，离开将丢弃这些修改。是否离开？')) && window.dispatchEvent(new Event('workspace-before-leave',{cancelable:true})); }
  async function loadProducts() { const list = await api<Product[]>('/products'); setProducts(list); setProductId(current => list.some(p => p.id === current) ? current : list[0]?.id ?? ''); }
  useEffect(() => { loadProducts().catch(e => setError(e.message)).finally(() => setLoading(false)); api<Connection[]>('/connections').then(setConnections).catch(e => setError(e.message)); }, []);
  useEffect(() => { if (!productId) return; let active = true; setLoading(true); Promise.all([api<Asset[]>(`/products/${productId}/assets`), api<Kit[]>(`/products/${productId}/kits`)]).then(([a, k]) => { if (!active) return; setAssets(a); setKits(k); acceptKit(k.find(item => item.id === studioFocusKitId) ?? k[0] ?? null); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [productId, studioFocusKitId]);
  useEffect(() => { if (!draft) { setSnapshot(null); return; } let active = true; api<Product>(`/products/${draft.productId}/versions/${draft.productVersion}`).then(p => { if (active) setSnapshot(p); }).catch(e => setError(e.message)); return () => { active = false; }; }, [draft?.productId, draft?.productVersion]);
  useEffect(() => {
    if (!draft || draft.id !== studioFocusKitId || !studioFocusPageId) return;
    const requested = draft.pages.find(item => item.id === studioFocusPageId);
    if (requested) { setPageId(requested.id); setKind(requested.kind); }
  }, [draft?.id, studioFocusKitId, studioFocusPageId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  useEffect(() => { if (!(view === 'studio' && studioTab === 'history')) return; api<ExportRecord[]>('/exports').then(setRecords).catch(e => setError(e.message)); if (saved) api<Revision[]>(`/kits/${saved.id}/revisions`).then(setRevisions).catch(e => setError(e.message)); }, [view, studioTab, saved?.version]);
  useEffect(() => {
    const hash = preserveWorkspaceUiHash(formatNavigationHash({ view, projectId: projectFocusId, batchId: marketFocusBatchId, opportunityId: marketFocusOpportunityId, researchProjectId: marketFocusProjectId, skuId: productId, kitId: draft?.id??studioFocusKitId, pageId: page?.id??studioFocusPageId, studioOrigin }),window.location.hash);
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }, [view, projectFocusId, marketFocusBatchId, marketFocusOpportunityId, marketFocusProjectId, productId, studioFocusKitId, studioFocusPageId, studioOrigin, draft?.id, page?.id]);
  useEffect(() => {
    const restoreLocation = () => {
      const next = parseNavigationHash(window.location.hash);
      if (next.view !== view && !canLeave()) {
        window.history.replaceState(null, '', formatNavigationHash({ view, projectId: projectFocusId, batchId: marketFocusBatchId, opportunityId: marketFocusOpportunityId, researchProjectId: marketFocusProjectId, skuId: productId, kitId: studioFocusKitId, pageId: studioFocusPageId, studioOrigin }));
        return;
      }
      if (next.view !== view && dirty) setDraft(saved);
      if (next.skuId) setProductId(next.skuId);
      if (next.view === 'projects') setProjectFocusId(next.projectId);
      if (next.view === 'market') { setMarketFocusBatchId(next.batchId); setMarketFocusProjectId(next.researchProjectId); }
      setMarketFocusOpportunityId(next.opportunityId ?? null);
      setStudioFocusKitId(next.kitId ?? null);
      setStudioFocusPageId(next.pageId ?? null);
      if (next.view === 'studio') { setStudioOrigin(next.studioOrigin); if (next.projectId) setProjectFocusId(next.projectId); }
      setSecondaryOpen(false);
      setView(next.view);
    };
    window.addEventListener('hashchange', restoreLocation);
    window.addEventListener('popstate', restoreLocation);
    return () => { window.removeEventListener('hashchange', restoreLocation); window.removeEventListener('popstate', restoreLocation); };
  }, [view, dirty, saved, projectFocusId, marketFocusBatchId, marketFocusOpportunityId, marketFocusProjectId, productId, studioFocusKitId, studioFocusPageId, studioOrigin]);

  function editPage(change: Partial<DesignPage>) { const changesCopy = ['headline','subtitle','body'].some(key => key in change); setDraft(k => k && ({ ...k, pages: k.pages.map(p => p.id === page?.id ? { ...p, ...change, ...(changesCopy ? { copyStatus: 'draft' as const } : {}), reviewed: false } : p) })); setChecks(null); }
  async function persist(kit = draft): Promise<Kit> {
    if (!kit) throw new Error('请先建立一套设计稿');
    const result = await api<Kit>(`/kits/${kit.id}`, json({ baseVersion: kit.version, data: kitData(kit) }, 'PUT'));
    acceptKit(result); setKits(list => list.map(k => k.id === result.id ? result : k)); return result;
  }
  async function reviewPage() {
    if (!page || !draft) return;
    if (outdated) throw new Error('请先同步最新商品资料');
    if (issues.length) { setChecks(issues); return; }
    const latest = dirty ? await persist() : draft;
    await persist({ ...latest, pages: latest.pages.map(p => p.id === page.id ? { ...p, reviewed: true } : p) });
    message('本页已审核，文案和素材修改后需要重新审核');
  }
  function navigate(next: View) { if (next === view || canLeave()) { rememberWorkspaceScroll(view);if (dirty && next !== view) setDraft(saved); if (next === 'studio') setStudioOrigin(null); setSecondaryOpen(false); setView(next); window.scrollTo(0,0); } }
  function openContent(skuId: string, origin: StudioOrigin, kitId?: string) {
    if (!canLeave()) return;
    setStudioWorkTarget(undefined);
    const location=contentEntryLocation(skuId,origin,projectFocusId,kitId);
    setProductId(skuId); setStudioFocusKitId(location.kitId??null); setStudioFocusPageId(null); setStudioOrigin(origin); setStudioTab('production'); setSecondaryOpen(false); setView('studio'); window.scrollTo(0,0);
  }
  function openWork(target: WorkTarget) {
    if (!canLeave()) return;
    setStudioWorkTarget(target.view === 'studio' ? target : undefined);
    if (target.view === 'market') { setMarketFocusBatchId(target.batchId ?? null); setMarketFocusOpportunityId(target.opportunityId ?? null); setMarketFocusProjectId(target.projectId ?? null); }
    if (target.view === 'projects') { setProjectFocusId(target.projectId ?? null); setProjectWorkAction(target.projectAction); }
    if (target.view === 'studio' && target.skuId) { setProductId(target.skuId); setStudioFocusKitId(target.kitId ?? null); setStudioFocusPageId(target.pageId ?? null); setProjectFocusId(target.projectId ?? null); setStudioOrigin(target.projectId ? 'project' : null); setStudioTab(target.tab === 'history' ? 'history' : 'production'); }
    setView(target.view); window.scrollTo(0, 0);
    if(target.view==='market'&&target.marketTab){const hash=formatNavigationHash({view:'market',batchId:target.batchId??null,opportunityId:target.opportunityId??null,projectId:target.projectId??null,researchProjectId:null,skuId:null,studioOrigin:null}),[path,query='']=hash.split('?'),params=new URLSearchParams(query);params.set('ui.marketTab',target.marketTab);if(target.monitoringRunId)params.set('ui.monitoringRun',target.monitoringRunId);window.history.replaceState(null,'',`${path}?${params}`);window.dispatchEvent(new Event('workspace-route-change'));}
  }
  async function saveProduct(data: ProductInput) {
    const result = productForm === 'edit' && product ? await api<Product>(`/products/${product.id}`, json({ baseVersion: product.version, data }, 'PUT')) : await api<Product>('/products', json(data));
    await loadProducts(); setProductId(result.id); setProductForm(null); message('商品资料已保存');
  }
  async function createKit() {
    if (!product) return;
    const result = await api<Kit>(`/products/${product.id}/kits`, json({ name: kitName || `${product.variant || product.name} · 商品图`, detailCount }));
    setKits(list => [result, ...list]); acceptKit(result); setKind('main'); setNewKit(false); setView('studio'); message('已建立页面结构，等待填写文案与审核');
  }
  async function upload(files: FileList | null) {
    if (!files || !product) return;
    for (const file of Array.from(files)) {
      const form = new FormData(); form.append('source', uploadSource); form.append('rights', rights ? 'confirmed' : ''); form.append('file', file);
      const added = await api<Asset>(`/products/${product.id}/assets`, { method: 'POST', body: form }); setAssets(a => [...a, added]);
    }
    setUploadOpen(false); message('素材已保存');
  }
  async function exportAll() {
    if (!draft) return;
    const latest = dirty ? await persist() : draft;
    const check = await api<{ issues: string[] }>(`/kits/${latest.id}/check`);
    setChecks(check.issues);
    if (check.issues.length) return;
    const storageKey = `export-submission:${latest.id}:${latest.version}`;
    const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    await api<JobInfo>(`/kits/${latest.id}/jobs`, { ...json({ kitVersion: latest.version, operation: 'export', pageIds: latest.pages.map(p => p.id) }), headers: { 'Idempotency-Key': key } });
    sessionStorage.removeItem(storageKey); setChecks(null); setJobRefresh(v => v + 1); setStudioTab('history'); setView('studio'); message('导出任务已提交，可离开页面；在任务进度中下载完成文件');
  }

  return <div className={`app-shell${navOpen?' nav-open':''}`}>
    {navOpen&&<button className="nav-scrim" aria-label="关闭导航菜单" onClick={()=>setNavOpen(false)}/>}
    <aside id="workspace-navigation" className="sidebar" inert={busy||(mobileNav&&!navOpen)}>
      
      <nav aria-label="主导航">
        <div className="workspace-label">业务路径</div>
        {primaryNavigation.map(([key, Icon, label]) => {const active=view===key&&(key!=='market'||marketWorkspaceLabel===label);return <button key={label} aria-label={label} aria-current={active?'page':undefined} title={label} className={active?'nav-item active':'nav-item'} onClick={() => {setSecondaryOpen(false);if(key==='market'){setMarketFocusOpportunityId(null);setMarketFocusProjectId(null);openWork({view:'market',marketTab:label==='产品规划'?'opportunities':'research'});}else navigate(key);}}><Icon size={19}/><span>{label}</span></button>;})}

      </nav>
      <div className="sidebar-settings"><button aria-label="设置与系统" title="设置与系统" className={view === 'connections' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('connections')}><Settings2 size={19}/><span>设置与系统</span></button></div>
    </aside>
    <div className="main-shell" inert={busy} aria-busy={busy}>
      <header className="topbar"><button className="mobile-nav-button icon-button" aria-label="打开导航菜单" aria-expanded={navOpen} aria-controls="workspace-navigation" onClick={()=>setNavOpen(value=>!value)}><Menu size={21}/></button><button className="shell-brand" onClick={()=>navigate('overview')}><span className="brand-mark"><LayoutGrid size={21}/></span><strong>电商产品工作台</strong></button><div className="breadcrumbs"><button onClick={() => navigate('overview')}>产品业务平台</button><ChevronRight size={14}/>{view === 'studio' && studioOrigin === 'project' && projectFocusId && <><button onClick={() => openWork({view:'projects',projectId:projectFocusId,projectAction:'content'})}>所属项目</button><ChevronRight size={14}/></>}{view === 'studio' && studioOrigin === 'products' && <><button onClick={() => navigate('products')}>产品资料库</button><ChevronRight size={14}/></>}{view === 'market' && marketFocusProjectId && <><button onClick={() => { setProjectFocusId(marketFocusProjectId); navigate('projects'); }}>产品项目</button><ChevronRight size={14}/></>}<button aria-current="page" onClick={()=>{if(view==='projects')setProjectFocusId(null);if(view==='market'){setMarketFocusBatchId(null);setMarketFocusOpportunityId(null);}navigate(view);}}>{view==='market'?marketWorkspaceLabel:viewLabels[view]}</button>{view==='products'&&product&&<><ChevronRight size={14}/><span title={product.name}>{product.name}</span></>}{view==='market'&&marketFocusBatchId&&<><ChevronRight size={14}/><span>{marketWorkspaceTab==='briefs'?'产品企划':marketWorkspaceTab==='learning'?'AI评估':marketWorkspaceLabel==='产品规划'?'市场机会':'研究结果'}</span></>}{view==='studio'&&page&&<><ChevronRight size={14}/><span>{page.templateId??page.purpose}</span></>}</div><ShellTools products={products} onWork={openWork} onSku={id=>{if(canLeave()){setProductId(id);navigate('products');}}}/></header>
      {error && <div className="error-banner" role="alert"><AlertCircle size={18}/><span>{error}</span><button onClick={()=>window.location.reload()}>重新加载页面</button><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={16}/></button></div>}
      {toast && <div className={`toast toast-${toastTone}`} role={toastTone==='error'?'alert':'status'}>{toastTone==='error'?<AlertCircle size={18}/>:<CheckCircle2 size={18}/>}<span>{toast}</span><button className="icon-button" aria-label="关闭操作提示" onClick={()=>setToast('')}><X size={16}/></button></div>}
      {loading ? <PageLoading>正在加载工作空间</PageLoading> : <>
      {view === 'overview' && <BusinessOverview onProjects={() => navigate('projects')} onMarket={() => { setMarketFocusProjectId(null); setMarketFocusBatchId(null); setMarketFocusOpportunityId(null); navigate('market'); }} onContent={(skuId,kitId) => openContent(skuId, null,kitId)} onWork={openWork}/>} 
      {view === 'projects' && <ProductProjects onWork={openWork} initialProjectId={projectFocusId} initialAction={projectWorkAction} onActionHandled={() => setProjectWorkAction(undefined)} onProjectSelected={setProjectFocusId} onContent={(skuId,kitId) => openContent(skuId, 'project',kitId)} onMarket={(batchId, initiatingProjectId, opportunityId) => { setMarketFocusBatchId(batchId ?? null); setMarketFocusProjectId(initiatingProjectId ?? null); setMarketFocusOpportunityId(opportunityId ?? null); navigate('market'); }}/>} 
      {view === 'deliveries' && <BusinessRecords kind="delivery" onProjects={()=>navigate('projects')}/>}
      {view === 'feedback' && <BusinessRecords kind="feedback" onProjects={()=>navigate('projects')}/>}
      {view === 'studio' && <><StudioView workTarget={studioWorkTarget} onWorkHandled={()=>setStudioWorkTarget(undefined)} tab={studioTab} products={products} productId={productId} product={product} assets={assets} kits={kits} draft={draft} saved={saved} page={page} pageProduct={pageProduct} selectedPages={selectedPages} kind={kind} approved={approved} dirty={dirty} busy={busy} outdated={outdated} issues={issues} connections={connections} records={records} revisions={revisions} jobRefresh={jobRefresh}
        onTab={setStudioTab} onCreate={() => { if (canLeave()) { setKitName(''); setNewKit(true); } }} onCreateProduct={() => setProductForm('create')} onProduct={id => openContent(id,null)} onProducts={() => navigate('products')} onProject={id=>openWork({view:'projects',projectId:id,projectAction:'content'})} onCreateKit={() => setNewKit(true)} onKit={kit => { if (canLeave()) { setStudioFocusKitId(kit.id); setStudioFocusPageId(null); acceptKit(kit); setKind('main'); } }} onKind={setKind} onPage={id=>{setStudioFocusPageId(id);setPageId(id);}}
        onSave={() => run(async () => { await persist(); message('新版本已保存'); })} onExport={() => run(exportAll)} onSync={() => setDraft(current => current && ({ ...current, productVersion: product!.version, pages: current.pages.map(item => ({ ...item, reviewed: false, claimIds: item.claimIds.filter(id => product!.claims.some(claim => claim.id === id)) })) }))} onEdit={editPage}
        onAdopted={(updated, source, type) => { setKits(list => list.map(item => item.id === updated.id && item.version < updated.version ? updated : item)); if (currentEditor.current.productId === updated.productId && currentEditor.current.draft === source) acceptKit(updated); else message(`${type === 'copy' ? '候选' : '视觉候选'}已保存为新版本，当前编辑内容已保留。重新打开该设计稿可查看。`); }} onReview={() => run(reviewPage)}
        onRestore={revision => run(async () => { if (!saved) return; const restored = await api<Kit>(`/kits/${saved.id}/restore`, json({ version: revision.version, baseVersion: saved.version })); acceptKit(restored); setKits(list => list.map(item => item.id === restored.id ? restored : item)); message('已恢复为新版本，页面需要重新审核'); })} onJobsSettled={() => { api<ExportRecord[]>('/exports').then(setRecords).catch(error => setError(error.message)); }}/></>} 
      {view === 'products' && <LibraryView onSaved={()=>{void loadProducts().catch(e=>setError(e.message));}} products={products} product={product} assets={assets} onSelectSku={setProductId} onCreate={() => setProductForm('create')} onEdit={() => setProductForm('edit')} onUpload={() => { setRights(false); setUploadSource(''); setUploadOpen(true); }} onStudio={() => { if (product) openContent(product.id, 'products'); }}/>} 
      {view === 'connections' && <><ServiceSettings connections={connections}/><details className="system-record-links"><summary>交付与经营记录</summary>{secondaryNavigation.map(([key,Icon,label])=><button key={key} onClick={()=>navigate(key)}><Icon size={17}/>{label}<ArrowRight size={14}/></button>)}</details></>}
      {view === 'market' && <MarketInsights initialBatchId={marketFocusBatchId} initialOpportunityId={marketFocusOpportunityId} initialResearchProjectId={marketFocusProjectId} onBatchSelected={setMarketFocusBatchId} onProject={id => { setProjectFocusId(id); navigate('projects'); }}/>} 
      </>}
    </div>
    {productForm && <ProductForm key={`${productForm}-${product?.id}`} product={productForm === 'edit' ? product : undefined} busy={busy} onClose={() => setProductForm(null)} onSave={data => run(() => saveProduct(data))}/>}
    {newKit && <Modal compact eyebrow="NEW CONTENT SET" title="编排一套商品图" onClose={() => setNewKit(false)} footer={<button className="primary" disabled={busy || detailCount < 11 || detailCount > 20 || !Number.isInteger(detailCount)} onClick={() => run(createKit)}>建立 {5 + detailCount} 页结构<ArrowRight size={16}/></button>}><label>设计稿名称<input value={kitName} maxLength={80} onChange={e => setKitName(e.target.value)} placeholder={`${product?.variant || '商品'} · 商品图`}/></label><div className="set-counts"><div><strong>05</strong><span>张主图 · 固定</span></div><div><input aria-label="详情图数量" type="number" min={11} max={20} value={detailCount} onChange={e => setDetailCount(Number(e.target.value))}/><span>张详情图 · 11–20 张</span></div></div><p className="muted small">建立每页用途和编辑空间。广告文案和 AI 背景尚未生成，需要逐页完善。</p></Modal>}
    {uploadOpen && <Modal compact title="上传商品素材" onClose={() => setUploadOpen(false)} footer={<button className="primary" disabled={busy || !rights || !uploadSource.trim()} onClick={() => fileInput.current?.click()}><Upload size={16}/>选择并上传图片</button>}><label>素材来源<input maxLength={160} value={uploadSource} onChange={e => setUploadSource(e.target.value)} placeholder="例如：企业美工提供的白底渲染图"/></label><label className="checkbox-line"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)}/>确认有权将这些素材用于本次制作</label><p className="muted small">支持静态 JPG / PNG / WebP，单张不超过 15 MB、1600 万像素。</p><input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden ref={fileInput} onChange={e => run(() => upload(e.target.files))}/></Modal>}
    {checks && <Modal compact className="checks-modal" eyebrow="DELIVERY CHECK" title={checks.length ? '交付前，再完善这些内容' : '检查通过'} onClose={() => setChecks(null)} footer={<button className="primary" onClick={() => setChecks(null)}>返回编辑</button>}><p className="muted small">检查文字空间、素材归属、商品版本与逐页审核状态。</p><div className="check-list">{checks.map((issue, i) => <div key={i}><AlertCircle size={16}/><span>{issue}</span></div>)}{!checks.length && <p><CheckCircle2 size={18}/>所有页面已完成审核。</p>}</div></Modal>}
  </div>;
}
