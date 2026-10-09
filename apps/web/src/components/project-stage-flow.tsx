import { useEffect, useState, useRef } from 'react';
import type { ProjectDetail } from '../../../../packages/contracts/business.js';
import { api } from '../api.js';

export function projectStageSummaries(detail:ProjectDetail,facts:{brief:boolean;listing:boolean}|null) {
  const skus=[...detail.spus.flatMap(item=>item.skus),...detail.independentSkus];
  const kits=[...detail.spus.flatMap(item=>item.kits),...detail.independentKits];
  return [
    {id:'project-evidence',name:'市场依据',done:detail.evidence.length>0,summary:`${detail.evidence.length} 条已采用`},
    {id:'project-brief',name:detail.project.projectType==='NEW_PRODUCT'?'产品企划':'项目定义',done:detail.project.projectType==='NEW_PRODUCT'?facts?.brief===true:Boolean(detail.project.brief.objective.trim()),summary:detail.project.projectType==='NEW_PRODUCT'?(facts?facts.brief?'企划已确认':'企划待确认':'确认状态读取中'):(detail.project.brief.objective.trim()?'项目定义已填写':'项目定义待填写')},
    {id:'project-spu',name:'SPU / SKU',done:skus.length>0,summary:`${detail.spus.length} / ${skus.length}`,disabled:false},
    {id:'project-listing',name:'渠道文案',done:facts?.listing===true,summary:!skus.length?'等待 SKU':facts?facts.listing?'淘宝文案已确认':'淘宝文案待确认':'确认状态读取中',disabled:!skus.length},
    {id:'project-content',name:'内容工坊',done:kits.length>0&&kits.every(kit=>kit.pages.length>0&&kit.pages.every(page=>page.reviewed)),summary:`${kits.length} 套 · ${kits.reduce((sum,kit)=>sum+kit.pages.filter(page=>page.reviewed).length,0)} 页已审核`,disabled:!skus.length},
    {id:'project-delivery',name:'渠道交付',done:detail.deliveries.some(item=>item.status==='DELIVERED'),summary:`${detail.deliveries.length} 条记录`},
    {id:'project-feedback',name:'经营反馈',done:detail.feedback.length>0,summary:`${detail.feedback.length} 条记录`}
  ];
}

export function ProjectStageFlow({detail,onOpen,highlight=true,activeSection,defaultSection,onSelect}:{detail:ProjectDetail;onOpen:(section:string)=>void;highlight?:boolean;activeSection?:string|null;defaultSection?:string;onSelect?:(section:string)=>void}) {
  const flow=useRef<HTMLElement>(null);
  const [confirmed,setConfirmed]=useState<{projectId:string;brief:boolean;listing:boolean}|null>(null);
  const [readFailed,setReadFailed]=useState(false);
  const skus=[...detail.spus.flatMap(item=>item.skus),...detail.independentSkus];
  useEffect(()=>{let active=true;setConfirmed(null);setReadFailed(false);Promise.all([
    detail.project.projectType==='NEW_PRODUCT'?api<Array<{status:string}>>(`/product-projects/${detail.project.id}/product-briefs`):Promise.resolve([]),
    Promise.all(skus.map(sku=>api<Array<{status:string}>>(`/products/${sku.id}/listing-contents?channel=taobao`)))
  ]).then(([briefs,listings])=>{if(active)setConfirmed({projectId:detail.project.id,brief:briefs.some(item=>item.status==='CONFIRMED'),listing:listings.length>0&&listings.every(items=>items.some(item=>item.status==='CONFIRMED'))});}).catch(()=>{if(active)setReadFailed(true);});return()=>{active=false;};},[detail]);
  const facts=confirmed?.projectId===detail.project.id?confirmed:null;
  const stages=projectStageSummaries(detail,facts);
  const current=stages.findIndex(stage=>!stage.done);
  useEffect(()=>{if(!highlight)return;const container=flow.current,button=container?.querySelector<HTMLElement>('[aria-current="step"]');if(container&&button)container.scrollLeft=Math.max(0,button.offsetLeft-container.offsetLeft-(container.clientWidth-button.clientWidth)/2);},[current,highlight,detail.project.id]);
  const selected=stages.find(stage=>stage.id===(activeSection==='project-sku'?'project-spu':activeSection??defaultSection))??stages[Math.max(0,current)]!;
  const kits=[...detail.spus.flatMap(item=>item.kits),...detail.independentKits];
  const checklist=Object.values(detail.project.checklist);
  const metrics:Record<string,Array<[string,number]>>={
    'project-evidence':[['采用依据',detail.evidence.length],['有原始链接',detail.evidence.filter(item=>item.sourceUrl).length],['有追溯记录',detail.evidence.filter(item=>item.rawContent).length]],
    'project-brief':[['确认项',checklist.length],['已确认',checklist.filter(Boolean).length],['待确认',checklist.filter(value=>!value).length]],
    'project-spu':[['产品定义',detail.spus.length],['销售规格',skus.length],['独立规格',detail.independentSkus.length]],
    'project-listing':[['销售规格',skus.length],['内容方案',kits.length],['已有交付',detail.deliveries.length]],
    'project-content':[['内容方案',kits.length],['页面',kits.reduce((sum,kit)=>sum+kit.pages.length,0)],['已审核',kits.reduce((sum,kit)=>sum+kit.pages.filter(page=>page.reviewed).length,0)]],
    'project-delivery':[['交付记录',detail.deliveries.length],['已交付',detail.deliveries.filter(item=>item.status==='DELIVERED').length],['内容方案',kits.length]],
    'project-feedback':[['反馈记录',detail.feedback.length],['交付记录',detail.deliveries.length],['销售规格',skus.length]]
  };
  const unknown=(stage:typeof selected)=>!facts&&((stage.id==='project-listing'&&skus.length>0)||(stage.id==='project-brief'&&detail.project.projectType==='NEW_PRODUCT'));
  const missing=(stage:typeof selected)=>!stage.done||(stage.id==='project-brief'&&checklist.some(value=>!value));
  return <div className="project-stage-preview"><section ref={flow} className={`studio-stepper project-stage-workspace ${highlight?'':'project-stage-checklist'}`} aria-label={highlight?'项目业务阶段':'项目产物检查清单'}>{stages.map((stage,index)=><button key={stage.id} className={!highlight?(unknown(stage)?'future':missing(stage)?'needs-attention':'done'):stage.done?'done':index===current?'current':'future'} aria-current={highlight&&index===current?'step':undefined} aria-expanded={selected.id===stage.id} disabled={stage.disabled} onClick={()=>onSelect?onSelect(stage.id):onOpen(stage.id)}><span aria-hidden="true">{highlight?(stage.done?'✓':index+1):(unknown(stage)?'—':missing(stage)?'!':'✓')}</span><strong>{stage.name}</strong><small>{!highlight&&!unknown(stage)&&missing(stage)?'待核对 · ':''}{readFailed&&stage.summary==='确认状态读取中'?'确认状态未读取，点击查看':stage.summary}</small></button>)}</section><section className="project-stage-detail card" aria-label={`${selected.name}摘要`}><div><h3>{selected.name}</h3><div className="project-stage-metrics">{metrics[selected.id]?.map(([label,value])=><span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div></div><button type="button" disabled={selected.disabled} onClick={()=>onOpen(selected.id)}>查看{selected.name}</button></section></div>;
}
