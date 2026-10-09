import type { ReactNode } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import { Modal } from './Modal.js';

export type TraceNode={key:string;type:string;label:string;current?:boolean;onOpen?:()=>void};
export function TraceContent({nodes,children}:{nodes:TraceNode[];children?:ReactNode}) {
  return <div className="source-trace-content"><ol>{nodes.map(node=><li key={node.key} className={node.current?'current':''}><span className="source-trace-icon"><Link2 size={17}/></span><div><small>{node.type}</small><strong>{node.label}</strong></div>{node.onOpen&&<button onClick={node.onOpen} aria-label={`查看${node.label}`}><ArrowRight size={15}/></button>}{node.current&&<span className="badge badge-neutral">当前对象</span>}</li>)}</ol>{children}</div>;
}
export function TraceDrawer({title,nodes,onClose,children}:{title:string;nodes:TraceNode[];onClose:()=>void;children?:ReactNode}) {
  return <Modal className="workspace-drawer" title={title} onClose={onClose}><TraceContent nodes={nodes}>{children}</TraceContent></Modal>;
}
