import { deriveProjectGuidance, projectStatusLabels, type ProductProject, type ProjectProgress } from './business.js';
import type { MarketResearchJob } from './market-research.js';
import type { TemplateState } from './content-template.js';
import { deriveContentWorkflow } from './content-progress.js';
import { jdCollectionProfiles } from './jd-collection-profiles.js';

export type WorkTarget = { view: 'market' | 'projects' | 'studio'; marketTab?: 'research'|'opportunities'|'monitoring'; monitoringRunId?: string; batchId?: string; opportunityId?: string; projectId?: string; skuId?: string; kitId?: string; pageId?: string; contentAction?: 'review'|'candidate'|'copy'|'visual'; tab?: 'production' | 'history'; projectAction?: 'evidence' | 'spu' | 'sku' | 'content' | 'delivery' | 'feedback' | 'checklist' | 'advance' };
export type WorkItem = { id: string; kind: 'opportunity' | 'research' | 'project' | 'content' | 'monitoring' | 'manual'; title: string; context: string; reason: string; status: string; action: string; target: WorkTarget; priority: number; createdAt?: string };
export type OverviewWork = { attention: WorkItem[]; running: WorkItem[]; updatedAt: string };
export type ProjectWorkSource = { project: ProductProject; progress: ProjectProgress };
export type OpportunityWorkSource = { id: string; title: string; batchId: string; batchName: string; status: string; reviewable: boolean };
export type ContentWorkSource = { kitId: string; kitName: string; skuId: string; skuName: string; projectId: string | null; pages: Array<{ pageId: string; state: TemplateState; copyStatus: 'draft' | 'confirmed'; canGenerateCopy: boolean; canGenerateVisual: boolean; hasVisualCandidate?: boolean }> };
export type ContentJobSource = { id: string; kitId: string; skuId: string; kitName: string; skuName: string; projectId: string | null; operation: string; state: string; activeCount: number; createdAt?: string };
const researchProgressLabels: Record<string, string> = { CREATED: '准备中', COLLECTING: '采集中', NORMALIZING: '整理数据', IMPORTING: '导入中', ANALYZING: '分析中' };
const contentJobLabels: Record<string, string> = { queued: '排队中', running: '执行中', waiting_external: '等待生成结果', saving_result: '保存结果中' };

export function deriveOverviewWork(input: { research: MarketResearchJob[]; opportunities: OpportunityWorkSource[]; projects: ProjectWorkSource[]; content: ContentWorkSource[]; contentJobs: ContentJobSource[]; monitoringSignals?:Array<{id:string;label:string;batchId:string}>; monitoringRuns?:Array<{id:string;state:string;batchId:string|null;createdAt?:string}> }, updatedAt: string): OverviewWork {
  const attention: WorkItem[] = [], running: WorkItem[] = [];
  for(const run of input.monitoringRuns??[])if(run.state==='FAILED')attention.push({id:`monitoring:${run.id}`,kind:'monitoring',title:'市场快照需要继续处理',context:'京东联盟 · 洗发水',reason:'上次监控步骤未完成，先查看保存产物和恢复方式。',status:'失败',action:'查看并恢复',target:{view:'market',marketTab:'monitoring',monitoringRunId:run.id},priority:85});
  for(const signal of input.monitoringSignals??[])attention.push({id:`market-signal:${signal.id}`,kind:'monitoring',title:signal.label,context:'京东联盟 · 洗发水',reason:'两次同范围快照的程序统计变化达到关注阈值，需人工核验。',status:'待查看',action:'查看市场信号',target:{view:'market',batchId:signal.batchId},priority:75});
  for(const run of input.monitoringRuns??[])if(['CREATED','COLLECTING','NORMALIZING','IMPORTING','DETECTING'].includes(run.state))running.push({id:`monitoring:${run.id}`,kind:'monitoring',createdAt:run.createdAt,title:'京东联盟洗发水监控',context:'当前市场快照',reason:'正在采集或计算变化。',status:'进行中',action:'查看进度',target:{view:'market',marketTab:'monitoring',monitoringRunId:run.id,...(run.batchId?{batchId:run.batchId}:{})},priority:75});
  for (const opportunity of input.opportunities) if (opportunity.status === 'DRAFT' && opportunity.reviewable) attention.push({ id: `opportunity:${opportunity.id}`, kind: 'opportunity', title: opportunity.title, context: opportunity.batchName, reason: 'AI 候选需要人工核对证据、风险和结论。', status: '待审核', action: '审核机会', target: { view: 'market', batchId: opportunity.batchId, opportunityId: opportunity.id }, priority: 100 });
  for (const job of input.research) {
    const projectName = input.projects.find(item => item.project.id === job.initiatingProjectId)?.project.name;
    const profileName = jdCollectionProfiles[job.collectionProfile as keyof typeof jdCollectionProfiles]?.label ?? job.collectionProfile;
    const context = `${projectName ? `${projectName} · ` : ''}京东联盟 · ${profileName}`;
    if (job.state === 'FAILED') attention.push({ id: `research:${job.id}`, kind: 'research', createdAt:job.createdAt, title: '市场研究需要处理', context, reason: job.safeMessage || '研究任务失败，可以从当前阶段重试。', status: '失败', action: '查看并重试', target: { view: 'market', ...(job.marketBatchId ? { batchId: job.marketBatchId } : {}), ...(job.initiatingProjectId ? { projectId: job.initiatingProjectId } : {}) }, priority: 90 });
    else if (job.state === 'REVIEW_REQUIRED' && !input.opportunities.some(item => item.batchId === job.marketBatchId && item.status === 'DRAFT')) attention.push({ id: `research:${job.id}`, kind: 'research', createdAt:job.createdAt, title: '完成市场研究审核', context, reason: '本次机会候选已处理，研究任务仍等待人工完成审核。', status: '待完成', action: '完成审核', target: { view: 'market', ...(job.marketBatchId ? { batchId: job.marketBatchId } : {}), ...(job.initiatingProjectId ? { projectId: job.initiatingProjectId } : {}) }, priority: 80 });
    else if (['CREATED','COLLECTING','NORMALIZING','IMPORTING','ANALYZING'].includes(job.state)) running.push({ id: `research:${job.id}`, kind: 'research', createdAt:job.createdAt, title: `京东联盟 · ${profileName}市场研究`, context, reason: `已扫描 ${job.scannedCount} 条，有效样本 ${job.validCount} 条。`, status: researchProgressLabels[job.state] ?? job.state, action: '查看进度', target: { view: 'market', ...(job.marketBatchId ? { batchId: job.marketBatchId } : {}), ...(job.initiatingProjectId ? { projectId: job.initiatingProjectId } : {}) }, priority: 80 });
  }
  for (const { project, progress } of input.projects) {
    if (project.status === 'CLOSED') continue;
    const guidance = deriveProjectGuidance(project, progress);
    if (!guidance.missing.length && (project.status === 'LAUNCHED' || !guidance.nextStatus)) continue;
    const projectAction = guidance.actionKind === 'archive' ? undefined : guidance.actionKind;
    attention.push({ id: `project:${project.id}`, kind: 'project', title: guidance.action, context: project.name, reason: guidance.missing.length ? `当前缺少：${guidance.missing.join('、')}` : '已有业务对象可供核对，阶段变更仍由人工确认。', status: projectStatusLabels[project.status], action: ({ evidence: '关联市场证据', spu: '创建 SPU', sku: '创建 SKU', content: '进入内容制作', delivery: '记录渠道交付', feedback: '录入经营反馈', checklist: '核对确认清单', advance: '核对项目阶段' } as const)[projectAction ?? 'advance'], target: { view: 'projects', projectId: project.id, projectAction }, priority: guidance.missing.length ? 60 : 30 });
  }
  for (const kit of input.content) {
    const progress = deriveContentWorkflow(kit.pages);
    const review = progress.reviewPending;
    const candidate = progress.candidatePending;
    const copy = progress.copyReady;
    const visual = progress.visualReady;
    const count = review || candidate || copy || visual;
    if (!count) continue;
    const nextPage = kit.pages.find(page => review ? page.state === 'GENERATED' && page.copyStatus === 'confirmed' : candidate ? page.hasVisualCandidate && page.copyStatus === 'confirmed' && page.state === 'READY' : copy ? page.state !== 'GENERATING' && page.copyStatus === 'draft' && page.canGenerateCopy : page.copyStatus === 'confirmed' && !page.hasVisualCandidate && page.canGenerateVisual && ['READY','FAILED'].includes(page.state));
    attention.push({ id: `content:${kit.kitId}`, kind: 'content', title: review ? `${review} 个页面等待审核` : candidate ? `${candidate} 个视觉候选待核对` : copy ? `${copy} 个页面可制作文案` : `${visual} 个页面可生成视觉`, context: `${kit.skuName} · ${kit.kitName}`, reason: review ? '成图已产生，需要人工核对后才能交付。' : candidate ? '图片任务已完成，需核对候选能否用于当前页面。' : copy ? '产品事实已满足页面资料要求。' : '文案已确认，页面可进入视觉制作。', status: review ? '待审核' : candidate ? '待核对' : '可制作', action: review ? '审核页面' : candidate ? '查看视觉候选' : '继续制作', target: { view: 'studio', skuId: kit.skuId, kitId: kit.kitId, ...(nextPage ? { pageId: nextPage.pageId } : {}), ...(kit.projectId ? { projectId: kit.projectId } : {}), tab: 'production', contentAction: review ? 'review' : candidate ? 'candidate' : copy ? 'copy' : 'visual' }, priority: review ? 70 : candidate ? 65 : 40 });
  }
  for (const job of input.contentJobs) if (job.activeCount > 0) running.push({ id: `content-job:${job.id}`, kind: 'content', createdAt:job.createdAt, title: `${job.kitName} · ${job.operation === 'copy' ? '文案生成' : job.operation === 'image' ? '视觉生成' : '整套导出'}`, context: job.skuName, reason: `${job.activeCount} 项任务，${contentJobLabels[job.state] ?? '处理中'}。`, status: contentJobLabels[job.state] ?? '处理中', action: '查看任务', target: { view: 'studio', skuId: job.skuId, kitId: job.kitId, ...(job.projectId ? { projectId: job.projectId } : {}), tab: 'history' }, priority: 70 });
  attention.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  running.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { attention, running, updatedAt };
}
