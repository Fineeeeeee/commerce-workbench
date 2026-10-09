import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export function Modal({ title, eyebrow, onClose, children, footer, compact = false, className = '' }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; compact?: boolean; className?: string }) {
  const titleId = useId(), dialogRef = useRef<HTMLElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current; const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
    (dialog?.querySelector<HTMLElement>('[data-initial-focus]') ?? focusable()[0])?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; } if (event.key !== 'Tab') return; const items = focusable(); if (!items.length) return; const first = items[0]!, last = items[items.length - 1]!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus.current?.focus(); };
  }, []);
  const content = <div className="overlay"><section ref={dialogRef} className={`modal ${compact ? 'compact' : ''} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}><header><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id={titleId}>{title}</h2></div><button className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X size={20}/></button></header>{children}{footer && <footer>{footer}</footer>}</section></div>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
