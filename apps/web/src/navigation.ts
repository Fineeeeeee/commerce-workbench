export type View = 'overview' | 'market' | 'projects' | 'products' | 'studio' | 'deliveries' | 'feedback' | 'connections';
export type StudioOrigin = 'project' | 'products' | null;
export type NavigationLocation = {
  view: View;
  projectId: string | null;
  batchId: string | null;
  researchProjectId: string | null;
  skuId: string | null;
  kitId?: string | null;
  pageId?: string | null;
  opportunityId?: string | null;
  studioOrigin: StudioOrigin;
};

const views = new Set<View>(['overview', 'market', 'projects', 'products', 'studio', 'deliveries', 'feedback', 'connections']);
const identity = (value: string | null) => value && /^[a-zA-Z0-9-]{1,120}$/.test(value) ? value : null;

export function contentEntryLocation(skuId: string, origin: StudioOrigin, projectId: string | null, kitId?: string): NavigationLocation {
  return { view:'studio', skuId, studioOrigin:origin, projectId:origin==='project'?projectId:null, kitId:kitId??null, pageId:null, batchId:null, researchProjectId:null, opportunityId:null };
}

export function parseNavigationHash(hash: string): NavigationLocation {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const view = views.has(path as View) ? path as View : 'overview';
  const params = new URLSearchParams(query);
  const projectId = identity(params.get('project'));
  const studioOrigin = view === 'studio' && params.get('from') === 'project' && projectId ? 'project'
    : view === 'studio' && params.get('from') === 'products' ? 'products' : null;
  return {
    view,
    projectId: view === 'projects' || studioOrigin === 'project' ? projectId : null,
    batchId: view === 'market' ? identity(params.get('batch')) : null,
    researchProjectId: view === 'market' ? projectId : null,
    skuId: view === 'studio' || view === 'products' ? identity(params.get('sku')) : null,
    kitId: view === 'studio' ? identity(params.get('kit')) : null,
    pageId: view === 'studio' ? identity(params.get('page')) : null,
    opportunityId: view === 'market' ? identity(params.get('opportunity')) : null,
    studioOrigin,
  };
}

export function formatNavigationHash(location: NavigationLocation): string {
  const params = new URLSearchParams();
  if (location.view === 'projects' && location.projectId) params.set('project', location.projectId);
  if (location.view === 'market') {
    if (location.batchId) params.set('batch', location.batchId);
    if (location.researchProjectId) params.set('project', location.researchProjectId);
    if (location.opportunityId) params.set('opportunity', location.opportunityId);
  }
  if (location.view === 'studio' || location.view === 'products') {
    if (location.skuId) params.set('sku', location.skuId);
    if (location.view === 'studio' && location.kitId) params.set('kit', location.kitId);
    if (location.view === 'studio' && location.pageId) params.set('page', location.pageId);
    if (location.view === 'studio' && location.studioOrigin) params.set('from', location.studioOrigin);
    if (location.view === 'studio' && location.studioOrigin === 'project' && location.projectId) params.set('project', location.projectId);
  }
  const query = params.toString();
  return `#/${location.view}${query ? `?${query}` : ''}`;
}
