import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

const cache=new Map<string,unknown>();
// Cache filters only. Server-derived records, approvals and task states never enter this map.
export function usePresentationState<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
  const [value,setValue]=useState<T>(()=>cache.has(key)?cache.get(key) as T:initial);
  useEffect(()=>{cache.set(key,value);},[key,value]);
  return [value,setValue];
}
