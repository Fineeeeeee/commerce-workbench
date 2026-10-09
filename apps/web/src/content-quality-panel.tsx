import { InlineError } from './components/states.js';
import { useEffect, useRef, useState } from 'react';
import type { DesignPage, Kit } from '../../../packages/contracts/domain.js';
import { api, json } from './api.js';

type Quality = { id: string; page_id: string; kit_version: number; appliesToCurrentPage?: boolean; rule_status: 'PASS'|'FAIL'; ruleIssues: string[]; ai_status: 'NOT_RUN'|'PASS'|'REVIEW'|'FAILED'; aiIssues: string[]; human_decision: 'APPROVE'|'REJECT'|null; visualChecks?:Array<{code:string;description:string}> };
type Batch = { quality: Quality[] };

export function currentPageQuality(items: Quality[], pageId: string, kitVersion: number) {
  return {
    current: [...items].reverse().find(item => item.page_id === pageId && (item.appliesToCurrentPage ?? item.kit_version === kitVersion)) ?? null,
    stale: items.some(item => item.page_id === pageId && item.kit_version === kitVersion && item.appliesToCurrentPage === false),
  };
}

export function ContentQualityPanel({ batchId, kit, page, disabled, primaryAction=true, onSavedKit }: { batchId: string; kit: Kit; page: DesignPage; disabled: boolean; primaryAction?:boolean; onSavedKit: (kit: Kit) => void }) {
  const [quality, setQuality] = useState<Quality | null>(null);
  const [visualChecks,setVisualChecks]=useState<string[]>([]);
  const [staleQuality, setStaleQuality] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const context = `${batchId}:${kit.version}:${page.id}`;
  const currentContext = useRef(context); currentContext.current = context;
  async function load() { const batch = await api<Batch>(`/content-production-batches/${batchId}`); if (currentContext.current === context) { const selection = currentPageQuality(batch.quality, page.id, kit.version); setQuality(selection.current); setStaleQuality(selection.stale); } }
  useEffect(() => { let active = true; setQuality(null); setVisualChecks([]); setStaleQuality(false); setError(''); setBusy(false); load().catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [context]);
  async function evaluate() { if (busy) return; setBusy(true); setError(''); try { await api(`/content-production-batches/${batchId}/quality/${page.id}`, json({})); await load(); } catch (error) { if (currentContext.current === context) setError((error as Error).message); } finally { if (currentContext.current === context) setBusy(false); } }
  async function decide(decision: 'APPROVE'|'REJECT') { if (!quality || busy) return; setBusy(true); setError(''); try { await api(`/content-quality-results/${quality.id}/decision`, json({ decision,visualChecks })); const updated = await api<Kit>(`/kits/${kit.id}`); if (currentContext.current === context) { onSavedKit(updated); await load(); } } catch (error) { if (currentContext.current === context) setError((error as Error).message); } finally { if (currentContext.current === context) setBusy(false); } }
  return <div className="content-quality-inline"><strong>本页质量检查</strong>
    {!quality && !staleQuality && <button disabled={busy || disabled} onClick={() => void evaluate()}>检查当前已保存版本</button>}
    {!quality && staleQuality && <small>商品事实已更新，本次质检结论不再适用。请先修改并保存页面为新修订，再重新质检。</small>}
    {quality && <><span>规则检查：{quality.rule_status === 'PASS' ? '通过' : '未通过'} · AI 辅助检查：{({ PASS:'通过', REVIEW:'建议复核', FAILED:'未完成，需要人工复核', NOT_RUN:'待完成' } as const)[quality.ai_status]}</span>{[...quality.ruleIssues,...quality.aiIssues].map(issue => <small key={issue}>{issue}</small>)}
      {!quality.human_decision&&quality.visualChecks?.length? <fieldset><legend>人工视觉复核 · AI 可能漏判</legend>{quality.visualChecks.map(item=><label key={item.code}><input type="checkbox" checked={visualChecks.includes(item.code)} onChange={event=>setVisualChecks(values=>event.target.checked?[...values,item.code]:values.filter(code=>code!==item.code))}/>{item.description}</label>)}</fieldset>:null}
      {!quality.human_decision && <div><button className={primaryAction?'primary':''} disabled={busy || disabled || quality.rule_status !== 'PASS' || quality.visualChecks?.some(item=>!visualChecks.includes(item.code))} onClick={() => void decide('APPROVE')}>人工审核通过</button><button disabled={busy || disabled} onClick={() => void decide('REJECT')}>退回修改</button></div>}
      {quality.human_decision && <span>人工决定：{quality.human_decision === 'APPROVE' ? '通过' : '退回'}</span>}</>}
    {disabled && <small>请先保存当前页面修改。</small>}{error && <InlineError onRetry={()=>{setError('');void load().catch(e=>setError(e.message));}}>{error}</InlineError>}
  </div>;
}
