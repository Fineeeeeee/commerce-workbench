import { ClipboardCheck, FileText, Image, Package, Radar, TrendingUp, type LucideIcon } from 'lucide-react';
import type { QueueItem } from '../../../../packages/contracts/work-queue.js';

type Appearance={Icon:LucideIcon;tone:'blue'|'purple'|'green'|'orange';label:string};
export function workAppearance(item:Pick<QueueItem,'kind'|'target'>):Appearance {
  if(item.kind==='manual')return workAppearance({kind:item.target.view==='studio'?'content':item.target.view==='market'?'research':'project',target:item.target});
  if(item.kind==='opportunity')return {Icon:TrendingUp,tone:'green',label:'市场机会'};
  if(item.kind==='research'||item.kind==='monitoring')return {Icon:Radar,tone:'purple',label:'市场研究'};
  if(item.kind==='content')return {Icon:Image,tone:'orange',label:'内容制作'};
  return {Icon:Package,tone:'blue',label:'产品项目'};
}
export function eventAppearance(type:string):Appearance {
  if(type.includes('COPY'))return {Icon:FileText,tone:'purple',label:'文案确认'};
  if(type.includes('VISUAL'))return {Icon:Image,tone:'blue',label:'视觉更新'};
  if(type.startsWith('CONTENT_'))return {Icon:ClipboardCheck,tone:'orange',label:'内容更新'};
  if(type.includes('BRIEF'))return {Icon:FileText,tone:'purple',label:'产品企划'};
  if(type.includes('OPPORTUNITY')||type.includes('EVIDENCE'))return {Icon:TrendingUp,tone:'green',label:'市场依据'};
  if(type.includes('SKU')||type.includes('SPU'))return {Icon:Package,tone:'orange',label:'商品资料'};
  return {Icon:ClipboardCheck,tone:'purple',label:'项目更新'};
}
export function eventTitle(type:string,note:string):string {
  const page=note.match(/\b[FD]\d{2}\b/)?.[0];
  return `${page?`${page} · `:''}${eventAppearance(type).label}`;
}
export function WorkIcon({appearance}:{appearance:Appearance}) {
  const {Icon,tone}=appearance;
  return <span className={`work-queue-row-icon work-icon-${tone}`} aria-hidden="true"><Icon size={20}/></span>;
}
