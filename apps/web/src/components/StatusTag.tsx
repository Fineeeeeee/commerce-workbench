import { Circle, CircleAlert, Clock3, LoaderCircle, Check, CircleX, TimerOff, CircleHelp } from 'lucide-react';
import { resolveStatus, type StatusDomain } from '../status-catalog.js';

const icons = { dot: Circle, attention: CircleAlert, queue: Clock3, processing: LoaderCircle, check: Check, error: CircleX, timeout: TimerOff, unknown: CircleHelp };
function environment(): 'development' | 'test' | 'production' {
  const vite = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
  if (vite) return vite.PROD ? 'production' : 'development';
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'production' ? 'production' : 'test';
}
export function StatusTag({ domain, status, className = '' }: { domain: StatusDomain; status: string | null; className?: string }) {
  const presentation = resolveStatus(domain, status, environment());
  const Icon = icons[presentation.icon];
  return <span className={`ui-foundation ui-status ui-status--${presentation.tone} ${className}`.trim()} title={presentation.detail} data-status-icon={presentation.icon}>
    <Icon size={13} aria-hidden="true"/><span>{presentation.label}</span>
  </span>;
}
