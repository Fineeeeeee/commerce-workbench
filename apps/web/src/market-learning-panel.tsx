import { Select } from './components/Select.js';
import { useEffect,useState } from 'react';
import { api,json } from './api.js';
import { InlineError } from './components/states.js';
import type { Category } from '../../../packages/contracts/business.js';
import { reviewReasonLabels,type OpportunityReviewMetrics,type HistoryRetrieval } from '../../../packages/contracts/market-learning.js';
import { useRoutedState } from './workspace-route.js';
import './market-learning.css';
import { batchDisplayName,opportunityDisplayTitle } from './display-text.js';

export function MarketLearningPanel({categories,batchId,onOpportunity}:{categories:Category[];batchId:string;onOpportunity:(batchId:string,id:string)=>void}){
  const [tab,setTab]=useRoutedState<'reviews'|'memory'>('learningTab','reviews',['reviews','memory']);
  const [categoryId,setCategoryId]=useRoutedState<string>('learningCategory','');
  const [metrics,setMetrics]=useState<OpportunityReviewMetrics|null>(null),[memory,setMemory]=useState<{model:string;dimension:number;eligible:number;indexed:number}|null>(null),[hits,setHits]=useState<HistoryRetrieval|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
  const load=async()=>{const [m,s]=await Promise.all([api<OpportunityReviewMetrics>(`/market-learning/reviews${categoryId?`?categoryId=${encodeURIComponent(categoryId)}`:''}`),api<{model:string;dimension:number;eligible:number;indexed:number}>('/market-learning/memory')]);setMetrics(m);setMemory(s);};
  useEffect(()=>{setMetrics(null);setHits(null);void load().catch(e=>setError(e.message));},[categoryId,revision]);
  const action=async(kind:'index'|'search')=>{setBusy(true);setError('');setNotice('');try{if(kind==='index'){const result=await api<{indexed:number;remaining:number}>('/market-learning/memory/index',json({categoryId}));setNotice(`已建立 ${result.indexed} 条摘要索引${result.remaining?`，还有 ${result.remaining} 条待处理`:''}`);await load();}else setHits(await api<HistoryRetrieval>('/market-learning/memory/search',json({categoryId,batchId})));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <section className="market-learning-panel card"><header><h2>AI 机会评估与历史参考</h2><label>品类<Select aria-label="评估品类" value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">全部品类</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label></header>
    <div className="workspace-reference-tabs" role="tablist" aria-label="机会评估视图">{([['reviews','人工审核统计'],['memory','历史语义检索']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {error&&<InlineError onRetry={()=>{setError('');setRevision(v=>v+1);}}>{error}</InlineError>}{notice&&<p role="status">{notice}</p>}
    {tab==='reviews'&&metrics&&<><p className="learning-conclusion">已审核 {metrics.reviewed}/{metrics.total} 个 AI 候选，采纳 {metrics.approved} 个，驳回 {metrics.rejected} 个。{metrics.pending} 个仍待审核。</p><p className="muted small">采纳率表示人工采用情况，不是准确率或业务效果。各模型来自不同批次与 Prompt，不能据此评出优劣。</p>
      <div className="learning-table-wrap"><table><thead><tr><th>机会推断模型 / Prompt</th><th>品类</th><th>已审核 / 候选</th><th>采纳 / 驳回</th><th>已审核采纳率</th></tr></thead><tbody>{metrics.models.map((m,i)=><tr key={i}><td>{m.modelVersion||m.model}<small>{m.promptVersion}</small></td><td>{categories.find(c=>c.id===m.categoryId)?.name??'品类未记录'}</td><td>{m.reviewed} / {m.total}</td><td>{m.approved} / {m.rejected}</td><td>{m.adoptionRate===null?'尚无审核':`${Math.round(m.adoptionRate*100)}%（${m.approved}/${m.reviewed}）`}</td></tr>)}</tbody></table></div>
      <details><summary>驳回原因 · {metrics.rejected} 个候选</summary>{metrics.reasons.filter(r=>r.count).map(r=><p key={r.code}>{r.code==='UNCLASSIFIED'?'未分类（保留原审核说明）':reviewReasonLabels[r.code as keyof typeof reviewReasonLabels]}：{r.count}</p>)}<small>一个候选可有多个原因；业务不采用不等于 AI 判断错误。</small>{metrics.rows.filter(r=>r.decision==='REJECTED').map(r=><article key={r.id}><strong>{opportunityDisplayTitle(r.title)}</strong><p>{r.note}</p><button onClick={()=>onOpportunity(r.batchId,r.id)}>查看机会与依据</button></article>)}</details>
    </>}
    {tab==='memory'&&<><p>只检索已审核的同品类机会与证据摘要，包含通过和驳回案例。</p><div className="learning-memory-actions"><button disabled={busy||!categoryId} onClick={()=>void action('index')}>{busy?'处理中…':'建立本品类历史索引'}</button><button disabled={busy||!categoryId||!batchId} onClick={()=>void action('search')}>检索当前批次的历史参考</button></div><small className="muted">{!categoryId && '请选择品类。'}建立索引或检索会调用向量模型；每次索引最多 10 条。新研究自动使用已建索引，不修改已保存的分析。</small>
      {memory&&<p className="small">已审核且有品类的机会 {memory.eligible} 条 · 已保存向量记录 {memory.indexed} 条</p>}
      {hits&&<div>{hits.status==='NO_INDEX'?<p>没有与当前批次匹配的有效历史索引，请先建立对应品类索引。</p>:hits.status==='NO_MATCH'?<p>本次没有达到相似度阈值的历史参考。</p>:hits.hits.map(hit=><article key={hit.memoryId}><strong>{opportunityDisplayTitle(hit.reference.title)}</strong><p>{hit.reference.decision==='APPROVED'?'历史审核通过':'历史审核驳回'} · {hit.reference.reviewNote}</p><small>{batchDisplayName(hit.reference.batchName)} · 相似度 {hit.score.toFixed(3)}（不是置信度）</small><button onClick={()=>onOpportunity(hit.reference.batchId,hit.reference.opportunityId)}>查看历史依据</button></article>)}</div>}
    </>}
  </section>;
}
