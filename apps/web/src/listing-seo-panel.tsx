import { Select } from './components/Select.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';
import { InlineError } from './components/states.js';
import { useRoutedState } from './workspace-route.js';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { Product } from '../../../packages/contracts/domain.js';
import { api, json } from './api.js';
import { listingContentSchema } from '../../../packages/contracts/product-intelligence.js';
import { listingQualityIssues } from '../../../packages/contracts/listing-quality.js';
import { batchDisplayName } from './display-text.js';

type Batch={id:string;name:string;platform:string};
type Keyword={term:string;productCount:number;titleCount:number;sampleShare:number;priceRange:{min:number;max:number}|null;representativeEntries:Array<{id:string;title:string}>};
type Context={sku:{name:string;brand:string;specification:string};facts:Array<{id:string;type:string;value:string}>;keywordIntelligence:{batch:Batch;sampleSize:number;scopeNote:string;medianPrice:number|null;priceSampleSize:number;specifications:Array<{value:string;count:number}>;keywords:Keyword[];combinations:Array<{terms:string[];count:number}>};comparison:Array<{term:string;productCount:number;sampleSize:number;sourceEntryIds:string[];representativeEntries:Array<{id:string;title:string}>;confirmedFactIds:string[]}>;objectiveChecks:{productNamePresent:boolean;brandPresent:boolean;specificationPresent:boolean;duplicateTerms:string[];unsupportedClaimRisk:boolean};scopeNote:string};
type Listing={id:string;version:number;status:string;title:string;keywords:string[];suggestions:Record<string,unknown>;sourceRunId:string|null;qualityIssues?:Array<{path:string;message:string}>};
type Capability={capability:string;model:string;alternatives:string[]};
type Run={id:string;model:string;status:string;latencyMs:number};
// Keep incomplete edits visible; the confirmation contract remains strict.
const editableContentSchema=listingContentSchema.extend({
  titles:z.array(z.object({text:z.string(),sourceFactIds:z.array(z.string()),keywordTerms:z.array(z.string())})),
  sellingPoints:z.array(z.object({text:z.string(),sourceFactIds:z.array(z.string())})),
  detailSuggestions:z.array(z.object({text:z.string(),sourceFactIds:z.array(z.string())})),
  confirmedTitleFactIds:z.array(z.string()).optional(),
});

export function ListingSeoPanel({product}:{product:Product}) {
  const [batches,setBatches]=useState<Batch[]>([]),[batchId,setBatchId]=useState(''),[context,setContext]=useState<Context|null>(null),[listings,setListings]=useState<Listing[]>([]),[runs,setRuns]=useState<Run[]>([]);
  const [models,setModels]=useState<string[]>([]),[model,setModel]=useState(''),[editing,setEditing]=useState<Listing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selectedId,setSelectedId]=useRoutedState<string|null>('listingVersion',null);
  async function load() {
    const [items,records,attempts,configs]=await Promise.all([api<Batch[]>(`/products/${product.id}/comparable-market-batches`),api<Listing[]>(`/products/${product.id}/listing-contents?channel=taobao`),api<Run[]>(`/ai-inference-runs?subjectType=sku&subjectId=${product.id}&taskType=seo_listing`),api<Capability[]>('/model-capabilities')]);
    setBatches(items);setListings(records);setRuns(attempts);setBatchId(value=>value || items[0]?.id || '');
    const config=configs.find(item=>item.capability==='TEXT_REASONING');setModels(config?[config.model,...config.alternatives]:[]);
  }
  useEffect(()=>{setBatchId('');setEditing(null);setContext(null);load().catch(e=>setError(e.message));},[product.id]);
  useEffect(()=>{if(!batchId)return;let active=true;api<Context>(`/products/${product.id}/seo-context?batchId=${batchId}`).then(value=>{if(active)setContext(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[product.id,batchId]);
  async function generate(){if(!batchId)return;setBusy(true);setError('');try{const created=await api<Listing>(`/products/${product.id}/listing-contents/generate`,json({batchId,channel:'taobao',...(model?{model}:{})}));await load();setEditing(created);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function confirm(){if(!editing)return;const parsed=listingContentSchema.safeParse(editing.suggestions);if(!parsed.success)return;setBusy(true);setError('');try{await api(`/listing-contents/${editing.id}/confirm`,json({title:editing.title,titleFactIds:parsed.data.confirmedTitleFactIds??parsed.data.titles[0]!.sourceFactIds,keywords:editing.keywords,suggestions:parsed.data}));setEditing(null);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const dirty=!!editing&&JSON.stringify(editing)!==JSON.stringify(listings.find(item=>item.id===editing.id));
  useUnsavedChanges(dirty);
  const selected=editing??listings.find(item=>item.id===selectedId)??listings.find(item=>item.status==='CONFIRMED')??listings[0];
  const parsed=editableContentSchema.safeParse(selected?.suggestions);
  const confirmationValid=listingContentSchema.safeParse(selected?.suggestions).success;
  const issues=parsed.success&&context&&selected?listingQualityIssues({candidate:parsed.data,facts:context.facts,product:context.sku,title:selected.title,titleFactIds:parsed.data.confirmedTitleFactIds??parsed.data.titles[0]!.sourceFactIds,keywords:selected.keywords}):selected?.qualityIssues??[];
  function updateSlot(group:'sellingPoints'|'detailSuggestions',index:number,value:{text:string;sourceFactIds:string[]}) {
    if(!editing||!parsed.success)return;
    setEditing({...editing,suggestions:{...parsed.data,[group]:parsed.data[group].map((slot,i)=>i===index?value:slot)}});
  }
  function factPicker(ids:string[],change:(ids:string[])=>void) {
    return <details><summary>商品事实依据 · {ids.length} 项</summary>{context?.facts.map(fact=><label className="listing-fact-choice" key={fact.id}><input type="checkbox" checked={ids.includes(fact.id)} disabled={!editing||busy} onChange={event=>change(event.target.checked?[...ids,fact.id]:ids.filter(id=>id!==fact.id))}/>{fact.value}</label>)}{ids.filter(id=>!context?.facts.some(fact=>fact.id===id)).map(id=><p key={id}>引用的商品事实已失效，请重新选择依据 {editing&&<button disabled={busy} onClick={()=>change(ids.filter(value=>value!==id))}>移除失效引用</button>}</p>)}</details>;
  }
  return <details className="listing-seo-panel"><summary><strong>关键词分布与渠道文案优化</strong><span>{listings.find(item=>item.status==='CONFIRMED')?`淘宝标题已确认 v${listings.find(item=>item.status==='CONFIRMED')!.version}`:'尚无已确认淘宝标题'}</span></summary>
    <p>市场样本只提供用词参考；正式标题和关键词只能依据这款商品已确认的事实，人工确认后供内容制作查阅。</p>
    <div className="listing-seo-controls"><label>来源批次<Select value={batchId} onChange={event=>setBatchId(event.target.value)}>{batches.map(item=><option key={item.id} value={item.id}>{item.platform} · {batchDisplayName(item.name)}</option>)}</Select></label><label>建议模型<Select value={model} onChange={event=>setModel(event.target.value)}><option value="">使用功能模型设置</option>{models.map(item=><option key={item} value={item}>{item}</option>)}</Select></label><button disabled={busy||!batchId} onClick={()=>void generate()}>生成渠道文案候选</button></div>
    {context&&<div className="listing-seo-context"><strong>【市场数据】{context.keywordIntelligence.sampleSize} 条有效样本</strong><p>{context.keywordIntelligence.scopeNote}</p><div className="listing-keyword-list">{context.keywordIntelligence.keywords.slice(0,8).map(item=><span key={item.term}>{item.term} · {item.productCount} 条商品 · 标题 {item.titleCount} 条{item.priceRange?` · ¥${item.priceRange.min}–${item.priceRange.max}`:''}</span>)}</div><small>常见组合：{context.keywordIntelligence.combinations.slice(0,4).map(item=>`${item.terms.join('+')}（${item.count}）`).join('；')||'当前样本不足'}</small><p>【客观检查】商品名 {context.objectiveChecks.productNamePresent?'已包含':'缺失'} · 品牌 {context.objectiveChecks.brandPresent?'已包含':'缺失'} · 规格 {context.objectiveChecks.specificationPresent?'已包含':'缺失'}；未提供可靠搜索量、趋势或平台字数上限。</p></div>}
    {context&&<details className="listing-seo-context"><summary>竞品对标 · 当前样本 {context.keywordIntelligence.sampleSize} 条</summary><p>样本标价中位数：{context.keywordIntelligence.medianPrice===null?'缺少价格':`¥${context.keywordIntelligence.medianPrice}`}（{context.keywordIntelligence.priceSampleSize} 条有价格）；本品未记录销售价，不能判断定价差距。样本常见规格：{context.keywordIntelligence.specifications.slice(0,3).map(item=>`${item.value} · ${item.count} 条`).join('、')||'缺少规格'}；本品规格：{context.sku.specification}。</p><p>以下只比较样本标题与本品已确认资料的用词。未出现不代表商品没有该功效，也不代表搜索热度。</p><div className="listing-keyword-list">{context.comparison.map(item=><span key={item.term}>{item.term}：样本 {item.productCount}/{item.sampleSize}；本品{item.confirmedFactIds.length?'有已确认依据':'资料中未出现'}<details><summary>查看代表商品 · {item.representativeEntries.length} 条</summary>{item.representativeEntries.map(entry=><p key={entry.id}>{entry.title}</p>)}</details></span>)}</div><p>这些统计可供 Listing 建议参考；正式标题和卖点仍需逐项核对商品事实并人工确认。</p></details>}
    {!!listings.length&&<div className="listing-history">{listings.map(item=><button key={item.id} disabled={busy} className={selected?.id===item.id?'active':''} onClick={()=>{if(dirty&&!window.confirm('放弃未保存更改并查看其他版本？'))return;setSelectedId(item.id);setEditing(item.status==='DRAFT'?item:null);}}>v{item.version} · {item.status==='CONFIRMED'?'已确认':item.status==='SUPERSEDED'?'历史版本':'待确认'}</button>)}</div>}
    {selected&&<div className="listing-selected"><strong>{selected.status==='CONFIRMED'?'已确认内容':'【AI 建议】'} · 淘宝 Listing v{selected.version}</strong>
      {parsed.success&&editing&&<label>标题候选<Select disabled={busy} value="" onChange={event=>{const title=parsed.data.titles[Number(event.target.value)];if(title)setEditing({...editing,title:title.text,suggestions:{...parsed.data,confirmedTitleFactIds:title.sourceFactIds}});}}><option value="">选择候选或手动修改</option>{parsed.data.titles.map((title,i)=><option key={i} value={i}>{title.text}</option>)}</Select></label>}
      <label>商品标题<input value={selected.title} readOnly={!editing||busy} onChange={event=>editing&&setEditing({...editing,title:event.target.value})}/></label>
      {parsed.success&&factPicker(parsed.data.confirmedTitleFactIds??parsed.data.titles[0]!.sourceFactIds,ids=>editing&&setEditing({...editing,suggestions:{...parsed.data,confirmedTitleFactIds:ids}}))}
      {parsed.success&&<details><summary>全部标题候选 · {parsed.data.titles.length} 条</summary>{parsed.data.titles.map((title,i)=><div key={i}><label>标题候选 {i+1}<input value={title.text} readOnly={!editing||busy} onChange={event=>editing&&setEditing({...editing,suggestions:{...parsed.data,titles:parsed.data.titles.map((item,index)=>index===i?{...item,text:event.target.value,keywordTerms:item.keywordTerms.filter(term=>event.target.value.includes(term))}:item)}})}/></label>{factPicker(title.sourceFactIds,ids=>editing&&setEditing({...editing,suggestions:{...parsed.data,titles:parsed.data.titles.map((item,index)=>index===i?{...item,sourceFactIds:ids}:item)}}))}</div>)}</details>}
      <label>关键词（逗号分隔）<input value={selected.keywords.join('，')} readOnly={!editing||busy} onChange={event=>editing&&setEditing({...editing,keywords:event.target.value.split(/[，,]/).map(value=>value.trim()).filter(Boolean)})}/></label>
      {parsed.success&&!!parsed.data.suggestedKeywords.length&&<details><summary>关键词建议依据 · {parsed.data.suggestedKeywords.length} 项</summary>{parsed.data.suggestedKeywords.map((keyword,i)=><div key={i}><strong>{keyword.term}</strong><small>{keyword.marketEntryIds.length?` · ${keyword.marketEntryIds.length} 条市场样本（不证明本商品功效）`:''}</small>{factPicker(keyword.sourceFactIds,ids=>editing&&setEditing({...editing,suggestions:{...parsed.data,suggestedKeywords:parsed.data.suggestedKeywords.map((item,index)=>index===i?{...item,sourceFactIds:ids}:item)}}))}{editing&&<button disabled={busy} onClick={()=>setEditing({...editing,suggestions:{...parsed.data,suggestedKeywords:parsed.data.suggestedKeywords.filter((_,index)=>index!==i)}})}>移除此关键词建议</button>}</div>)}</details>}
      {parsed.success?<>{(['sellingPoints','detailSuggestions'] as const).map(group=><section key={group}><strong>{group==='sellingPoints'?'五点卖点（最多五条，不凑数）':'详情文案'}</strong>{parsed.data[group].map((slot,i)=><div key={i}><label>{group==='sellingPoints'?`卖点 ${i+1}`:`详情 ${i+1}`}<textarea value={slot.text} readOnly={!editing||busy} onChange={event=>updateSlot(group,i,{...slot,text:event.target.value})}/></label>{factPicker(slot.sourceFactIds,ids=>updateSlot(group,i,{...slot,sourceFactIds:ids}))}</div>)}</section>)}{!!parsed.data.risks.length&&<details><summary>风险与待核实事项</summary>{parsed.data.risks.map((risk,i)=><p key={i}>{risk}</p>)}</details>}</>:<><p>历史内容缺少逐项事实引用，仍可查看；请重新生成后再确认。</p>{Array.isArray(selected.suggestions.sellingPointOrder)&&<p>历史卖点顺序：{selected.suggestions.sellingPointOrder.join(' → ')}</p>}{Array.isArray(selected.suggestions.detailSuggestions)&&selected.suggestions.detailSuggestions.map((item,i)=><p key={i}>{typeof item==='string'?item:'旧内容请核对原记录'}</p>)}</>}
      {!!issues.length&&<div role="alert"><strong>需要修改后才能确认</strong>{issues.map((issue,i)=><p key={i}>{issue.path}：{issue.message}</p>)}</div>}
      {editing&&<button className="primary" disabled={busy||!confirmationValid||!!issues.length||!context} onClick={()=>void confirm()}>人工确认此渠道文案版本</button>}
      <small>规则仅检查已定义的事实、规格与风险项；仍需人工核对表述是否真实，不能视为自动合规保证。</small>
    </div>}
    {!!runs.length&&<details><summary>模型结果对比 · {runs.length} 次</summary>{runs.map(run=><p key={run.id}>{run.model} · {run.status==='SUCCEEDED'?'已返回':'失败'} · {run.latencyMs} ms</p>)}</details>}
    {editing&&<div className="confirmation-edit-feedback"><span role="status">{dirty?'有未保存更改，人工确认后才成为正式版本':'候选尚未人工确认'}</span><button disabled={busy} onClick={()=>{if(!dirty||window.confirm('放弃未保存更改？'))setEditing(null);}}>取消编辑</button></div>}
    {error&&<InlineError onRetry={()=>{setError('');void load().catch(e=>setError(e.message));}}>{error}</InlineError>}
  </details>;
}
