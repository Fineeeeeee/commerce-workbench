import { useEffect, useState } from 'react';
import { api, peekApi } from '../api.js';
import type { WorkQueueResponse } from '../work-queue-view.js';
import type { WorkTarget } from '../../../../packages/contracts/overview-work.js';
import { Button } from './Button.js';
import { presentWorkQueue } from '../work-queue-presentation.js';
import { InlineError } from './states.js';
import { useRoutedState } from '../workspace-route.js';

export function ProjectTasks({ onWork, projects }: { projects:Array<{id:string;name:string}>; onWork:(target:WorkTarget)=>void }) {
  const [queue,setQueue]=useState<WorkQueueResponse|null>(()=>peekApi<WorkQueueResponse>('/work-queue')),[error,setError]=useState('');
  const [open,setOpen]=useRoutedState<boolean>('projectTasks',true),[readRevision,setReadRevision]=useState(0);
  useEffect(()=>{let active=true;const load=()=>api<WorkQueueResponse>('/work-queue').then(value=>{if(active){setQueue(value);setError('');}}).catch(value=>{if(active)setError(value.message);});void load();const timer=setInterval(()=>void load(),5000);return()=>{active=false;clearInterval(timer);};},[readRevision]);
  const tasks=presentWorkQueue(queue?.attention??[]).filter(item=>item.target.projectId).slice(0,5);
  return <details className="project-my-tasks card" open={open} onToggle={event=>{if(event.currentTarget.open!==open)setOpen(event.currentTarget.open);}}><summary>我的待办 {queue&&<small>{tasks.length}</small>}</summary>{error&&<InlineError onRetry={()=>setReadRevision(value=>value+1)}>{error}</InlineError>}<div className="reference-queue-rows">{tasks.map(item=><div className="project-task-line" key={item.id}><span><strong title={item.title}>{item.title}</strong><small>{projects.find(project=>project.id===item.target.projectId)?.name}</small></span><Button onClick={()=>onWork(item.target)}>进入</Button></div>)}{queue&&!tasks.length&&<p className="muted">当前没有项目待办。</p>}</div></details>;
}
