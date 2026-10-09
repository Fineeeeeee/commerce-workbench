import { z } from 'zod';
import type { Kit, Product } from './domain.js';
import { claimSchema } from './domain.js';

const id = z.string().uuid(), text = (max: number) => z.string().trim().max(max);
export const projectStatuses = ['DRAFT','EVALUATING','APPROVED','DEVELOPING','READY','LAUNCHED','CLOSED'] as const;
export const projectStatusLabels: Record<typeof projectStatuses[number], string> = { DRAFT: '草稿', EVALUATING: '评估中', APPROVED: '已立项', DEVELOPING: '开发中', READY: '待上市', LAUNCHED: '已上市', CLOSED: '已关闭' };
export type Category = { id: string; parentId: string | null; code: string; name: string; template: CategoryTemplate | null };
export const categoryInputSchema = z.object({ name: text(80).min(1), parentId: id.nullable(), preset: z.enum(['facial_cleanser']).nullable() }).strict();
export type CategoryTemplate = { categoryId: string; version: number; name: string; fields: Array<{ code: string; name: string; type: 'text'|'multi_text'|'multi_select'; required: boolean; options?: string[] }> };
export const evidenceInputSchema = z.object({ title: text(160).min(1), sourceType: text(40).min(1), sourceUrl: z.union([z.literal(''), z.string().url().max(2000)]), summary: text(1000).min(1), rawContent: text(10000) }).strict();
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type MarketEvidence = EvidenceInput & { id: string; createdAt: string; references?: { projects: Array<{id:string;name:string}>; opportunities: Array<{id:string;title:string;status?:'DRAFT'|'READY'|'REJECTED'}> } };
export const projectTypes = ['NEW_PRODUCT', 'EXISTING_PRODUCT'] as const;
export type ProjectType = typeof projectTypes[number];
export const projectTypeLabels: Record<ProjectType, string> = { NEW_PRODUCT: '新品/机会型', EXISTING_PRODUCT: '已有商品运营型' };
const projectFieldsSchema = z.object({ categoryId: id.nullable(), name: text(120).min(1), objective: text(1000), positioning: text(500), constraints: z.array(text(200).min(1)).max(20), notes: text(2000) });
export const projectInputSchema = projectFieldsSchema.extend({ projectType: z.enum(projectTypes) }).strict();
export type ProjectInput = z.infer<typeof projectInputSchema>;
export const projectUpdateSchema = z.object({ expectedUpdatedAt: z.string().min(1), status: z.enum(projectStatuses), data: projectFieldsSchema.extend({ projectType: z.enum(projectTypes).nullable() }).strict(), checklist: z.object({ formulaConfirmed: z.boolean(), packagingConfirmed: z.boolean(), contentCompleted: z.boolean() }).strict(), note: text(1000).min(1) }).strict();
export type ProductProject = { id: string; categoryId: string | null; name: string; status: typeof projectStatuses[number]; projectType: ProjectType | null; brief: Pick<ProjectInput,'objective'|'positioning'|'constraints'|'notes'>; checklist: { formulaConfirmed: boolean; packagingConfirmed: boolean; contentCompleted: boolean }; createdAt: string; updatedAt: string };
export const spuInputSchema = z.object({ categoryId: id, brand: text(60).min(1), name: text(120).min(1), positioning: text(1000), targetAudience: text(500), coreClaims: z.array(text(120).min(1)).max(30), dynamicAttributes: z.record(z.string().max(80), z.union([z.string().max(1000), z.array(z.string().max(200)).max(50)])), status: z.enum(['DRAFT','ACTIVE','RETIRED']) }).strict();
export type SpuInput = z.infer<typeof spuInputSchema>;
export type Spu = SpuInput & { id: string; productProjectId: string; createdAt: string; updatedAt: string };
export const skuInputSchema = z.object({ variant: text(80), specification: text(80).min(1), origin: text(80), notes: text(1200), claims: z.array(claimSchema).max(20) }).strict();
export const deliveryInputSchema = z.object({ projectId: id, spuId: id, skuId: id.nullable(), channel: text(40).min(1), kitId: id.nullable(), kitVersion: z.number().int().positive().nullable(), deliveredAt: z.iso.datetime(), status: z.enum(['DRAFT','DELIVERED','WITHDRAWN']), notes: text(2000) }).strict().refine(v => (v.kitId === null) === (v.kitVersion === null), '内容版本必须同时提供设计稿与版本');
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;
export type ChannelDelivery = DeliveryInput & { id: string; createdAt: string };
export const feedbackInputSchema = z.object({ projectId: id, skuId: id, channel: text(40).min(1), periodStart: z.iso.date(), periodEnd: z.iso.date(), sales: z.number().int().nonnegative().nullable(), impressions: z.number().int().nonnegative().nullable(), clickRate: z.number().min(0).max(1).nullable(), conversionRate: z.number().min(0).max(1).nullable(), refundRate: z.number().min(0).max(1).nullable(), operationFeedback: text(3000), userFeedback: text(3000) }).strict().refine(v => v.periodStart <= v.periodEnd, '开始日期不能晚于结束日期');
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type BusinessFeedback = FeedbackInput & { id: string; createdAt: string };
export type ProjectEvent = { id: string; projectId: string; fromStatus: ProductProject['status'] | null; toStatus: ProductProject['status'] | null; eventType: string; note: string; createdAt: string };
export type ProjectDetail = { project: ProductProject; category: Category | null; evidence: MarketEvidence[]; spus: Array<Spu & { skus: Product[]; kits: Kit[] }>; independentSkus: Product[]; independentKits: Kit[]; deliveries: ChannelDelivery[]; feedback: BusinessFeedback[]; events: ProjectEvent[] };

export const nextProjectStatus: Partial<Record<ProductProject['status'], ProductProject['status']>> = { DRAFT:'EVALUATING',EVALUATING:'APPROVED',APPROVED:'DEVELOPING',DEVELOPING:'READY',READY:'LAUNCHED' };
export type ProjectProgress = { evidence:number; spus:number; skus:number; content:number; deliveries:number; feedback:number };
export type ProjectActionKind = 'evidence' | 'spu' | 'sku' | 'content' | 'delivery' | 'feedback' | 'checklist' | 'advance' | 'archive';
export function deriveProjectGuidance(project: ProductProject, progress: ProjectProgress) {
  const missing: string[] = [];
  if (!progress.evidence && project.projectType !== 'EXISTING_PRODUCT') missing.push('市场证据');
  if (!progress.spus && project.projectType !== 'EXISTING_PRODUCT') missing.push('产品定义 / SPU');
  if (!progress.skus) missing.push('可销售 SKU');
  if (!progress.content) missing.push('内容方案');
  if (['DEVELOPING','READY','LAUNCHED'].includes(project.status)) {
    const prefix=project.status==='LAUNCHED'?'历史记录待补录：':'项目清单待确认：';
    if (!project.checklist.formulaConfirmed) missing.push(`${prefix}配方确认`);
    if (!project.checklist.packagingConfirmed) missing.push(`${prefix}包装确认`);
    if (!project.checklist.contentCompleted) missing.push(`${prefix}内容完成确认`);
  }
  if (project.status === 'LAUNCHED' && !progress.deliveries) missing.push('渠道交付记录');
  if (project.status === 'LAUNCHED' && !progress.feedback) missing.push('经营反馈');
  let actionKind: ProjectActionKind = 'archive';
  if (project.status !== 'CLOSED') {
    if (!progress.evidence && project.projectType !== 'EXISTING_PRODUCT') actionKind = 'evidence';
    else if (!progress.spus && project.projectType !== 'EXISTING_PRODUCT') actionKind = 'spu';
    else if (!progress.skus) actionKind = 'sku';
    else if (!progress.content) actionKind = 'content';
    else if (project.status === 'LAUNCHED' && !progress.deliveries) actionKind = 'delivery';
    else if (project.status === 'LAUNCHED' && !progress.feedback) actionKind = 'feedback';
    else if (['DEVELOPING','READY','LAUNCHED'].includes(project.status) && (!project.checklist.formulaConfirmed || !project.checklist.packagingConfirmed || !project.checklist.contentCompleted)) actionKind = 'checklist';
    else if (nextProjectStatus[project.status]) actionKind = 'advance';
  }
  const actions: Record<ProjectActionKind, string> = {
    evidence: '从产品规划选一个机会',
    spu: '建立产品定义 / SPU',
    sku: '建立至少一个可销售 SKU',
    content: '为 SKU 建立内容方案',
    delivery: '记录本次渠道交付',
    feedback: '录入首期经营反馈',
    checklist: project.status==='LAUNCHED'?'补录项目历史确认记录':'核对项目确认清单',
    advance: `核对现有材料并推进至${projectStatusLabels[nextProjectStatus[project.status]!]}`,
    archive: project.status === 'CLOSED' ? '查看归档项目记录' : project.status === 'LAUNCHED' ? '查看已上市产品的交付与反馈' : '查看项目时间线与已有业务对象',
  };
  return { action: actions[actionKind], actionKind, missing, nextStatus: nextProjectStatus[project.status] ?? null };
}
