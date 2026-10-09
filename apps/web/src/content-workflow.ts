import type { DesignPage } from '../../../packages/contracts/domain.js';
import { deriveContentWorkflow, type ContentStage, type WorkflowPage } from '../../../packages/contracts/content-progress.js';
export { deriveContentWorkflow };
export type { ContentStage, WorkflowPage, ContentWorkflow } from '../../../packages/contracts/content-progress.js';

export type ContentPageState = 'missing' | 'copy_ready' | 'copy_pending' | 'visual_ready' | 'candidate_ready' | 'generating' | 'review_pending' | 'reviewed' | 'failed';

export const contentStageLabels: Record<ContentStage, string> = {
  product: '产品资料', copy: '文案', visual: '视觉', review: '审核', history: '版本与导出',
};

export function eligibleCopyPageIds(pages: Array<Pick<WorkflowPage, 'pageId' | 'state' | 'copyStatus' | 'canGenerateCopy' | 'hasCopyCandidate'>>): string[] {
  return pages.filter(page => page.canGenerateCopy && page.copyStatus === 'draft' && !page.hasCopyCandidate && page.state !== 'GENERATING').map(page => page.pageId);
}

export function deriveContentPageState(overview: WorkflowPage, _page: DesignPage): ContentPageState {
  if (overview.state === 'REVIEWED') return 'reviewed';
  if (overview.state === 'GENERATING') return 'generating';
  if (overview.state === 'FAILED') return 'failed';
  if (overview.state === 'MISSING_DATA') return 'missing';
  if (overview.copyStatus === 'draft' && overview.hasCopyCandidate) return 'copy_pending';
  if (overview.copyStatus === 'draft') return overview.canGenerateCopy ? 'copy_ready' : 'copy_pending';
  if (overview.hasVisualCandidate) return 'candidate_ready';
  if (overview.state === 'GENERATED' && overview.copyStatus === 'confirmed') return 'review_pending';
  return overview.canGenerateVisual ? 'visual_ready' : 'copy_pending';
}

export const contentPageStateLabels: Record<ContentPageState,string> = { missing:'缺资料',copy_ready:'可生成文案',copy_pending:'待完善文案',visual_ready:'可生成视觉',candidate_ready:'视觉候选待核对',generating:'生成中',review_pending:'待审核',reviewed:'已审核',failed:'生成失败' };

export function contentPageConclusion(overview:WorkflowPage|undefined,page:DesignPage):string{
  if(!overview)return '正在读取本页状态。';
  const conclusions:Record<ContentPageState,string>={
    missing:'本页缺少已确认资料，请先补齐产品信息。',
    failed:'本页生成失败，请查看失败原因后重试。',
    generating:'本页正在生成，任务状态会自动同步。',
    copy_ready:'本页可生成文案候选，生成后仍需人工确认。',
    copy_pending:'本页文案尚未确认，请核对当前稿或已有候选。',
    visual_ready:'文案已确认，下一步生成或选择视觉候选。',
    candidate_ready:'已有视觉候选，请先核对并采用。',
    review_pending:'本页等待人工复核，请先查看质检与实际画面。',
    reviewed:'本页已审核；修改内容后需要重新审核。',
  };
  return conclusions[deriveContentPageState(overview,page)];
}
