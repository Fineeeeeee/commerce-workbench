import { deadlineNotice } from "../../../../packages/contracts/deadline.js";
import { ArrowRight } from 'lucide-react';
import { WorkIcon,workAppearance } from './work-appearance.js';
import type { QueueItem, WorkSource } from '../../../../packages/contracts/work-queue.js';
import { batchDisplayName, opportunityDisplayTitle } from '../display-text.js';

export const workSourceLabels: Record<WorkSource,string> = { SYSTEM_GENERATED:'系统待办', MANAGER_ASSIGNED:'领导指派', SELF_CREATED:'自建任务', AI_RECOMMENDED:'AI 建议待确认' };
export function QueueRow({ item, onOpen, actionLabel }: { item:QueueItem; onOpen:()=>void; actionLabel?:string }) {
  const title=item.kind==='opportunity'?opportunityDisplayTitle(item.title):item.title;
  const context=item.kind==='opportunity'?batchDisplayName(item.context):item.context;
  const date=item.deadline??item.createdAt;
  const overdue=deadlineNotice(item.deadline,item.status);
  return <button type="button" className="queue-summary-row queue-row-link" onClick={onOpen} aria-label={`${title}，${actionLabel??item.action}`}><WorkIcon appearance={workAppearance(item)}/><span className="queue-summary-copy"><strong title={title}>{title}</strong><span className="queue-row-context" title={context}>{context}</span>{item.source!=='SYSTEM_GENERATED'&&<small>{workSourceLabels[item.source]}</small>}</span><span className="queue-time-block"><time className="queue-summary-time" dateTime={date} title={date?(item.deadline?'任务截止时间':'对象创建时间'):'未记录任务时间'}>{date?`${item.deadline?'截止 ':''}${new Date(date).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`:''}</time>{overdue&&<span className="queue-overdue" role="status">{overdue}</span>}</span><ArrowRight size={14}/></button>;
}

export function QueueGroups({items,onOpen,limit}:{items:QueueItem[];onOpen:(item:QueueItem)=>void;limit?:number}) {
  const groups:Array<{key:string;items:QueueItem[]}>=[];
  for(const item of items){const key=item.source==='SYSTEM_GENERATED'&&item.kind==='opportunity'&&item.target.batchId?`${item.kind}:${item.target.batchId}:${item.status}`:item.source==='SYSTEM_GENERATED'&&item.kind==='content'&&item.target.kitId?`${item.kind}:${item.target.kitId}:${item.target.contentAction}:${item.status}`:item.id;const existing=groups.find(group=>group.key===key);if(existing)existing.items.push(item);else groups.push({key,items:[item]});}
  return <>{groups.slice(0,limit).map((group,index)=>group.items.length===1?<QueueRow key={`${group.key}-${index}`} item={group.items[0]!} onOpen={()=>onOpen(group.items[0]!)}/>:<details className="queue-task-group" key={`${group.key}-${index}`}><summary><WorkIcon appearance={workAppearance(group.items[0]!)}/><span><strong>{group.items.length} 个{group.items[0]!.kind==='opportunity'?'市场机会待审核':group.items[0]!.target.contentAction==='review'?'内容页面待审核':'内容页面待处理'}</strong><small>{batchDisplayName(group.items[0]!.context)}</small></span><span aria-hidden="true" className="queue-group-expand">展开</span></summary><div>{group.items.map(item=><QueueRow key={item.id} item={item} onOpen={()=>onOpen(item)}/>)}</div></details>)}</>;
}
