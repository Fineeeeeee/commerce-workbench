import type { TemplateState } from './content-template.js';

export type ContentStage = 'product' | 'copy' | 'visual' | 'review' | 'history';
export type WorkflowPage = {
  pageId: string;
  state: TemplateState;
  copyStatus: 'draft' | 'confirmed';
  canGenerateCopy: boolean;
  canGenerateVisual: boolean;
  hasCopyCandidate?: boolean;
  hasVisualCandidate?: boolean;
};
export type ContentWorkflow = {
  current: ContentStage;
  total: number;
  copyConfirmed: number;
  copyReady: number;
  visualReady: number;
  candidatePending: number;
  generated: number;
  reviewPending: number;
  reviewed: number;
  missing: number;
  failed: number;
};

// Counters describe overlapping stages, not mutually exclusive page buckets.
export function contentProgressClaim(workflow: ContentWorkflow): { headline: string; detail: string } {
  const remaining = workflow.total - workflow.reviewed;
  const blockers = [workflow.missing ? `${workflow.missing} 页缺资料` : '', workflow.failed ? `${workflow.failed} 页生成失败` : ''].filter(Boolean);
  return {
    headline: `${workflow.total} 页中 ${workflow.reviewed} 页已审核，尚余 ${remaining} 页`,
    detail: blockers.length ? blockers.join(' · ') : '文案、视觉和审核可逐页并行；查看页面列表处理剩余页面',
  };
}

// A kit can contain pages at different production stages at the same time.
export function deriveContentWorkflow(pages: WorkflowPage[]): ContentWorkflow {
  const copyReady = pages.filter(page => page.copyStatus === 'draft' && page.canGenerateCopy && !page.hasCopyCandidate && page.state !== 'GENERATING').length;
  const candidatePending = pages.filter(page => page.copyStatus === 'confirmed' && page.hasVisualCandidate && page.state === 'READY').length;
  const visualReady = pages.filter(page => page.copyStatus === 'confirmed' && !page.hasVisualCandidate && page.canGenerateVisual && ['READY', 'FAILED'].includes(page.state)).length;
  const generated = pages.filter(page => ['GENERATED', 'REVIEWED'].includes(page.state)).length;
  const reviewed = pages.filter(page => page.state === 'REVIEWED').length;
  const reviewPending = pages.filter(page => page.state === 'GENERATED' && page.copyStatus === 'confirmed').length;
  const missing = pages.filter(page => page.state === 'MISSING_DATA').length;
  const failed = pages.filter(page => page.state === 'FAILED').length;
  const current: ContentStage = reviewPending ? 'review' : candidatePending ? 'visual' : copyReady ? 'copy' : visualReady ? 'visual' : generated || reviewed ? 'history' : 'product';
  return { current, total: pages.length, copyConfirmed: pages.filter(page => page.copyStatus === 'confirmed').length, copyReady, visualReady, candidatePending, generated, reviewPending, reviewed, missing, failed };
}
