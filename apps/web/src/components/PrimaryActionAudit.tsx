import { useEffect, useRef } from 'react';

export const primaryActionSelector = 'button.primary, button.ui-button--primary';
/** Development guard only; modal/dialog actions are a separate interaction scope. */
export function PrimaryActionAudit() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!(import.meta as ImportMeta & {env?:{DEV?:boolean}}).env?.DEV) return;
    const page = marker.current?.closest('.standard-page');
    if (!page) return;
    let previous = 0;
    const check = () => {
      const count = [...page.querySelectorAll<HTMLElement>(primaryActionSelector)].filter(button => !button.closest('[role="dialog"],.modal-overlay') && button.getClientRects().length > 0).length;
      if (count > 1 && count !== previous) console.warn(`Multiple page primary actions: ${count}`);
      previous = count;
    };
    const observer = new MutationObserver(check);
    observer.observe(page, {subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open']});check();
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} hidden/>;
}
