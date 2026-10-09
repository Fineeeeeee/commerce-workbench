import { Select } from './components/Select.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';
import { InlineError } from './components/states.js';
import { useRoutedState } from './workspace-route.js';
import { useEffect, useState } from 'react';
import { api, json } from './api.js';
import type { BriefContent } from '../../../packages/contracts/product-intelligence.js';

type Brief = { id:string;version:number;status:string;sourceRunId:string|null;content:BriefContent;citations:{opportunityId:string;batchId:string;entryIds:string[]};confirmedAt:string|null };
type Run = {id:string;model:string;modelVersion:string|null;status:string;latencyMs:number};
type Capability = {capability:string;model:string;alternatives:string[];enabled:boolean};
const stripInlineIds = (text:string) => text.replace(/(?:\[id:|ID:)[0-9a-f]{8}-[0-9a-f-]{27,}\]?/giu,'');
function displayBrief(item:Brief):Brief {
  const suggestions=item.content.suggestions;
  const mapped=Object.fromEntries(Object.entries(suggestions).map(([key,value])=>[key,Array.isArray(value)?value.map(part=>typeof part==='string'?stripInlineIds(part):{...part,text:stripInlineIds(part.text)}):{...value,text:stripInlineIds(value.text)}])) as BriefContent['suggestions'];
  return {...item,content:{...item.content,suggestions:mapped}};
}

export function ProductBriefPanel({projectId,onMarket}:{projectId:string;onMarket:(batchId:string,projectId?:string,opportunityId?:string)=>void}) {
  const [selectedId,setSelectedId]=useRoutedState<string|null>('briefVersion',null),[briefTab,setBriefTab]=useRoutedState<'overview'|'audience'|'selling'|'design'|'risks'|'trace'>('briefTab','overview',['overview','audience','selling','design','risks','trace']);
  const [briefs,setBriefs]=useState<Brief[]>([]),[runs,setRuns]=useState<Run[]>([]),[models,setModels]=useState<string[]>([]);
  const [model,setModel]=useState(''),[editing,setEditing]=useState<Brief|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load() {
    const [items,attempts,configs]=await Promise.all([api<Brief[]>(`/product-projects/${projectId}/product-briefs`),api<Run[]>(`/ai-inference-runs?subjectType=project&subjectId=${projectId}&taskType=product_brief`),api<Capability[]>('/model-capabilities')]);
    setBriefs(items.map(displayBrief));setRuns(attempts);
    const config=configs.find(item=>item.capability==='TEXT_REASONING');
    setModels(config?[config.model,...config.alternatives]:[]);

  }
  useEffect(()=>{setBriefs([]);setEditing(null);load().catch(e=>setError(e.message));},[projectId]);
  async function generate() {setBusy(true);setError('');try {const item=await api<Brief>(`/product-projects/${projectId}/product-briefs/generate`,json(model?{model}:{}));await load();setEditing(displayBrief(item));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function confirm() {if(!editing)return;setBusy(true);setError('');try{await api(`/product-briefs/${editing.id}/confirm`,json({content:editing.content}));setEditing(null);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const dirty=!!editing&&JSON.stringify(editing)!==JSON.stringify(briefs.find(item=>item.id===editing.id));
  useUnsavedChanges(dirty);
  const selected=editing ?? briefs.find(item=>item.id===selectedId) ?? briefs.find(item=>item.status==='CONFIRMED') ?? briefs[0];
  const suggestions=selected?.content.suggestions;
  const change=(key:keyof BriefContent['suggestions'],text:string)=>{if(!editing)return;const value=editing.content.suggestions[key];if(Array.isArray(value))return;setEditing({...editing,content:{...editing.content,suggestions:{...editing.content.suggestions,[key]:{...value,text}}}});};
  return <div className="product-brief-panel"><header><strong>正式产品企划</strong><small>{briefs.find(item=>item.status==='CONFIRMED')?`已确认 v${briefs.find(item=>item.status==='CONFIRMED')!.version}`:'尚无人工确认版本'}</small></header>
    <p>市场事实与 AI 建议分开保存；确认后供产品定义参考，不会改写 SPU 或 SKU。</p>
    <div className="product-brief-actions"><details><summary>模型设置</summary><Select aria-label="企划生成模型" value={model} onChange={event=>setModel(event.target.value)}><option value="">使用功能模型设置</option>{models.map(item=><option key={item} value={item}>{item}</option>)}</Select></details><button disabled={busy} onClick={()=>void generate()}>生成企划候选</button></div>
    {!!briefs.length&&<div className="product-brief-history">{briefs.map(item=><button key={item.id} className={selected?.id===item.id?'active':''} onClick={()=>{if(dirty&&!window.confirm('放弃未保存更改并查看其他版本？'))return;setSelectedId(item.id);setEditing(item.status==='DRAFT'?item:null);}}>{`v${item.version} · ${item.status==='CONFIRMED'?'已确认':item.status==='SUPERSEDED'?'历史版本':'待确认'}`}</button>)}</div>}
    {selected&&<div className="product-brief-content"><div className="workspace-reference-tabs" role="tablist" aria-label="产品企划工作区">{([['overview','定位与事实'],['audience','目标用户'],['selling','卖点方向'],['design','设计建议'],['risks','风险与待验证'],['trace','证据引用']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={briefTab===key} className={briefTab===key?'active':''} onClick={()=>setBriefTab(key)}>{label}</button>)}</div><div hidden={briefTab!=='overview'}><small>【市场事实】仅代表来源批次</small>{selected.content.marketFacts.map((fact,index)=><p key={index}>{fact.text}</p>)}</div><div>{briefTab!=='trace'&&<small>【AI 建议】请人工核对</small>}{suggestions&&(['marketOpportunity','targetUserAndScene','priceBand','specification','differentiation','productDesign'] as const).map(key=><label key={key} hidden={!({marketOpportunity:['overview'],targetUserAndScene:['audience'],priceBand:['overview'],specification:['design'],differentiation:['selling'],productDesign:['design']} as Record<string,string[]>)[key]!.includes(briefTab)}>{({marketOpportunity:'市场机会',targetUserAndScene:'目标用户 / 场景',priceBand:'建议价格带',specification:'建议规格',differentiation:'差异化方向',productDesign:'产品设计方向'} as const)[key]}<textarea rows={2} readOnly={!editing} value={suggestions[key].text} onChange={event=>change(key,event.target.value)}/></label>)}<p hidden={briefTab!=='selling'}>核心卖点：{suggestions?.coreSellingPoints.map(item=>item.text).join('；')}</p><p hidden={briefTab!=='risks'}>风险：{suggestions?.risks.map(item=>item.text).join('；')}</p><p hidden={briefTab!=='risks'}>待验证：{suggestions?.pendingValidation.join('；')}</p></div><div className="product-brief-footer"><button hidden={briefTab!=='trace'} onClick={()=>onMarket(selected.citations.batchId,undefined,selected.citations.opportunityId)}>查看机会与来源商品</button><span hidden={briefTab!=='trace'}>引用 {selected.citations.entryIds.length} 条商品记录</span>{editing&&<button className="primary" disabled={busy} onClick={()=>void confirm()}>人工确认此企划版本</button>}</div></div>}
    {!!runs.length&&<details><summary>模型运行与对比 · {runs.length} 次</summary>{runs.map(run=><p key={run.id}>{run.model}{run.modelVersion&&run.modelVersion!==run.model?` · ${run.modelVersion}`:''} · {run.status==='SUCCEEDED'?'已返回':'失败'} · {run.latencyMs} ms</p>)}</details>}
    {editing&&<div className="confirmation-edit-feedback"><span role="status">{dirty?'有未保存更改，人工确认后才成为正式版本':'候选尚未人工确认'}</span><button disabled={busy} onClick={()=>{if(!dirty||window.confirm('放弃未保存更改？'))setEditing(null);}}>取消编辑</button></div>}
    {error&&<InlineError onRetry={()=>{setError('');void load().catch(e=>setError(e.message));}}>{error}</InlineError>}
  </div>;
}
