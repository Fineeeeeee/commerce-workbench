import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';

export function pageGenerationJob(jobs:JobInfo[],operation:string,pageId:string) {
  const related=jobs.filter(job=>job.operation===operation&&job.tasks.some(task=>task.pageId===pageId));
  return related.find(job=>!terminal(job.state))??related[0]??null;
}

// Restore from persisted server jobs, including jobs submitted by another panel/session.
export function useContentJobs(kitId:string) {
  const [jobs,setJobs]=useState<JobInfo[]>([]),[error,setError]=useState('');
  const wake=useRef<()=>void>(()=>{});
  useEffect(()=>{
    let active=true,inFlight=false,requested=false,timer:ReturnType<typeof setTimeout>|undefined;
    setJobs([]);setError('');
    if(!kitId){wake.current=()=>{};return;}
    async function poll(){
      if(!active)return;
      if(inFlight){requested=true;return;}
      if(timer)clearTimeout(timer);
      inFlight=true;
      try {
        const all:JobInfo[]=[];let cursor:string|null=null;
        do {
          const page: {items:JobInfo[];nextCursor:string|null}=await api(`/jobs?kitId=${kitId}&limit=100${cursor?`&cursor=${cursor}`:''}`);
          all.push(...page.items);cursor=page.nextCursor;
        }while(cursor&&active);
        if(active){setJobs(all);setError('');}
      }catch(e){if(active)setError(e instanceof Error?e.message:'暂时无法同步任务状态，正在重新连接');}
      finally{inFlight=false;if(active)timer=setTimeout(()=>void poll(),requested?0:document.hidden?10000:2500);requested=false;}
    }
    wake.current=()=>void poll();
    const refresh=()=>void poll();
    window.addEventListener('commerce-content-job',refresh);
    void poll();
    return()=>{active=false;if(timer)clearTimeout(timer);window.removeEventListener('commerce-content-job',refresh);};
  },[kitId]);
  return {jobs,error,refresh:()=>wake.current()};
}

export function notifyContentJob(){window.dispatchEvent(new Event('commerce-content-job'));}
