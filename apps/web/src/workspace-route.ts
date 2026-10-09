import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
const rememberedUi=new Map<string,string>();

export function preserveWorkspaceUiHash(next:string,current:string){
  const [nextPath,nextQuery='']=next.split('?'),[currentPath,currentQuery='']=current.split('?');
  if(nextPath!==currentPath)return next;
  const params=new URLSearchParams(nextQuery);
  for(const [key,value] of new URLSearchParams(currentQuery))if(/^ui\.[a-zA-Z][a-zA-Z0-9-]{0,60}$/.test(key)&&/^[a-zA-Z0-9._-]{1,120}$/.test(value))params.set(key,value);
  return `${nextPath}${params.size?`?${params}`:''}`;
}

// UI locations do not dispatch hashchange: business navigation remains owned by App.
// Back/forward and reload restore these parameters without submitting operations.
export function useRoutedState<T extends string|boolean|null>(key:string,initial:T,allowed?:readonly string[],remember=false):[T,Dispatch<SetStateAction<T>>]{
  const initialRef=useRef(initial),allowedRef=useRef(allowed);allowedRef.current=allowed;
  const read=():T=>{
    if(typeof window==='undefined')return initialRef.current;
    const scope=key;
    const value=new URLSearchParams(window.location.hash.split('?')[1]??'').get(`ui.${key}`)??(remember?rememberedUi.get(scope)??null:null);
    if(value===null)return initialRef.current;
    if(typeof initialRef.current==='boolean')return (value==='1') as T;
    if(!/^[a-zA-Z0-9._-]{1,120}$/.test(value)||allowedRef.current&&!allowedRef.current.includes(value))return initialRef.current;
    return value as T;
  };
  const [value,setValue]=useState<T>(read),current=useRef(value);current.current=value;
  useEffect(()=>{const restore=()=>setValue(read());window.addEventListener('hashchange',restore);window.addEventListener('popstate',restore);window.addEventListener('workspace-route-change',restore);return()=>{window.removeEventListener('hashchange',restore);window.removeEventListener('popstate',restore);window.removeEventListener('workspace-route-change',restore);};},[key]);
  const update:Dispatch<SetStateAction<T>>=action=>{
    const next=typeof action==='function'?action(current.current):action;
    current.current=next;setValue(next);
    if(remember){if(next===null)rememberedUi.delete(key);else rememberedUi.set(key,typeof next==='boolean'?(next?'1':'0'):next);}
    const [path,query='']=window.location.hash.split('?'),params=new URLSearchParams(query),name=`ui.${key}`;
    if(next===null||next===initialRef.current)params.delete(name);else params.set(name,typeof next==='boolean'?(next?'1':'0'):next);
    const hash=`${path}${params.size?`?${params}`:''}`;
    if(hash!==window.location.hash){window.history.pushState(null,'',hash);window.dispatchEvent(new Event('workspace-route-change'));}
  };
  return [value,update];
}
