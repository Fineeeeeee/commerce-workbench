import { useEffect, useId, useLayoutEffect, useRef, useState, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

/** The native backing field preserves FormData, validation and existing change handlers. */
export function Select({className='',...props}:SelectHTMLAttributes<HTMLSelectElement>) {
  const native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null);
  const id=useId(),[open,setOpen]=useState(false),[revision,setRevision]=useState(0),[position,setPosition]=useState({left:0,top:0,width:0,maxHeight:320}),[cursor,setCursor]=useState(0),[label,setLabel]=useState(''),[validationError,setValidationError]=useState('');
  const options=Array.from(native.current?.options??[]).map(option=>({value:option.value,label:option.label,disabled:option.disabled}));
  const signature=JSON.stringify(options);
  useLayoutEffect(()=>{setRevision(value=>value+1);setLabel(Array.from(native.current?.closest('label')?.childNodes??[]).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim());},[props.children,props.value,props.defaultValue]);
  function reposition(){const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(rect.width,window.innerWidth-16),desired=Math.min(320,(native.current?.options.length??1)*42+8),below=window.innerHeight-rect.bottom-12,above=rect.top-12,upward=below<Math.min(desired,160)&&above>below,maxHeight=Math.max(40,Math.min(desired,upward?above:below));setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),top:Math.max(8,upward?rect.top-maxHeight-4:rect.bottom+4),width,maxHeight});}
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false);};reposition();document.addEventListener('mousedown',close);window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);return()=>{document.removeEventListener('mousedown',close);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};},[open]);
  useEffect(()=>{const form=native.current?.form;const reset=()=>setTimeout(()=>setRevision(value=>value+1),0);form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);},[]);
  function choose(index:number){const field=native.current,option=options[index];if(!field||!option||option.disabled)return;field.value=option.value;field.dispatchEvent(new Event('change',{bubbles:true}));setValidationError('');setRevision(value=>value+1);setOpen(false);trigger.current?.focus();}
  function show(){reposition();setCursor(Math.max(0,options.findIndex(option=>option.value===native.current?.value)));setOpen(true);}
  const selected=options.find(option=>option.value===native.current?.value);
  return <span className={`ui-select ${className}`} data-revision={revision} data-options={signature.length}>
    <select {...props} ref={native} hidden className="ui-select-native" tabIndex={-1} aria-hidden="true" onInvalid={event=>{props.onInvalid?.(event);event.preventDefault();setValidationError('请选择一项');trigger.current?.focus();}}/>
    <button ref={trigger} type="button" className="ui-select-trigger" disabled={props.disabled} aria-label={props['aria-label']??(label||undefined)} aria-labelledby={props['aria-labelledby']} role="combobox" aria-expanded={open} aria-controls={id} aria-haspopup="listbox" onClick={()=>open?setOpen(false):show()} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(!open)show();else setCursor(current=>Math.max(0,Math.min(options.length-1,current+(event.key==='ArrowDown'?1:-1))));}if(open&&['Enter',' '].includes(event.key)){event.preventDefault();choose(cursor);}}}><span>{selected?.label??'请选择'}</span><ChevronDown size={15}/></button>
    {validationError&&<small className="ui-select-error" role="alert">{validationError}</small>}
    {open&&createPortal(<div ref={popup} id={id} role="listbox" className="ui-select-options" style={position}>{options.map((option,index)=><button key={`${option.value}-${index}`} type="button" role="option" aria-selected={option.value===native.current?.value} disabled={option.disabled} className={index===cursor?'focused':''} onMouseEnter={()=>setCursor(index)} onClick={()=>choose(index)}>{option.label}</button>)}</div>,document.body)}
  </span>;
}
