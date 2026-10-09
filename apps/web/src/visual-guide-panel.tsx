import { Select } from './components/Select.js';
import { useEffect,useState } from 'react';
import { api,json } from './api.js';
import type { VisualGuide,VisualGuideData,VisualGuideSource } from '../../../packages/contracts/visual-guide.js';
import { taobaoDailyCarePages } from '../../../packages/contracts/content-template.js';
import { ImageTypeGuidePanel } from './image-type-guide-panel.js';

const initial:VisualGuideData={name:'日化商品视觉指南',style:'真实商业摄影；统一自然光与色彩；以商品为视觉中心，信息清晰可读。',identityConstraints:['保持参考商品的瓶型、泵头、包装、标签和比例','不得将竞品或类目经验当作当前商品功效'],channels:['taobao','jd'],imageTypes:taobaoDailyCarePages.map(page=>({pageIds:[page.id],composition:`${page.name}：围绕本页已确认文案组织信息，完整展示真实商品；不创造新的商品事实。`})),prohibitions:[{code:'PACKAGING_CHANGE',description:'不得改变瓶身、包装、标签及商品数量',severity:'BLOCK',checkMethod:'VISION',terms:[]},{code:'CHINESE_DISTORTION',description:'不得出现乱码、错字或与确认文案不一致的文字',severity:'BLOCK',checkMethod:'HUMAN',terms:[]},{code:'UNPROVEN_CLAIM',description:'不得宣称防脱、生发、治疗或绝对化功效',severity:'BLOCK',checkMethod:'TEXT',terms:['防脱','生发','治疗','100%有效']}]};
const sources:VisualGuideSource[]=[{repository:'wzj177/ecommerce-image-suite',path:'references/image-types.md',commit:'2d508bd990df0397026406f210a5915b2c955469',extractedAt:'2026-10-04T00:00:00.000Z',extractedBy:'Codex 整理',adaptation:'按图型目的拆分；保留商品结构和比例，不导入服装规格或未经核实的渠道规则'},{repository:'motiful/product-shots',path:'skills/product-shots-detail-page/SKILL.md',commit:'063c508b0b7f4db5cda89f10bdf20df25026dfc5',extractedAt:'2026-10-04T00:00:00.000Z',extractedBy:'Codex 整理',adaptation:'每页注入同商品参考图；统一风格；不导入 Amazon A+ 平台尺寸规则'}];
export function VisualGuidePanel(){
  const [categories,setCategories]=useState<Array<{id:string;name:string}>>([]),[guides,setGuides]=useState<VisualGuide[]>([]),[categoryId,setCategoryId]=useState(''),[data,setData]=useState<VisualGuideData>(initial),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [references,setReferences]=useState(sources);
  const [confirming,setConfirming]=useState<string|null>(null);
  async function load(){setGuides(await api<VisualGuide[]>('/visual-guides'));}
  useEffect(()=>{api<Array<{id:string;name:string}>>('/categories').then(items=>{setCategories(items);setCategoryId(items.at(-1)?.id??'');}).catch(e=>setError(e.message));load().catch(e=>setError(e.message));},[]);
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="visual-guide-panel"><ImageTypeGuidePanel/><details><summary>类目风格与特殊约束</summary><h2>类目视觉指南</h2><p className="muted small">指南用于参考图生成与人工质检。草稿不会参与生成；确认新版本后，旧任务继续使用原指南。已有逐页构图为历史输入，新任务的通用构图以独立图型指南为准。</p><button onClick={()=>{setData(initial);setReferences(sources);setEditing(true);}}>整理指南草稿</button>
    {editing&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{await api('/visual-guides',json({categoryId,data,sources:references}));setEditing(false);});}}>
      <label>类目<Select required value={categoryId} onChange={event=>setCategoryId(event.target.value)}>{categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <label>指南名称<input required value={data.name} onChange={event=>setData({...data,name:event.target.value})}/></label>
      <label>视觉风格<textarea required value={data.style} onChange={event=>setData({...data,style:event.target.value})}/></label>
      <label>商品身份约束（每行一项）<textarea value={data.identityConstraints.join('\n')} onChange={event=>setData({...data,identityConstraints:event.target.value.split('\n').filter(Boolean)})}/></label>
      <details><summary>逐页图型构图 · {data.imageTypes.length} 项</summary>{data.imageTypes.map((item,index)=><label key={item.pageIds.join()}>{item.pageIds.join('、')}<textarea required value={item.composition} onChange={event=>setData({...data,imageTypes:data.imageTypes.map((value,i)=>i===index?{...value,composition:event.target.value}:value)})}/></label>)}</details>
      <details><summary>禁忌项与检查方式 · {data.prohibitions.length} 项</summary>{data.prohibitions.map((rule,index)=><label key={rule.code}>{rule.code} · {rule.checkMethod==='TEXT'?'程序文字检查':rule.checkMethod==='VISION'?'视觉辅助与人工复核':'人工复核'}<input required value={rule.description} onChange={event=>setData({...data,prohibitions:data.prohibitions.map((value,i)=>i===index?{...value,description:event.target.value}:value)})}/>{rule.checkMethod==='TEXT'&&<input aria-label="禁用表达（逗号分隔）" value={rule.terms.join(',')} onChange={event=>setData({...data,prohibitions:data.prohibitions.map((value,i)=>i===index?{...value,terms:event.target.value.split(',').map(v=>v.trim()).filter(Boolean)}:value)})}/>}</label>)}</details>
      <div className="actions"><button disabled={busy}>保存草稿</button><button type="button" onClick={()=>setEditing(false)}>取消</button></div></form>}
    {guides.map(guide=><details key={guide.id}>
      <summary>{categories.find(item=>item.id===guide.categoryId)?.name} · {guide.data.name} · v{guide.version} · {guide.status==='CONFIRMED'?'已确认':guide.status==='DRAFT'?'待确认':'历史版本'}</summary>
      <p>{guide.data.style}</p>
      <ul>{guide.data.identityConstraints.map(item=><li key={item}>{item}</li>)}</ul>
      <details><summary>逐页构图 · {guide.data.imageTypes.length} 项</summary>{guide.data.imageTypes.map(item=><p key={item.pageIds.join()}><strong>{item.pageIds.join('、')}</strong> · {item.composition}</p>)}</details>
      <ul>{guide.data.prohibitions.map(rule=><li key={rule.code}>{rule.description}</li>)}</ul>
      <details><summary>来源记录</summary>{guide.sources.map(source=><p key={source.repository+source.path}>{source.repository} / {source.path} · {source.commit.slice(0,8)}<br/>{source.adaptation}</p>)}</details>
      {confirming===guide.id&&<p role="status">确认后，此版本将用于该类目的新视觉任务与质检；历史任务保持原指南。</p>}
      <div className="actions">{guide.status==='DRAFT'&&<button disabled={busy} onClick={()=>{
        if(confirming!==guide.id){setConfirming(guide.id);return;}
        void run(async()=>{await api(`/visual-guides/${guide.id}/confirm`,json({confirm:true}));setConfirming(null);});
      }}>{confirming===guide.id?'确认并启用指南':'确认指南'}</button>}
      <button onClick={()=>{setCategoryId(guide.categoryId);setData(guide.data);setReferences(guide.sources);setEditing(true);}}>基于此版本整理新草稿</button></div>
    </details>)}
    {!guides.length&&!editing&&<p className="muted small">尚无指南。先整理草稿并人工确认，再提交参考图视觉任务。</p>}{error&&<p role="alert">{error}</p>}
  </details></div>;
}
