import { z } from 'zod';

export const reviewReasonLabels = {
  EVIDENCE_INSUFFICIENT: '证据不足', FACT_ERROR: '事实错误', CLASSIFICATION_ERROR: '卖点或分类错误',
  DUPLICATE: '重复机会', BUSINESS_NOT_NEEDED: '业务暂不需要', OTHER: '其他原因',
} as const;
export const reviewReasonSchema = z.enum(['EVIDENCE_INSUFFICIENT','FACT_ERROR','CLASSIFICATION_ERROR','DUPLICATE','BUSINESS_NOT_NEEDED','OTHER']);
export const opportunityReviewSchema = z.object({
  decision: z.enum(['APPROVED','REJECTED']), reviewer: z.string().trim().min(1).max(100),
  note: z.string().trim().min(1).max(1000), reasonCodes: z.array(reviewReasonSchema).max(6).default([]),
}).strict().superRefine((value,ctx)=>{
  if(value.decision==='APPROVED'&&value.reasonCodes.length)ctx.addIssue({code:'custom',path:['reasonCodes'],message:'通过结论不填写驳回原因'});
  if(new Set(value.reasonCodes).size!==value.reasonCodes.length)ctx.addIssue({code:'custom',path:['reasonCodes'],message:'原因不能重复'});
});
export type HistoryReference = {
  opportunityId: string; evidenceId: string; batchId: string; batchName: string; categoryId: string;
  title: string; judgment: string; keywords: string[]; risks: string[];
  sourcePlatform: string; researchJobId: string|null;
  supportingRecords: Array<{id:string;title:string}>;
  decision: 'APPROVED'|'REJECTED'; reviewNote: string; reasonCodes: string[];
  reviewedAt: string; sourceDate: string;
};
export type MemoryHit = { memoryId:string; score:number; reference:HistoryReference };
export type HistoryRetrieval = {status:'USED'|'NO_INDEX'|'NO_MATCH'|'NO_CATEGORY';model:string|null;modelVersion:string|null;provider:string;latencyMs:number;dimension:number|null;requestId:string|null;inputFingerprint:string;hits:MemoryHit[]};
export type LearningRow = { id:string; title:string; categoryId:string|null; batchId:string; batchName:string; model:string; modelVersion:string|null; promptVersion:string; decision:'APPROVED'|'REJECTED'|null; note:string; reasonCodes:string[]; reviewedAt:string|null };
export function summarizeOpportunityReviews(rows:LearningRow[]) {
  const summarize=(items:LearningRow[])=>{
    const approved=items.filter(r=>r.decision==='APPROVED').length,rejected=items.filter(r=>r.decision==='REJECTED').length,reviewed=approved+rejected;
    return {total:items.length,approved,rejected,reviewed,pending:items.length-reviewed,adoptionRate:reviewed?approved/reviewed:null,coverage:items.length?reviewed/items.length:null};
  };
  const groups=new Map<string,LearningRow[]>();
  for(const row of rows){const key=JSON.stringify([row.model,row.modelVersion,row.promptVersion,row.categoryId]);groups.set(key,[...(groups.get(key)??[]),row]);}
  return {...summarize(rows),models:[...groups.values()].map(items=>({model:items[0]!.model,modelVersion:items[0]!.modelVersion,promptVersion:items[0]!.promptVersion,categoryId:items[0]!.categoryId,...summarize(items)})),
    reasons:[...Object.keys(reviewReasonLabels),'UNCLASSIFIED'].map(code=>({code,count:rows.filter(r=>r.decision==='REJECTED'&&(code==='UNCLASSIFIED'?!r.reasonCodes.length:r.reasonCodes.includes(code))).length})),rows};
}
export type OpportunityReviewMetrics=ReturnType<typeof summarizeOpportunityReviews>;
export function cosineSimilarity(a:number[],b:number[]):number {
  if(a.length!==b.length||!a.length||[...a,...b].some(v=>!Number.isFinite(v)))throw new Error('向量维度或数值无效');
  const norm=(v:number[])=>Math.sqrt(v.reduce((s,x)=>s+x*x,0));const denominator=norm(a)*norm(b);
  if(!denominator)throw new Error('零向量不能检索');
  return Math.max(-1,Math.min(1,a.reduce((s,x,i)=>s+x*b[i]!,0)/denominator));
}
