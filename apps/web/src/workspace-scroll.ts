import { useEffect } from 'react';

const positions=new Map<string,number>();
export function rememberWorkspaceScroll(scope:string){positions.set(scope,window.scrollY);}
// Retain presentation only; business/task records continue to refresh from the server.
export function useWorkspaceScroll(scope:string){
  useEffect(()=>{
    const target=positions.get(scope)??0;
    let restoring=true;
    const restore=()=>{if(restoring){window.scrollTo(0,target);if(window.scrollY>=target)restoring=false;}};
    const stop=()=>{restoring=false;};
    const remember=()=>{if(!restoring)rememberWorkspaceScroll(scope);};
    const observer=new ResizeObserver(restore);observer.observe(document.body);
    const frame=requestAnimationFrame(restore);
    window.addEventListener('wheel',stop,{passive:true});window.addEventListener('touchstart',stop,{passive:true});
    window.addEventListener('scroll',remember,{passive:true});
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('wheel',stop);window.removeEventListener('touchstart',stop);window.removeEventListener('scroll',remember);};
  },[scope]);
}
