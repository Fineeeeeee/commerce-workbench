import { useEffect,useState } from 'react';
import type { DesignPage,Kit } from '../../../packages/contracts/domain.js';
import { api } from './api.js';

export function VisualReviewChecklist({kit,page,onChange}:{kit:Kit;page:DesignPage;onChange:(value:Partial<DesignPage>)=>void}){
  const [checks,setChecks]=useState<Array<{code:string;description:string}>>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;setChecks([]);setError('');api<{checks:Array<{code:string;description:string}>}>(`/kits/${kit.id}/pages/${page.id}/visual-checklist`).then(result=>{if(active)setChecks(result.checks);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[kit.id,page.id,page.visualArtifactId]);
  if(page.visualMode!=='REFERENCE_IMAGE')return null;
  return <fieldset><legend>人工视觉复核 · AI 可能漏判</legend>{checks.map(check=><label key={check.code}><input type="checkbox" checked={page.visualReviewChecks?.includes(check.code)??false} onChange={event=>onChange({visualReviewChecks:event.target.checked?[...(page.visualReviewChecks??[]),check.code]:(page.visualReviewChecks??[]).filter(code=>code!==check.code)})}/>{check.description}</label>)}{error&&<p role="alert">{error}</p>}</fieldset>;
}
