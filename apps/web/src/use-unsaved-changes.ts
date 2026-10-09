import { useEffect } from 'react';

export function useUnsavedChanges(dirty:boolean) {
  useEffect(()=>{
    if(!dirty)return;
    const unload=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const leave=(event:Event)=>{if(!window.confirm('有未保存更改。离开将丢弃这些修改，是否离开？'))event.preventDefault();};
    window.addEventListener('beforeunload',unload);
    window.addEventListener('workspace-before-leave',leave);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('workspace-before-leave',leave);};
  },[dirty]);
}
