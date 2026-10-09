import { Select } from './components/Select.js';
import { cleanDisplayText } from './display-text.js';
import { useEffect, useState } from 'react';
import type { Product, ProductInput } from '../../../packages/contracts/domain.js';
import { api, json } from './api.js';
import { useRoutedState } from './workspace-route.js';
import { Modal } from './components/Modal.js';
import { InlineError, PageLoading } from './components/states.js';

export const historicalProductInput=(item:Product):ProductInput=>({name:item.name,brand:item.brand,specification:item.specification,variant:item.variant,audience:item.audience,origin:item.origin,claims:item.claims,notes:item.notes});

export function ProductHistoryPanel({product,onSaved}:{product:Product;onSaved:()=>void}){
  const [open,setOpen]=useRoutedState<boolean>('productHistory',false),[selectedVersion,setSelectedVersion]=useRoutedState<string|null>('productHistoryVersion',null),[snapshot,setSnapshot]=useState<Product|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirming,setConfirming]=useState(false),[readRevision,setReadRevision]=useState(0);
  const requestedVersion=Number(selectedVersion??product.version);
  const selected=Number.isInteger(requestedVersion)&&requestedVersion>=1&&requestedVersion<=product.version?requestedVersion:product.version;
  useEffect(()=>{setConfirming(false);},[product.id,product.version]);
  useEffect(()=>{if(!open)return;let active=true;setSnapshot(null);setError('');setConfirming(false);api<Product>(`/products/${product.id}/versions/${selected}`).then(value=>{if(active)setSnapshot(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[open,product.id,selected,readRevision]);
  async function restore(){if(!snapshot||snapshot.version===product.version||busy)return;if(!confirming){setConfirming(true);return;}setBusy(true);setError('');try{await api(`/products/${product.id}`,json({baseVersion:product.version,data:historicalProductInput(snapshot)},'PUT'));onSaved();setOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><button className="text-button" onClick={()=>setOpen(true)}>SKU 资料 v{product.version} · 查看历史</button>{open&&<Modal title="SKU 资料历史" onClose={()=>{if(!busy)setOpen(false);}} className="workspace-drawer" footer={<><button disabled={busy} onClick={()=>setOpen(false)}>关闭</button><button className="primary" disabled={busy||!snapshot||snapshot.version===product.version} onClick={()=>void restore()}>{busy?'正在保存新版本…':confirming?'确认恢复为新版本':'恢复为新版本'}</button></>}><label>资料版本<Select disabled={busy} value={selected} onChange={event=>setSelectedVersion(event.target.value)}>{Array.from({length:product.version},(_,i)=>product.version-i).map(version=><option key={version} value={version}>SKU 资料 v{version}{version===product.version?' · 当前':''}</option>)}</Select></label>{error?<InlineError onRetry={()=>setReadRevision(value=>value+1)}>{error}</InlineError>:snapshot?<><h3>{snapshot.name} · {snapshot.specification}</h3><p>{new Date(snapshot.updatedAt).toLocaleString('zh-CN')}</p><dl><dt>品牌</dt><dd>{snapshot.brand}</dd><dt>适用对象</dt><dd>{cleanDisplayText(snapshot.audience)}</dd><dt>产地</dt><dd>{cleanDisplayText(snapshot.origin)}</dd></dl><h3>该版本卖点</h3>{snapshot.claims.map(claim=><p key={claim.id}><strong>{claim.label}</strong> · {claim.text}</p>)}{confirming&&<p role="status">将这些资料保存为新版本。历史资料和商品归属保留，内容方案需重新核对资料版本。</p>}</>:<PageLoading>读取历史资料</PageLoading>}</Modal>}</>;
}
