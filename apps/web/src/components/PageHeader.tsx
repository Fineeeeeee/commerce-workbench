import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './Button.js';

export function PageHeader({ eyebrow, title, description, actions, primaryAction, className = '' }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode; primaryAction?: Omit<ButtonProps, 'variant'>; className?: string }) {
  return <div className={`section-heading page-header ${className}`.trim()}><div>{eyebrow && /[\u4e00-\u9fff]/.test(eyebrow) && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{(actions || primaryAction) && <div className="page-header-actions">{actions}{primaryAction && <Button {...primaryAction} variant="primary"/>}</div>}</div>;
}
