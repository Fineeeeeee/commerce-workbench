import { Select } from './Select.js';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../api.js';
import { type ProductProject, type ProjectDetail } from '../../../../packages/contracts/business.js';
import { overviewProjectStage,overviewProjectStages } from '../../../../packages/contracts/project-overview.js';
import type { WorkTarget } from '../../../../packages/contracts/overview-work.js';

export function FocusProject({ onWork }: { onWork:(target:WorkTarget)=>void }) {
  const [projects,setProjects]=useState<ProductProject[]>([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState<ProjectDetail|null>(null);
  useEffect(()=>{ let active=true; api<ProductProject[]>('/product-projects').then(items=>{if(active){setProjects(items);setSelected(items[0]?.id??'');}}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{ if(!selected)return;let active=true;setDetail(null);api<ProjectDetail>(`/product-projects/${selected}`).then(item=>{if(active)setDetail(item);}).catch(()=>{});return()=>{active=false;};},[selected]);
  if(!detail)return null;
  const project=detail.project;
  const stage=overviewProjectStage(project.status),stages=overviewProjectStages;
  return <section className="focus-project focus-project-compact">
    <div className="focus-project-main">
      <header className="focus-project-label"><label className="focus-project-switch"><span className="sr-only">选择重点项目</span><Select aria-label="选择重点项目" value={selected} onChange={event=>setSelected(event.target.value)}>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</Select></label><button className="text-button" onClick={()=>onWork({view:'projects',projectId:project.id})}>进入<ArrowRight size={15}/></button></header>
      <small className="focus-project-owner">负责人未设置</small>
    </div>
    <aside className="focus-project-stages"><ol aria-label="项目五阶段显示投影">{stages.map(status=><li key={status} className={status===stage?'current':'future'} aria-current={status===stage?'step':undefined}>{status}</li>)}</ol></aside>
  </section>;
}
