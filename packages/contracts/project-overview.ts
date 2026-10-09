import type { ProductProject } from './business.js';

// 首页展示归并，不参与后端生命周期校验或迁移。
export const overviewProjectStages=['草稿','评估中','进行中','待交付','已结束'] as const;
export function overviewProjectStage(status:ProductProject['status']):typeof overviewProjectStages[number] {
  return {DRAFT:'草稿',EVALUATING:'评估中',APPROVED:'进行中',DEVELOPING:'进行中',READY:'待交付',LAUNCHED:'进行中',CLOSED:'已结束'}[status] as typeof overviewProjectStages[number];
}
