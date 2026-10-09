import { z } from 'zod';
import type { WorkItem, WorkTarget } from './overview-work.js';

export const workSourceSchema = z.enum(['SYSTEM_GENERATED','MANAGER_ASSIGNED','SELF_CREATED','AI_RECOMMENDED']);
export const manualSourceSchema = z.enum(['MANAGER_ASSIGNED','SELF_CREATED','AI_RECOMMENDED']);
export const workPrioritySchema = z.enum(['LOW','NORMAL','HIGH','URGENT']);
export const workEntitySchema = z.enum(['PROJECT','SKU','OPPORTUNITY','CONTENT_KIT','CONTENT_PAGE']);
export const manualWorkInputSchema = z.object({
  title:z.string().trim().min(1).max(160),source:manualSourceSchema,priority:workPrioritySchema,
  deadline:z.iso.datetime({offset:true}).nullable(),objective:z.string().trim().min(1).max(2000),
  acceptanceCriteria:z.array(z.string().trim().min(1).max(400)).min(1).max(12),
  relatedEntityType:workEntitySchema,relatedEntityId:z.string().uuid(),
}).strict();
export type ManualWorkInput=z.infer<typeof manualWorkInputSchema>;
export type WorkSource=z.infer<typeof workSourceSchema>;
export type WorkPriority=z.infer<typeof workPrioritySchema>;
export type WorkEntity=z.infer<typeof workEntitySchema>;
export type ManualWorkItem=ManualWorkInput & {id:string;status:'OPEN'|'IN_PROGRESS'|'COMPLETED'|'CANCELED';target:WorkTarget;createdAt:string;updatedAt:string};
export type QueueItem=WorkItem & {source:WorkSource;deadline:string|null;rank:number;rankingReasons:string[];manualTaskId?:string};

const priorityWeight:Record<WorkPriority,number>={LOW:25,NORMAL:45,HIGH:70,URGENT:90};
export function rankManualWork(item:ManualWorkItem,now:string):{rank:number;reasons:string[]}{
  const reasons=[`${({LOW:'低',NORMAL:'普通',HIGH:'高',URGENT:'紧急'} as const)[item.priority]}优先级`];
  let rank=priorityWeight[item.priority];
  if(item.source==='MANAGER_ASSIGNED'){rank+=5;reasons.push('明确指派');}
  if(item.deadline){const hours=(Date.parse(item.deadline)-Date.parse(now))/3600000;
    if(hours<0){rank+=38;reasons.push('已过截止时间');}
    else if(hours<=24){rank+=30;reasons.push('24 小时内截止');}
    else if(hours<=72){rank+=18;reasons.push('3 天内截止');}
  }
  return {rank,reasons};
}
export function rankUnifiedQueue(projected:WorkItem[],manual:ManualWorkItem[],now:string):QueueItem[]{
  const items:QueueItem[]=[...projected.map(item=>({ ...item,source:'SYSTEM_GENERATED' as const,deadline:null,rank:Math.round(item.priority*0.85),rankingReasons:[item.reason] }))];
  for(const item of manual){
    if(!['OPEN','IN_PROGRESS'].includes(item.status))continue;
    const {rank,reasons}=rankManualWork(item,now);
    items.push({id:`manual:${item.id}`,kind:'manual',title:item.title,context:item.objective,reason:item.acceptanceCriteria.join('；'),status:item.status==='IN_PROGRESS'?'进行中':'待处理',action:'打开任务',target:item.target,priority:rank,source:item.source,deadline:item.deadline,rank,rankingReasons:reasons,manualTaskId:item.id});
  }
  return items.sort((a,b)=>b.rank-a.rank||(a.deadline??'~').localeCompare(b.deadline??'~')||a.id.localeCompare(b.id));
}
