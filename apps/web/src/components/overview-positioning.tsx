import { useEffect, useState } from 'react';
import type { ProductProject, ProjectDetail } from '../../../../packages/contracts/business.js';
import { api } from '../api.js';

export function OverviewPositioning() {
  const [detail,setDetail]=useState<ProjectDetail|null>(null);
  useEffect(()=>{let active=true;api<ProductProject[]>('/product-projects').then(items=>{const project=items.find(item=>item.status!=='CLOSED');return project?api<ProjectDetail>(`/product-projects/${project.id}`):null;}).then(value=>{if(active)setDetail(value);}).catch(()=>{});return()=>{active=false;};},[]);
  const project=detail?.project,sku=detail?.spus.flatMap(item=>item.skus)[0]??detail?.independentSkus[0];
  const kit=detail?.spus.flatMap(item=>item.kits).find(item=>item.productId===sku?.id)??detail?.independentKits.find(item=>item.productId===sku?.id);
  const projectUrl=project?`#/projects?project=${project.id}`:null;
  const steps=[{label:'市场机会',href:project?'#/market?ui.marketTab=opportunities':null},{label:'项目',href:projectUrl},{label:'企划',href:projectUrl?`${projectUrl}&ui.projectStage=project-brief`:null},{label:'内容',href:projectUrl?(sku?`#/studio?sku=${sku.id}${kit?`&kit=${kit.id}`:''}&from=project&project=${project!.id}`:`${projectUrl}&ui.projectStage=project-content`):null}];
  return <section className="overview-positioning" aria-label="系统工作路径"><h2>从市场机会到商品图，一站式完成</h2><p>基于市场依据推进产品项目，确认企划与商品事实，再制作和人工审核内容。</p><nav aria-label="四步工作路径">{steps.map((step,index)=><span key={step.label}>{index>0&&<span className="path-arrow" aria-hidden="true">→</span>}{step.href?<a href={step.href}>{step.label}</a>:<span>{step.label}</span>}</span>)}</nav></section>;
}
