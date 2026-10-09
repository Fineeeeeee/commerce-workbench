import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '../../apps/web/src/components/Select.js';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/feedback.css';
import '../../apps/web/src/workspace.css';
import '../../apps/web/src/business.css';
import '../../apps/web/src/business-hierarchy.css';
import '../../apps/web/src/content-workbench.css';
import '../../apps/web/src/visual-coherence.css';
import '../../apps/web/src/work-queue.css';
import '../../apps/web/src/components/interaction-system.css';
import '../../apps/web/src/image-type-guide-panel.css';
import '../../apps/web/src/batch1.css';

function Regression() {
  const [result,setResult]=useState('检查中');
  useEffect(()=>{const frame=requestAnimationFrame(()=>{
    const checks=Array.from(document.querySelectorAll<HTMLElement>('[data-case]')).map(container=>{
      const control=container.querySelector<HTMLElement>('.ui-select')!,text=control.querySelector<HTMLElement>('.ui-select-trigger > span')!;
      const box=container.getBoundingClientRect(),field=control.getBoundingClientRect(),label=text.getBoundingClientRect(),button=control.querySelector('button')!.getBoundingClientRect();
      return field.width>=80&&label.width>=32&&field.right<=box.right+1&&button.right<=field.right+1&&control.scrollWidth<=control.clientWidth+1;
    });
    setResult(checks.every(Boolean)?'PASS：flex/grid 窄列不塌缩、不重叠、不越界':'FAIL：存在塌缩或越界');
  });return()=>cancelAnimationFrame(frame);},[]);
  return <main style={{padding:24}}><h1>Select 窄列回归</h1><p role="status">{result}</p><section data-case="flex" style={{display:'flex',width:240,gap:8,marginBottom:24}}><span style={{flex:'0 0 64px'}}>方案</span><Select defaultValue="kit" aria-label="flex 窄列方案"><option value="kit">真实组件的长内容方案名称</option></Select></section><section data-case="grid" style={{display:'grid',gridTemplateColumns:'minmax(0, 96px)',width:96}}><Select defaultValue="kit" aria-label="grid 窄列方案"><option value="kit">真实组件的长内容方案名称</option></Select></section></main>;
}
createRoot(document.getElementById('root')!).render(<Regression/>);
