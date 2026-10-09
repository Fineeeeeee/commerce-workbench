import type { ProductProject } from '../../../../packages/contracts/business.js';
import { nextProjectStatus, projectStatusLabels } from '../../../../packages/contracts/business.js';
import type { ProductOpportunity } from '../../../../packages/contracts/market-opportunity.js';
import { commonStatusLabels, statusToneClass } from '../status-vocabulary.js';

type ProjectStatus = ProductProject['status'];
type OpportunityStatus = ProductOpportunity['status'];
type ContentStatus = 'draft' | 'confirmed' | 'page_pending' | 'reviewed';

type Props =
  | { domain: 'project'; status: ProjectStatus; className?: string }
  | { domain: 'opportunity'; status: OpportunityStatus; className?: string }
  | { domain: 'content'; status: ContentStatus; className?: string };
type GenericProps={domain:'workflow';status:string;className?:string};

const opportunityLabels: Record<OpportunityStatus, string> = { DRAFT: '待审核', READY: '已通过', REJECTED: '已否决' };
const contentLabels: Record<ContentStatus, string> = { draft: '待确认', confirmed: '文案已确认', page_pending: '页面未审核', reviewed: '页面已审核' };
const projectActionLabels: Partial<Record<ProjectStatus, string>> = { DRAFT: '开始评估项目', EVALUATING: '完成评估并立项', APPROVED: '开始产品开发', DEVELOPING: '确认进入上市准备', READY: '确认产品上市' };

export function projectActionLabel(status: ProjectStatus): string | null {
  return nextProjectStatus[status] ? projectActionLabels[status] ?? null : null;
}

export function statusPresentation(props: Props|GenericProps): { label: string; tone: string } {
  if(props.domain==='workflow')return {label:commonStatusLabels[props.status.toUpperCase()]??props.status,tone:statusToneClass(props.status)};
  if (props.domain === 'project') return { label: projectStatusLabels[props.status], tone: statusToneClass(props.status) };
  if (props.domain === 'opportunity') return { label: opportunityLabels[props.status], tone: statusToneClass(props.status) };
  return { label: contentLabels[props.status], tone: statusToneClass(props.status) };
}

export function StatusTag(props: Props|GenericProps) {
  const { label, tone } = statusPresentation(props);
  return <span className={`badge ${tone}${props.className ? ` ${props.className}` : ''}`}>{label}</span>;
}

export const StatusBadge = StatusTag;
