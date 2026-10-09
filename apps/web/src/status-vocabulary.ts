export type StatusTone='neutral'|'action'|'running'|'error';
export const statusTone=(status:string):StatusTone=>{
  const value=status.toUpperCase();
  if(['FAILED','TIMEOUT','TIMED_OUT','REJECTED','NEEDS_RECONCILIATION'].includes(value))return 'error';
  if(['QUEUED','RUNNING','PROCESSING','ACTIVE','SAVING_RESULT','WAITING_EXTERNAL','GENERATING','COLLECTING','NORMALIZING','IMPORTING','ANALYZING'].includes(value))return 'running';
  if(['DRAFT','PAGE_PENDING','REVIEW_REQUIRED','REVIEW_PENDING','NEEDS_REVIEW','PENDING','MISSING','CANDIDATE_READY'].includes(value))return 'action';
  return 'neutral';
};
export const statusToneClass=(status:string)=>({neutral:'badge-neutral',action:'badge-warning',running:'badge-progress',error:'badge-danger'}[statusTone(status)]);
export const commonStatusLabels:Record<string,string>={READY:'已就绪',DRAFT:'待确认',CONFIRMED:'已确认',SUPERSEDED:'历史版本',QUEUED:'排队中',PROCESSING:'处理中',RUNNING:'处理中',FAILED:'失败',TIMEOUT:'超时',SUCCEEDED:'已完成',COMPLETED:'已完成'};
export const businessVocabulary={opportunity:'市场机会',evidence:'市场依据',productBrief:'产品企划',listing:'渠道文案',content:'内容工坊',trace:'来源追溯'} as const;
