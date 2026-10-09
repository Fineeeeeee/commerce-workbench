import { useEffect, useState } from 'react';
import { api, json } from './api.js';

const functions = [['TEXT_FAST','文本整理与关键词归一'],['TEXT_REASONING','市场与内容综合分析'],['PRODUCT_BRIEF','产品企划'],['SEO_REASONING','标题与关键词建议'],['COPY_GENERATION','页面文案生成'],['VISION_INSPECT','多模态辅助质检'],['IMAGE_GENERATION','视觉背景生成'],['SYSTEM_REASONING','系统协调与工作建议'],['TEXT_EMBEDDING','历史语义检索']] as const;
type Settings={overrides:Record<string,string>;currentModels:Record<string,string>;capabilities:Array<{capability:string;model:string}>};
export function ModelSettingsPanel(){
  const [settings,setSettings]=useState<Settings|null>(null),[draft,setDraft]=useState<Record<string,string>>({}),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=async()=>{const value=await api<Settings>('/model-settings');setSettings(value);setDraft(value.overrides);};
  useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
  const changed=functions.filter(([key])=>(draft[key]?.trim()||'')!==(settings?.overrides[key]||''));
  async function save(){setBusy('all');setError('');setNotice('');try{for(const [key] of changed){await api(`/model-settings/${key}`,{...json({model:draft[key]?.trim()||null}),method:'PUT'});setSettings(value=>value?{...value,overrides:{...value.overrides,[key]:draft[key]?.trim()||''}}:value);}await load();setNotice('模型设置已保存，后续新请求生效。');}catch(e){setError((e as Error).message);}finally{setBusy(null);}}
  return <section className="model-settings"><h2>按功能设置模型</h2><p className="muted small">调试时填写百炼模型 ID；留空沿用现有配置。保存不调用模型，权限与额度仍以实际请求为准。</p>{error&&<p role="alert" className="notice-error">{error}</p>}{notice&&<p role="status">{notice}</p>}<div className="model-settings-rows">{functions.map(([key,label])=><label key={key}><span>{label}<small>{key}</small></span><input aria-label={`${label}模型 ID`} disabled={!settings||!!busy} value={draft[key]??''} maxLength={120} placeholder={settings?.currentModels[key]??'沿用现有配置'} onChange={event=>setDraft(value=>({...value,[key]:event.target.value}))}/></label>)}</div><div className="form-actions"><button disabled={!settings||!!busy||!changed.length} onClick={()=>void save()}>{busy?'保存中…':`保存模型设置${changed.length?`（${changed.length} 项）`:''}`}</button></div><small className="muted">生图与向量仅支持已有适配器的模型；此处不接收密钥。</small></section>;
}
