import {useId,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {CircleHelp} from 'lucide-react';

/** Short, non-interactive help; errors and decision-critical warnings remain inline. */
export function HelpHint({label,children}:{label:string;children:ReactNode}) {
  const id=useId();
  const [position,setPosition]=useState<{left:number;top:number;above:boolean;width:number}|null>(null);
  const show=(element:HTMLElement)=>{const rect=element.getBoundingClientRect(),width=Math.min(300,window.innerWidth-24),above=rect.bottom+160>window.innerHeight;setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:above?rect.top-8:rect.bottom+8,above,width});};
  return <span className="help-hint"><button type="button" className="help-hint-trigger" aria-label={label} aria-describedby={position?id:undefined} onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={()=>setPosition(null)} onFocus={event=>show(event.currentTarget)} onBlur={()=>setPosition(null)} onKeyDown={event=>{if(event.key==='Escape')setPosition(null);}}><CircleHelp size={14}/></button>{position&&createPortal(<span id={id} role="tooltip" className="help-hint-popup" style={{left:position.left,top:position.top,width:position.width,transform:position.above?'translateY(-100%)':undefined}}>{children}</span>,document.body)}</span>;
}
