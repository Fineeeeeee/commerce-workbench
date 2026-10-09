import { Select } from './components/Select.js';
import { useEffect,useState } from 'react';
import { api,json } from './api.js';
import { useRoutedState } from './workspace-route.js';
import type { ImageTypeGuide,ImageTypeData } from '../../../packages/contracts/image-type-guide.js';
import { designEnhancedDraft } from '../../../packages/contracts/image-type-design.js';
import { useUnsavedChanges } from './use-unsaved-changes.js';
import { InlineError } from './components/states.js';
const fields=[['purpose','决策目的'],['cameraAngle','视角'],['framing','构图与商品占比'],['lighting','光线'],['backgroundRule','背景'],['textOverlayRule','文字规则'],['sourceMapping','图型参照与编辑取舍']] as const;
export function ImageTypeGuidePanel(){
  const [items,setItems]=useState<ImageTypeGuide[]>([]),[slot,setSlot]=useRoutedState<string>('imageTypeSlot','F01'),[data,setData]=useState<ImageTypeData|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
  async function load(){setItems(await api<ImageTypeGuide[]>('/image-type-guides'));}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  useEffect(()=>{setData(null);setConfirming(false);},[slot]);
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const guide=items.find(item=>item.slotId===slot);
  const dirty=!!data&&JSON.stringify(data)!==JSON.stringify(guide?.data);
  useUnsavedChanges(dirty);
  return <section className="image-type-guide-panel"><h3>通用图型规则</h3><p className="small muted">先确定每张图如何组织信息，再叠加类目风格。外部经验不是平台官方规则，图型草稿需逐项确认。</p>
    {!items.length?<button disabled={busy} onClick={()=>void run(async()=>{await api('/image-type-guides/prepare-drafts',json({confirmDraftPreparation:true}));})}>整理17个槽位的知识草稿</button>:<>
      <label>模板槽位<Select value={slot} onChange={e=>{if(!dirty||window.confirm('有未保存更改。放弃修改并切换槽位？'))setSlot(e.target.value);}}>{[...new Set(items.map(item=>item.slotId))].map(value=><option key={value}>{value}</option>)}</Select></label>
      {guide&&<><p>{guide.slotId} · 图型指南 v{guide.version} · {guide.status==='CONFIRMED'?'已确认':guide.status==='DRAFT'?'待确认':'历史版本'}</p>
      <dl>{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{guide.data[key]}</dd></div>)}</dl>
      <details><summary>必须呈现、禁止项与失败案例</summary>{(['mustShow','mustNotShow','commonFailureModes'] as const).map(key=><div key={key}><strong>{key==='mustShow'?'必须呈现':key==='mustNotShow'?'禁止项':'失败案例'}</strong><ul>{guide.data[key].map(value=><li key={value}>{value}</li>)}</ul></div>)}</details>
      <details><summary>渠道表达与知识来源</summary><p>国内：{guide.data.styleVariant.domestic}</p><p>跨境设计参考：{guide.data.styleVariant.crossBorder}；当前不启用跨境生成。</p>{guide.sources.map(source=><p key={source.repository+source.path}>{source.repository} / {source.path} · {source.commit.slice(0,8)}<br/>{source.adaptation}</p>)}</details>
      {data?<form onSubmit={e=>{e.preventDefault();void run(async()=>{await api('/image-type-guides',json({templateKey:guide.templateKey,slotId:guide.slotId,data,sources:guide.sources}));setData(null);});}}>
        {fields.map(([key,label])=><label key={key}>{label}<textarea required value={data[key]} onChange={e=>setData({...data,[key]:e.target.value})}/></label>)}
        {(['mustShow','mustNotShow','commonFailureModes'] as const).map(key=><label key={key}>{key==='mustShow'?'必须呈现':key==='mustNotShow'?'禁止项':'失败案例'}（每行一项）<textarea value={data[key].join('\n')} onChange={e=>setData({...data,[key]:e.target.value.split('\n').filter(Boolean)})}/></label>)}
        <label>国内表达<textarea value={data.styleVariant.domestic} onChange={e=>setData({...data,styleVariant:{...data.styleVariant,domestic:e.target.value}})}/></label><label>跨境参考<textarea value={data.styleVariant.crossBorder} onChange={e=>setData({...data,styleVariant:{...data.styleVariant,crossBorder:e.target.value}})}/></label>
        {dirty&&<p role="status">有未保存更改</p>}<button disabled={busy||!dirty}>保存为新草稿</button><button type="button" onClick={()=>{if(!dirty||window.confirm('放弃未保存更改？'))setData(null);}}>取消</button>
      </form>:<div className="actions"><button onClick={()=>setData(guide.data)}>整理新版本</button><button onClick={()=>setData(designEnhancedDraft(guide.slotId,guide.data))}>整理设计增强草稿</button>{guide.status==='DRAFT'&&<button disabled={busy} onClick={()=>{if(!confirming){setConfirming(true);return;}void run(async()=>{await api(`/image-type-guides/${guide.id}/confirm`,json({confirm:true}));setConfirming(false);});}}>{confirming?'确认启用此图型版本':'确认图型指南'}</button>}</div>}
      {confirming&&<p role="status">仅新任务使用此版本，旧候选和历史审核保持原输入。</p>}
      <details><summary>历史版本</summary>{items.filter(item=>item.slotId===slot).map(item=><p key={item.id}>v{item.version} · {item.status} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p>)}</details>
      </>}
    </>}{error&&<InlineError onRetry={()=>{setError('');void load().catch(e=>setError(e.message));}}>{error}</InlineError>}
  </section>;
}
