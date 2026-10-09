import { elapsedLabel } from '../../../../packages/contracts/task-presentation.js';
import { useRoutedState } from '../workspace-route.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ListTodo, Search } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from './Modal.js';
import type { Product } from '../../../../packages/contracts/domain.js';
import type { ProductProject } from '../../../../packages/contracts/business.js';
import type { WorkTarget } from '../../../../packages/contracts/overview-work.js';
import type { WorkQueueResponse } from '../work-queue-view.js';
import type { ProductOpportunity } from '../../../../packages/contracts/market-opportunity.js';
import { batchDisplayName, opportunityDisplayTitle } from '../display-text.js';
import { JobPanel } from '../jobs.js';
import { BlockSkeleton, EmptyState, InlineError } from './states.js';

export function ShellTools({ products, onWork, onSku }: { products: Product[]; onWork: (target: WorkTarget) => void; onSku: (id: string) => void }) {
  const [panel, setPanel] = useRoutedState<'search' | 'tasks' | null>('shellDrawer',null,['search','tasks']);
  const [query, setQuery] = useState(''), [projects, setProjects] = useState<ProductProject[]>([]);
  const [queue, setQueue] = useState<WorkQueueResponse | null>(null), [error, setError] = useState('');
  const [opportunities,setOpportunities]=useState<ProductOpportunity[]>([]);
  const [loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const searchRef=useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPanel('search'); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!panel) return;
    let active = true,inFlight=false;
    const controller=new AbortController();setLoading(true);
    const load = async () => { if(inFlight)return;inFlight=true;try { const [nextProjects, nextQueue, nextOpportunities] = await Promise.all([api<ProductProject[]>('/product-projects',{signal:controller.signal}), api<WorkQueueResponse>('/work-queue',{signal:controller.signal}),api<ProductOpportunity[]>('/product-opportunities',{signal:controller.signal})]); if (active) { setProjects(nextProjects); setQueue(nextQueue); setOpportunities(nextOpportunities); setError(''); } } catch (value) { if (active) setError(value instanceof Error ? value.message : '加载失败'); }finally{inFlight=false;if(active)setLoading(false);} };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { active = false;controller.abort(); clearInterval(timer); };
  }, [panel,refresh]);
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const open = (target: WorkTarget) => { setPanel(null); onWork(target); };
  return <div className="shell-tools">
    <button aria-label="搜索项目、商品与待办" className="shell-lookup" onClick={() => setPanel('search')}><Search size={17}/><span>搜索项目、商品与待办</span><kbd>Ctrl K</kbd></button>
    <button className="shell-task-button" aria-label="查看后台任务" onClick={() => setPanel('tasks')}><ListTodo size={19}/><span>后台任务</span></button>
    {panel && <Modal className={panel === 'tasks' ? 'workspace-drawer' : 'command-panel'} title={panel === 'search' ? '查找工作对象' : '后台任务'} onClose={() => setPanel(null)}>
      {error && <InlineError onRetry={()=>setRefresh(value=>value+1)}>{error}</InlineError>}
      {loading&&<BlockSkeleton/>}
      {panel === 'search' ? <><input data-initial-focus aria-label="搜索项目、商品与待办" placeholder="输入名称或关键词" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'||event.key==='ArrowDown'){event.preventDefault();const first=searchRef.current?.querySelector<HTMLButtonElement>('button');if(event.key==='Enter')first?.click();else first?.focus();}}}/><div ref={searchRef} className="command-results" onKeyDown={event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}>
        <h3>产品项目</h3>{projects.filter(item => matches(item.name)).slice(0,8).map(item => <button key={item.id} onClick={() => open({view:'projects',projectId:item.id})}><span>{item.name}<small>产品项目</small></span><ArrowRight size={15}/></button>)}
        <h3>商品 / SKU</h3>{products.filter(item => matches(`${item.name} ${item.variant}`)).slice(0,8).map(item => <button key={item.id} onClick={() => { setPanel(null); onSku(item.id); }}><span>{item.name}<small>{item.specification}</small></span><ArrowRight size={15}/></button>)}
        <h3>当前待办</h3>{queue?.attention.filter(item => item.kind!=='opportunity'&&matches(`${item.title} ${item.context}`)).slice(0,8).map(item => <button key={item.id} onClick={() => open(item.target)}><span>{item.title}<small>{item.context}</small></span><ArrowRight size={15}/></button>)}
        <h3>市场机会</h3>{opportunities.filter(item=>matches(item.title)).slice(0,8).map(item=><button key={item.id} onClick={()=>open({view:'market',batchId:item.analysis.batch.id,opportunityId:item.id})}><span>{opportunityDisplayTitle(item.title)}<small>{batchDisplayName(item.analysis.batch.name)}</small></span><ArrowRight size={15}/></button>)}
      {!loading&&!error&&!projects.some(item=>matches(item.name))&&!products.some(item=>matches(`${item.name} ${item.variant}`))&&!queue?.attention.some(item=>matches(`${item.title} ${item.context}`))&&!opportunities.some(item=>matches(item.title))&&<EmptyState title="没有找到匹配对象" desc="尝试商品名、项目名或待办关键词。"/>}</div></> : <><div className="command-results"><h3>研究与监控进度</h3>{queue?.running.filter(item=>item.target.view!=='studio').map(item => <button key={item.id} onClick={() => open(item.target)}><span>{item.title}<small>{item.status} · {item.context}{item.createdAt?` · 已用时 ${elapsedLabel(item.createdAt,new Date().toISOString())}`:''}</small></span><ArrowRight size={15}/></button>)}{queue?.attention.filter(item => item.status === '失败').map(item => <button key={item.id} onClick={() => open(item.target)}><span>{item.title}<small>{item.reason}</small></span><ArrowRight size={15}/></button>)}</div><JobPanel refresh={refresh}/></>}
    </Modal>}
  </div>;
}
