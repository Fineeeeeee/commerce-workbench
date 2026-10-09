import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen } from 'lucide-react';

export function PageLoading({ children = '正在读取业务数据…' }: { children?: ReactNode }) { return <section className="workspace-skeleton" role="status" aria-busy="true"><span className="sr-only">{children}</span><div className="skeleton-heading"/><div className="skeleton-summary"><BlockSkeleton/><BlockSkeleton/><BlockSkeleton/></div><div className="skeleton-body"><BlockSkeleton/><BlockSkeleton/></div></section>; }
export function BlockSkeleton() { return <div className="block-skeleton" aria-hidden="true"><span/><span/><span/></div>; }
export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc: ReactNode; action?: ReactNode }) { return <div className="empty card empty-state"><div className="empty-illustration" aria-hidden="true">{icon??<FolderOpen size={32}/>}</div><h2>{title}</h2><p>{desc}</p>{action}</div>; }
export function InlineError({ children, onClose, onRetry }: { children: ReactNode; onClose?: () => void; onRetry?: () => void }) { return <div className="notice-error" role="alert"><AlertCircle size={16}/><span>{children}</span>{onRetry&&<button className="btn-xs" onClick={onRetry}>重新加载</button>}{onClose && <button className="btn-xs" onClick={onClose}>关闭</button>}</div>; }
export function PartialState({ done, total, onShowPending }: { done: number; total: number; onShowPending?: () => void }) { const pending = Math.max(0, total - done); return <div className="partial-state" role="status"><CheckCircle2 size={16}/><span>{done}/{total} 完成，{pending} 待核对</span>{pending > 0 && onShowPending && <button className="btn-xs" onClick={onShowPending}>查看待核对</button>}</div>; }
export function MissingDataHint({ children }: { children: ReactNode }) { return <p className="hint missing-data-hint">{children}</p>; }
export function AsyncBoundary({loading,error,empty=false,onRetry,emptyState,children}:{loading:boolean;error?:string;empty?:boolean;onRetry:()=>void;emptyState?:ReactNode;children:ReactNode}) {
  if(error)return <InlineError onRetry={onRetry}>{error}</InlineError>;
  if(loading)return <PageLoading/>;
  if(empty)return <>{emptyState??<EmptyState title="暂无记录" desc="创建或选择一个对象后，内容会显示在这里。"/>}</>;
  return <>{children}</>;
}
