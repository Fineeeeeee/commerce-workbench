import { HelpHint } from './components/help-hint.js';
import { useRoutedState } from './workspace-route.js';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Batch, Entry, MarketAnalysis } from '../../../packages/contracts/market.js';
import type { OpportunityPreview, ProductOpportunity } from '../../../packages/contracts/market-opportunity.js';
import type { ProductProject, Category } from '../../../packages/contracts/business.js';
import { currentMarketOpportunityPromptVersion } from '../../../packages/contracts/market-ai.js';
import { StatusBadge } from './components/StatusBadge.js';
import { batchDisplayName, marketSourceLabel } from './display-text.js';
import { opportunityDisplayTitle } from './display-text.js';
import { OpportunityProjectActions } from './opportunity-project-actions.js';
import { opportunityEvidence } from '../../../packages/contracts/evidence-decision.js';
import { KeywordIntelligencePanel } from './keyword-intelligence-panel.js';
import { TraceContent } from './components/trace-drawer.js';
import { Modal } from './components/Modal.js';
import './market-insights.css';

type Props = {
  batch?: Batch; overview: OpportunityPreview | null; entries: Array<Entry & { analysis: MarketAnalysis }>;
  opportunities: ProductOpportunity[]; projects: ProductProject[]; categories: Category[]; originProject?: ProductProject; projectChoice: Record<string,string>;
  setProjectChoice: Dispatch<SetStateAction<Record<string,string>>>; selectedEntryIds: string[]; setSelectedEntryIds: Dispatch<SetStateAction<string[]>>;
  busy: boolean; onAnalyze: () => void; onAttach: (id: string) => void; onInclude: (id: string) => void; onCreate: (item: ProductOpportunity) => void; onProject: (id: string) => void; onOpen: (entry: Entry & { analysis: MarketAnalysis }) => void; onReview: (item: ProductOpportunity) => void;
  monitoringActive?:boolean;
  onOpportunities?:()=>void;
  onResearch?:()=>void;
  focusedOpportunityId?:string;
};

const meaningful = (value: string) => value.trim().length >= 2 && /[\p{L}\p{N}]/u.test(value);
export function MarketInsights(props: Props) {
  const { batch,overview,entries,opportunities,projects,categories,originProject,projectChoice,setProjectChoice,selectedEntryIds,setSelectedEntryIds,busy,onAnalyze,onAttach,onInclude,onCreate,onProject,onOpen,onReview,monitoringActive } = props;
  const [showAllEvidence,setShowAllEvidence]=useRoutedState<boolean>('allEvidence',false);
  const [evidenceOpen,setEvidenceOpen]=useRoutedState<boolean>('evidenceOpen',false);
  const [evidenceOpportunityId,setEvidenceOpportunityId]=useRoutedState<string|null>('evidenceOpportunity',null);
  const [evidenceMode,setEvidenceMode]=useRoutedState<'representative'|'all'>('evidenceMode','representative',['representative','all']);
  const evidenceFocus=evidenceOpportunityId?{opportunityId:evidenceOpportunityId,mode:evidenceMode}:null;
  function setEvidenceFocus(value:{opportunityId:string;mode:'representative'|'all'}|null){setEvidenceOpportunityId(value?.opportunityId??null);if(value)setEvidenceMode(value.mode);}
  const [expandedOpportunityId,setExpandedOpportunityId]=useRoutedState<string|null>('opportunityDrawer',null);
  const [detailTab,setDetailTab]=useRoutedState<'overview'|'evidence'|'products'|'risks'|'trace'>('opportunityTab','overview',['overview','evidence','products','risks','trace']);
  const [statsTab,setStatsTab]=useRoutedState<'overview'|'price'|'brands'|'keywords'|'selling'|'quality'>('marketStats','overview',['overview','price','brands','keywords','selling','quality']);
  const [findingKey,setFindingKey]=useRoutedState<string|null>('finding',null);
  const openedFocus=useRef('');
  const previousBatch=useRef(batch?.id);
  useEffect(()=>{if(previousBatch.current&&previousBatch.current!==batch?.id){setEvidenceOpen(false);setEvidenceFocus(null);setShowAllEvidence(false);setExpandedOpportunityId(null);}previousBatch.current=batch?.id;},[batch?.id]);
  useEffect(()=>{const item=opportunities.find(value=>value.id===props.focusedOpportunityId&&value.analysis.batch.id===batch?.id);if(item&&item.status!=='DRAFT'&&openedFocus.current!==item.id){openedFocus.current=item.id;setExpandedOpportunityId(item.id);setDetailTab('overview');}},[props.focusedOpportunityId,batch?.id,opportunities]);
  if (!batch || !overview) return null;
  const batchOpportunities=opportunities.filter(item=>item.analysis.batch.id===batch.id);
  const pendingReviews=batchOpportunities.filter(item=>item.status==='DRAFT').length;
  const focusedOpportunity=batchOpportunities.find(item=>item.id===evidenceFocus?.opportunityId);
  const focusedEvidence=focusedOpportunity?opportunityEvidence(focusedOpportunity,entries):null;
  const representativeIds=focusedEvidence?.representativeIds??new Set<string>();
  const visibleEntries=focusedEvidence ? evidenceFocus?.mode==='representative' ? focusedEvidence.highlightedEntries : focusedEvidence.analysisEntries : entries;
  const displayedEntries=showAllEvidence||evidenceFocus?visibleEntries:visibleEntries.slice(0,20);
  const latestAi=batchOpportunities.find(item=>item.analysis.ai)?.analysis.ai;
  const findingMatch=/^(fact|ai)-(\d+)$/.exec(findingKey??'');
  const findingIds=findingMatch ? findingMatch[1]==='fact' ? overview.stats.sellingPoints[Number(findingMatch[2])]?.sourceEntryIds??null : latestAi?.inferences[Number(findingMatch[2])]?.evidence_record_ids??null : null;
  function setFindingIds(ids:string[]|null) {
    if(!ids){setFindingKey(null);return;}
    const factIndex=overview!.stats.sellingPoints.findIndex(item=>item.sourceEntryIds===ids);
    const aiIndex=latestAi?.inferences.findIndex(item=>item.evidence_record_ids===ids)??-1;
    setFindingKey(factIndex>=0?`fact-${factIndex}`:aiIndex>=0?`ai-${aiIndex}`:null);
  }
  function openEvidence(opportunityId:string,mode:'representative'|'all') {setEvidenceFocus({opportunityId,mode});setEvidenceOpen(true);document.getElementById('market-evidence')?.scrollIntoView({behavior:'smooth'});}
  return <div className="market-insights">
    {!monitoringActive&&<section className="market-insight-section batch-overview">
      <div className="section-heading"><h2>样本概况 <HelpHint label="来源与样本范围">{marketSourceLabel(batch.platform,batch.source)} · {overview.stats.selectedCount} 条样本。仅代表本批次，AI 判断需人工审核。</HelpHint></h2><small>{batch.platform} · {batch.periodStart} 至 {batch.periodEnd}</small></div>

      <div className="insight-metrics"><div><strong>{overview.stats.includedCount}</strong><span>有效样本</span></div><div><strong>{overview.stats.price ? `¥${overview.stats.price.median}` : '—'}</strong><span>样本价格中位数 <HelpHint label="价格统计口径">{batch.platform==='京东'?'优先使用接口返回的券后价或最低价，券有效性未核实；不同于市场监控的商品标价。':'按当前有效样本的记录价格计算中位数。'}</HelpHint></span></div><div><strong>{overview.stats.brands.length}</strong><span>品牌数</span></div><div><strong>{overview.stats.shops.length || '—'}</strong><span>店铺数</span></div></div>
      <div className="batch-next-action"><strong>{pendingReviews ? `${pendingReviews} 个机会候选等待人工审核` : selectedEntryIds.length ? `已选择 ${selectedEntryIds.length} 条证据` : '查看商品记录，形成机会判断'}</strong><button className="text-button" onClick={()=>{if(pendingReviews){props.onOpportunities?.();}else{setEvidenceOpen(true);document.getElementById('market-evidence')?.scrollIntoView({behavior:'smooth',block:'start'});}}}>{pendingReviews?'查看机会 →':'查看商品记录 →'}</button></div>
    </section>}
    {!monitoringActive&&<section className="market-statistics-workspace"><div className="workspace-reference-tabs" role="tablist" aria-label="样本统计">{([['overview','概览'],['price','价格'],['brands','品牌店铺'],['keywords','关键词'],['selling','卖点'],['quality','样本质量']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={statsTab===key} className={statsTab===key?'active':''} onClick={()=>setStatsTab(key)}>{label}</button>)}</div>
    {statsTab==='overview'&&<div className="market-core-findings"><h3>核心发现</h3><ol>{overview.stats.sellingPoints.slice(0,2).map(item=><li key={item.term}><span className="decision-label fact">程序事实</span><div><strong>“{item.term}”出现在 {item.count} 条样本中</strong></div><button onClick={()=>setFindingIds(item.sourceEntryIds)}>来源 ({item.sourceEntryIds.length})</button></li>)}{latestAi?.inferences.slice(0,2).map((item,index)=><li key={`ai-${index}`}><span className="decision-label inference">AI 推断</span><div><p>{item.text}</p></div><button onClick={()=>setFindingIds(item.evidence_record_ids)}>来源 ({item.evidence_record_ids.length})</button></li>)}{!overview.stats.sellingPoints.length&&!latestAi?.inferences.length&&<li>当前未形成可展示的核心发现。</li>}</ol></div>}
    {statsTab==='price'&&<div className="market-distribution-grid"><section className="market-chart"><div className="section-heading"><h3>价格带分布</h3><span className="decision-label fact">程序事实</span></div><div className="market-bars">{overview.stats.priceBands.map(item=><div className="market-bar-row" key={item.label}><span>{item.label}</span><div className="market-bar-track"><i style={{width:`${item.count/Math.max(1,...overview.stats.priceBands.map(value=>value.count))*100}%`}}/></div><strong>{item.count} 条</strong></div>)}</div></section><section className="market-chart"><div className="section-heading"><h3>规格分布</h3><span className="decision-label fact">程序事实</span></div>{overview.stats.specifications.slice(0,8).map(item=><p key={item.value}>{item.value} · {item.count} 条</p>)}</section></div>}
    {statsTab==='brands'&&<div className="analysis-grid"><article><h3>品牌</h3>{overview.stats.brands.map(item=><p key={item.value}><span>{item.value}</span><strong>{item.count} 条</strong></p>)}</article><article><h3>店铺</h3>{overview.stats.shops.map(item=><p key={item.value}><span>{item.value}</span><strong>{item.count} 条</strong></p>)}</article></div>}
    {statsTab==='keywords'&&<KeywordIntelligencePanel batchId={batch.id}/>}
    {statsTab==='selling'&&<div className="analysis-grid"><article><h3>卖点覆盖</h3>{overview.stats.sellingPoints.map(item=><p key={item.term}><span>{item.term}</span><button onClick={()=>setFindingIds(item.sourceEntryIds)}>{item.count} 条 · 查看来源</button></p>)}</article><article><h3>卖点组合</h3>{overview.stats.sellingPointCombinations.map(item=><p key={item.terms.join('+')}><span>{item.terms.join(' + ')}</span><strong>{item.count} 条</strong></p>)}</article></div>}
    {statsTab==='quality'&&<div className="analysis-grid"><article><h3>字段缺失率</h3>{overview.stats.missingRates.map(item=><p key={item.field}><span>{item.field}</span><strong>{item.missing}/{item.total} · {Math.round(item.rate*100)}%</strong></p>)}</article><article><h3>样本范围</h3><p>纳入 {overview.stats.includedCount} 条 · 排除 {overview.stats.excludedCount} 条</p><p>本批次统计仅描述已保存样本。</p></article></div>}
    </section>}
    {findingIds&&<Modal className="workspace-drawer" title="核心发现的来源商品" onClose={()=>setFindingIds(null)}>{entries.filter(entry=>findingIds.includes(entry.id)).map(entry=><div className="representative-row" key={entry.id}><span>{entry.data.title}<small>{entry.data.brand||'品牌缺失'} · {entry.data.price===null?'价格缺失':`¥${entry.data.price}`}</small></span><button onClick={()=>{setFindingIds(null);onOpen(entry);}}>查看来源</button></div>)}{!entries.some(entry=>findingIds.includes(entry.id))&&<p className="muted">当前批次未找到这些引用记录，请查看原分析追溯信息。</p>}</Modal>}
    <section className="market-insight-section opportunity-candidates" id="market-opportunity-candidates">
      <div className="section-heading"><div><span className="eyebrow">机会候选</span><h2>需要判断的机会</h2></div>{selectedEntryIds.length>0&&<button className="primary" disabled={busy} onClick={onAnalyze}>分析所选 {selectedEntryIds.length} 条商品</button>}</div>
      {!batchOpportunities.length&&!selectedEntryIds.length&&<button className="market-select-evidence" onClick={()=>{setEvidenceOpen(true);document.getElementById('market-evidence')?.scrollIntoView({behavior:'smooth'});}}>选择商品记录，形成机会候选</button>}
      <div className="opportunity-grid">{batchOpportunities.map(item=>{ const decision=opportunityEvidence(item,entries); const candidate=decision.candidate; const highlighted=decision.highlightedEntries; const risks=candidate?.risks.map(value=>value.text)??item.analysis.risks; const missing=(candidate?.missing_data??item.analysis.missingEvidence).filter(meaningful); return <article id={`opportunity-${item.id}`} className="card opportunity-card evidence-decision" key={item.id}>
        <div className="decision-head"><StatusBadge domain="opportunity" status={item.status}/><small>{categories.find(value=>value.id===item.categoryId)?.name ?? '品类待确认'} · {highlighted.length} 条{candidate?'代表证据':'关联商品'}</small></div>
        <h3>{opportunityDisplayTitle(item.title)}</h3><p className="decision-judgment"><span className="decision-label inference">{candidate?'AI判断':'机会判断'}</span>{item.summary}</p>
        <button className="opportunity-detail-trigger text-button" onClick={()=>{setDetailTab('overview');setExpandedOpportunityId(item.id);}}>查看判断依据与风险 →</button>
        {expandedOpportunityId===item.id&&<Modal className="market-modal workspace-drawer opportunity-evidence-modal" title={opportunityDisplayTitle(item.title)} onClose={()=>setExpandedOpportunityId(null)} footer={item.status==='DRAFT'&&item.analysis.modelMetadata?.promptVersion===currentMarketOpportunityPromptVersion?<button className="primary" onClick={()=>{setExpandedOpportunityId(null);onReview(item);}}>审核机会</button>:undefined}>
          <div className="opportunity-drawer-context"><small>产品规划 / 市场机会</small><StatusBadge domain="opportunity" status={item.status}/></div>
          <div className="workspace-reference-tabs" role="tablist" aria-label="机会详情">{([['overview','概览'],['evidence','证据'],['products','代表商品'],['risks','风险与缺失'],['trace','追溯']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={detailTab===key} className={detailTab===key?'active':''} onClick={()=>setDetailTab(key)}>{label}</button>)}</div>
          {detailTab==='overview'&&<div><span className="decision-label inference">{candidate?'AI 推断':'机会判断'}</span><p>{item.summary}</p><p className="muted">{highlighted.length} 条{candidate?'代表证据':'支撑记录'} · {marketSourceLabel(batch.platform,batch.source)}</p><OpportunityProjectActions item={item} projects={projects} originProject={originProject} choice={projectChoice[item.id]??''} busy={busy} onChoice={id=>setProjectChoice(value=>({...value,[item.id]:id}))} onCreate={()=>{setExpandedOpportunityId(null);onCreate(item);}} onAttach={()=>onAttach(item.id)} onInclude={()=>onInclude(item.id)} onProject={onProject}/></div>}
          {detailTab==='evidence'&&<div><h3>判断依据</h3>{candidate?.core_basis.map((basis,index)=><p key={index}>{basis.text}</p>)}{!candidate?.core_basis.length&&<p className="muted">该机会未保存结构化判断依据，可查看实际关联商品核验。</p>}<button onClick={()=>setDetailTab('products')}>查看支撑商品 · {highlighted.length} 条</button></div>}
          {detailTab==='products'&&<div className="representative-evidence"><h3>{candidate?'代表证据':'关联商品'} · {highlighted.length} 条</h3>{highlighted.map(entry=><div className="representative-row" key={entry.id}><span>{entry.data.title}<small>{entry.data.brand||'品牌缺失'} · {entry.data.price===null?'价格缺失':`¥${entry.data.price}`}</small></span><button onClick={()=>{setExpandedOpportunityId(null);onOpen(entry);}}>查看来源</button></div>)}<button onClick={()=>{setExpandedOpportunityId(null);openEvidence(item.id,'all');}}>查看全部分析记录 · {item.analysis.included.length} 条</button></div>}
          {detailTab==='risks'&&<div><h3>风险与局限</h3>{risks.length?risks.map((risk,index)=><p key={index}>{risk}</p>):<p>尚未记录风险。</p>}<h3>待补充资料</h3>{missing.length?missing.map((value,index)=><p key={index}>{value}</p>):<p>尚未记录缺失项。</p>}</div>}
          {detailTab==='trace'&&<TraceContent nodes={[{key:'source',type:'数据源',label:marketSourceLabel(batch.platform,batch.source)},{key:'batch',type:'市场批次',label:batchDisplayName(item.analysis.batch.name),onOpen:()=>{setExpandedOpportunityId(null);props.onResearch?.();}},{key:item.id,type:'市场机会',label:opportunityDisplayTitle(item.title),current:true},...item.linkedProjects.map(project=>({key:project.id,type:'已关联项目',label:project.name,onOpen:()=>{setExpandedOpportunityId(null);onProject(project.id);}}))]}><p className="muted">结论仅代表当前样本，市场记录可被多个项目引用。</p>{item.analysis.historyRetrieval&&<details><summary>分析时提供的历史参考 · {item.analysis.historyRetrieval.hits.length} 条</summary>{item.analysis.historyRetrieval.hits.map(hit=><article key={hit.memoryId}><strong>{hit.reference.title}</strong><p>{hit.reference.decision==='APPROVED'?'此前人工通过':'此前人工驳回'}：{hit.reference.reviewNote}</p><small>{hit.reference.batchName} · 仅供参考，不是本批市场事实</small></article>)}{!item.analysis.historyRetrieval.hits.length&&<p>本次未提供匹配历史参考。</p>}</details>}<details><summary>AI 分析记录</summary><pre>{JSON.stringify(item.analysis.modelMetadata,null,2)}</pre></details></TraceContent>}
        </Modal>}
        {item.status==='DRAFT'&&item.analysis.modelMetadata?.promptVersion===currentMarketOpportunityPromptVersion&&<div className="opportunity-actions"><button className="primary" onClick={()=>onReview(item)}>审核机会</button></div>}{item.status==='DRAFT'&&item.analysis.modelMetadata?.promptVersion!==currentMarketOpportunityPromptVersion&&<span className="stale-candidate">需重新分析后审核</span>}
        <OpportunityProjectActions item={item} projects={projects} originProject={originProject} choice={projectChoice[item.id]??''} busy={busy} onChoice={id=>setProjectChoice(value=>({...value,[item.id]:id}))} onCreate={()=>onCreate(item)} onAttach={()=>onAttach(item.id)} onInclude={()=>onInclude(item.id)} onProject={onProject}/>
      </article>})}</div>
      {!batchOpportunities.length&&<div className="empty card"><p>勾选下方商品证据后运行 AI 分析，结果会先保存为待审核候选。</p></div>}
    </section>
    <details className="market-insight-section raw-evidence" id="market-evidence" open={evidenceOpen} onToggle={event=>setEvidenceOpen(event.currentTarget.open)}><summary>原始商品记录 · {entries.length} 条{focusedOpportunity?` · 正在查看「${opportunityDisplayTitle(focusedOpportunity.title)}」`:''}</summary>
      <div className="section-heading"><div><span className="eyebrow">原始商品记录</span><h2>{evidenceFocus?`${displayedEntries.length} 条关联商品`:`${entries.length} 条当前记录`}</h2></div><div className="raw-evidence-actions">{evidenceFocus&&<button onClick={()=>{setEvidenceFocus(null);setShowAllEvidence(false)}}>返回全部记录</button>}<button disabled={busy||!entries.length} onClick={()=>setSelectedEntryIds(selectedEntryIds.length===entries.length?[]:entries.map(item=>item.id))}>{selectedEntryIds.length===entries.length?'取消全选':'选择当前全部'}</button></div></div>
      {evidenceFocus&&focusedEvidence?.candidate&&<p className="muted">代表证据由分析模型选取；其余记录参与分析，仅作对照。</p>}
      <div className="evidence-list">{displayedEntries.map(entry=><article key={entry.id} className={selectedEntryIds.includes(entry.id)?'selected':''}><input aria-label={`选择${entry.data.title}`} type="checkbox" checked={selectedEntryIds.includes(entry.id)} onChange={event=>setSelectedEntryIds(ids=>event.target.checked?[...ids,entry.id]:ids.filter(id=>id!==entry.id))}/><div><strong>{entry.data.title}</strong>{evidenceFocus&&<span className="evidence-role">{focusedEvidence?.candidate?(representativeIds.has(entry.id)?'代表证据':'分析对照'):'关联商品'}</span>}<small>{entry.data.brand||'品牌缺失'} · {entry.data.shop||'店铺缺失'} · {entry.data.specification||'规格缺失'} · {entry.data.price===null?'价格缺失':`¥${entry.data.price}`}</small><p>{entry.data.sellingPoints||'未提供卖点原文'}</p></div><button onClick={()=>{setExpandedOpportunityId(null);onOpen(entry);}}>查看证据</button></article>)}</div>
      {!evidenceFocus&&entries.length>20&&<button className="evidence-expander" onClick={()=>setShowAllEvidence(value=>!value)}>{showAllEvidence?`收起，仅显示前 20 条`:`展开全部 ${entries.length} 条证据`}</button>}
    </details>
  </div>;
}
