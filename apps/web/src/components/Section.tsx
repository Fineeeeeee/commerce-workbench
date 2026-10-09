import type { ReactNode } from 'react';

export function Section({ title, description, actions, status, children, className = '', id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; status?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`card section-block ${className}`.trim()}><div className="section-heading"><div><h2>{title}</h2>{description && <p className="muted small">{description}</p>}</div>{actions ?? status}</div>{children}</section>;
}
