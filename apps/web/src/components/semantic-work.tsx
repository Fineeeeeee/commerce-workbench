import { statusToneClass } from '../status-vocabulary.js';
import type { ReactNode } from 'react';
import type { ContentWorkflow } from '../../../../packages/contracts/content-progress.js';
import { contentProgressClaim } from '../../../../packages/contracts/content-progress.js';
import type { JobInfo } from '../../../../packages/contracts/tasks.js';
import type { WorkItem, WorkTarget } from '../../../../packages/contracts/overview-work.js';
import { ArrowRight } from 'lucide-react';
import { contentRevisionLabel } from '../display-text.js';
import { batchDisplayName, opportunityDisplayTitle } from '../display-text.js';

export function TaskCard({ item, onOpen }: { item: WorkItem; onOpen: (target: WorkTarget) => void }) {
  const tone=statusToneClass(item.status==='失败'?'FAILED':item.status==='待审核'?'REVIEW_REQUIRED':item.status);
  return <article className="overview-work-row"><div className="overview-work-copy"><strong>{item.kind === 'opportunity' ? opportunityDisplayTitle(item.title) : item.title}</strong><small>{item.kind === 'opportunity' ? batchDisplayName(item.context) : item.context}</small><p>{item.reason}</p></div><span className={`badge ${tone}`}>{item.status}</span><button onClick={() => onOpen(item.target)}>{item.action}<ArrowRight size={14}/></button></article>;
}

export function ProgressClaim({ workflow, onDetails }: { workflow: ContentWorkflow; onDetails: () => void }) {
  const claim = contentProgressClaim(workflow);
  return <div className="semantic-progress"><div><strong>{claim.headline}</strong><small>{claim.detail}</small></div><button className="text-button" onClick={onDetails}>查看逐页状态</button></div>;
}

export function VersionTag({ version, name, date, dirty }: { version: number; name?: string; date?: string; dirty?: boolean }) {
  return <span className="semantic-version" title={`${name ? `${name} · ` : ''}${contentRevisionLabel(version)}；编号仅属于当前内容方案，每次保存或采用候选新增修订。${date ? `记录时间：${new Date(date).toLocaleString('zh-CN')}` : ''}`}>{name ? `${name} · ` : ''}{contentRevisionLabel(version)}{dirty ? ' · 未保存' : ''}</span>;
}

const jobLabels: Record<string, string> = { queued: '排队中', active: '进行中', running: '进行中', waiting_external: '等待生成结果', saving_result: '保存结果中', succeeded: '已完成', failed: '生成失败', partial: '部分完成', cancelled: '已取消', needs_reconciliation: '结果需核对' };
export function AsyncTaskCard({ job, title, detail, action }: { job: JobInfo; title: string; detail?: string; action?: ReactNode }) {
  const completed = job.tasks.filter(task => task.state === 'succeeded').length;
  const failed = job.tasks.filter(task => task.state === 'failed').length;
  const error = job.tasks.find(task => task.error)?.error;
  return <div className="semantic-task-state" role="status"><strong>{title} · {jobLabels[job.state] ?? '处理中'}</strong><span>{completed}/{job.tasks.length} 项完成{failed ? ` · ${failed} 项失败` : ''}</span>{detail && <small>{detail}</small>}{error && <small role="alert">{error}</small>}{action}</div>;
}
