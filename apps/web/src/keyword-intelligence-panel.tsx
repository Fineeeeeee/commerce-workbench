import { useEffect, useState } from 'react';
import { api } from './api.js';
import { InlineError, PageLoading, EmptyState } from './components/states.js';

type Keyword={term:string;titleCount:number;productCount:number;sampleShare:number;priceRange:{min:number;max:number}|null;representativeEntries:Array<{id:string;title:string}>};
type Intelligence={sampleSize:number;scopeNote:string;keywords:Keyword[];combinations:Array<{terms:string[];count:number}>};
export function KeywordIntelligencePanel({batchId}:{batchId:string}) {
  const [data,setData]=useState<Intelligence|null>(null),[error,setError]=useState(''),[readRevision,setReadRevision]=useState(0);
  useEffect(()=>{let active=true;setData(null);setError('');api<Intelligence>(`/market/batches/${batchId}/keyword-intelligence`).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[batchId,readRevision]);
  return <details className="keyword-intelligence-panel"><summary>关键词分布 · {data?`${data.keywords.length} 组已归类表达`:'载入中'}</summary>
    {data&&<><p>{data.scopeNote}</p><div className="keyword-intelligence-list">{data.keywords.map(item=><article key={item.term}><strong>{item.term}</strong><span>{item.productCount}/{data.sampleSize} 条商品 · 标题 {item.titleCount} 条</span><span>{item.priceRange?`相关商品价格 ¥${item.priceRange.min}–${item.priceRange.max}`:'相关商品价格缺失'}</span><details><summary>查看代表商品</summary>{item.representativeEntries.map(entry=><p key={entry.id}>{entry.title}</p>)}</details></article>)}</div><p>常见卖点组合：{data.combinations.slice(0,8).map(item=>`${item.terms.join('+')}（${item.count}）`).join('；')||'当前样本不足'}</p></>}
    {error&&<InlineError onRetry={()=>setReadRevision(value=>value+1)}>{error}</InlineError>}
    {!data&&!error&&<PageLoading>读取关键词分布</PageLoading>}
    {data&&!data.keywords.length&&<EmptyState title="暂无可统计关键词" desc="查看当前研究的商品样本，确认标题和卖点资料。"/>}
  </details>;
}
