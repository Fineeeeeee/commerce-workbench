import type { HTMLAttributes } from 'react';

export function Card({ compact = false, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { compact?: boolean }) {
  return <div {...props} className={`ui-foundation ui-card${compact ? ' ui-card--compact' : ''} ${className}`.trim()}/>;
}
