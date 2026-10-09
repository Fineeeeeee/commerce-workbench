export type OperationFeedback={tone:'success'|'error';message:string};
export function operationFeedback(feedback:OperationFeedback){
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent<OperationFeedback>('workspace-operation-feedback',{detail:feedback}));
}
