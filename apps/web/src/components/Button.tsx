import type { ButtonHTMLAttributes } from 'react';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text'; busy?: boolean };
export function Button({ variant = 'secondary', busy = false, disabled, className = '', type = 'button', children, ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`ui-foundation ui-button ui-button--${variant} ${className}`.trim()}>{children}</button>;
}
