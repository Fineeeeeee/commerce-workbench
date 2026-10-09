import { z } from 'zod';
import { taobaoDailyCarePages } from './content-template.js';

const text = (max: number) => z.string().trim().max(max);
const id = z.string().uuid();
export const claimSchema = z.object({
  id, label: text(16).min(1), text: text(180).min(1), source: text(160).min(1),
  status: z.enum(['provided', 'approved', 'pending']),
}).strict();
export const productInputSchema = z.object({
  name: text(80).min(1), brand: text(40).min(1), variant: text(60), specification: text(40).min(1),
  audience: text(100), origin: text(80), notes: text(1200), claims: z.array(claimSchema).max(20),
}).strict().refine(p => new Set(p.claims.map(c => c.id)).size === p.claims.length, '卖点标识不能重复');
export type ProductInput = z.infer<typeof productInputSchema>;
export type Product = ProductInput & { id: string; spuId?: string | null; version: number; updatedAt: string };
export type Asset = { id: string; productId: string; name: string; mime: string; width: number; height: number; source: string; createdAt: string };

export const pageSchema = z.object({
  id, kind: z.enum(['main', 'detail']), purpose: text(40).min(1),
  templateId: z.string().regex(/^[FD]\d{2}$/).optional(),
  generationMode: z.enum(['fixed','creative','evidence']).optional(),
  headline: text(36), subtitle: text(64), body: text(180),
  claimIds: z.array(id).max(20), assetId: id.nullable(),
  layout: z.enum(['hero', 'editorial', 'focus']),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  productScale: z.number().min(0.75).max(1.15),
  visualArtifactId: id.nullable().default(null),
  visualMode: z.enum(['BACKGROUND','REFERENCE_IMAGE']).optional(),
  visualReviewChecks: z.array(z.string().max(80)).max(40).optional(),
  copyStatus: z.enum(['draft','confirmed']).default('draft'),
  sourceFactIds: z.array(z.string().max(100)).max(40).default([]),
  reviewed: z.boolean(),
}).strict();
export type DesignPage = z.infer<typeof pageSchema>;
export const kitInputSchema = z.object({
  name: text(80).min(1), productVersion: z.number().int().positive(),
  pages: z.array(pageSchema).min(16).max(25),
}).strict().superRefine((kit, ctx) => {
  if (kit.pages.filter(p => p.kind === 'main').length !== 5) ctx.addIssue({ code: 'custom', message: '一套需要恰好 5 张主图' });
  const details = kit.pages.filter(p => p.kind === 'detail').length;
  if (details < 11 || details > 20) ctx.addIssue({ code: 'custom', message: '详情图数量须为 11–20 张' });
  if (new Set(kit.pages.map(p => p.id)).size !== kit.pages.length) ctx.addIssue({ code: 'custom', message: '页面标识不能重复' });
  if (kit.pages.slice(0, 5).some(p => p.kind !== 'main')) ctx.addIssue({ code: 'custom', message: '主图必须排在详情图前' });
});
export type KitInput = z.infer<typeof kitInputSchema>;
export type Kit = KitInput & { id: string; productId: string; spuId?: string | null; skuId?: string | null; channel?: string; contentTemplateId?: string | null; version: number; updatedAt: string };
export type Revision = { version: number; createdAt: string };
export type ExportRecord = { id: string; kitId: string; kitVersion: number; state: 'running' | 'succeeded' | 'failed'; createdAt: string; error: string | null };

export const mainPurposes = ['产品首图', '核心卖点', '产品特点', '适用需求', '规格信息'];
export const detailPurposes = ['产品定位', '核心卖点', '特点说明一', '特点说明二', '特点说明三', '使用体验', '细节展示', '使用场景', '适用对象', '规格展示', '使用资料', '产品信息'];

export function createPages(product: ProductInput, detailCount = 12, assetId: string | null = null): DesignPage[] {
  const definitions = detailCount === 12 ? taobaoDailyCarePages : [...taobaoDailyCarePages.slice(0,5), ...Array.from({ length: detailCount }, (_, i) => taobaoDailyCarePages[5 + i] ?? { id: `D${String(i + 1).padStart(2,'0')}`, kind: 'detail' as const, name: `补充说明 ${i + 1}`, purpose: `补充说明 ${i + 1}`, generationMode: 'fixed' as const })];
  return definitions.map((definition, i) => ({
    id: crypto.randomUUID(), kind: definition.kind, purpose: definition.purpose, templateId: definition.id, generationMode: definition.generationMode,
    headline: i === 0 ? product.variant || product.name.slice(0, 36) : '',
    subtitle: i === 0 ? `${product.brand} · ${product.specification}`.slice(0, 64) : '',
    body: '', claimIds: [], assetId, visualArtifactId: null,
    layout: i % 3 === 0 ? 'hero' : i % 3 === 1 ? 'editorial' : 'focus',
    background: '#eef4f5', accent: '#28545e', productScale: 1, copyStatus: 'draft', sourceFactIds: [], reviewed: false,
  }));
}

export function pageIssues(page: DesignPage, product: ProductInput, assets: Asset[]): string[] {
  const issues: string[] = [];
  if (!page.purpose.trim()) issues.push('填写本页用途');
  if (!page.headline.trim()) issues.push('填写主标题');
  if (page.kind === 'detail' && !page.body.trim()) issues.push('补充详情正文');
  if (!page.assetId || !assets.some(a => a.id === page.assetId)) issues.push('选择本商品素材');
  for (const claimId of page.claimIds) {
    const claim = product.claims.find(c => c.id === claimId);
    if (!claim) issues.push('引用的卖点已不存在');
    else if (claim.status === 'pending') issues.push(`核实「${claim.label}」`);
  }
  return [...new Set(issues)];
}

export function normalizeReviews(next: KitInput, previous: Kit | null): KitInput {
  return { ...next, pages: next.pages.map(page => {
    const old = previous?.pages.find(p => p.id === page.id);
    if (!old) return { ...page, reviewed: false };
    const fields: Array<Exclude<keyof DesignPage, 'reviewed'>> = ['id', 'kind', 'purpose', 'templateId', 'generationMode', 'headline', 'subtitle', 'body', 'claimIds', 'assetId', 'layout', 'background', 'accent', 'productScale', 'visualArtifactId', 'visualMode', 'copyStatus', 'sourceFactIds'];
    const changed = fields.some(field => JSON.stringify(page[field] ?? null) !== JSON.stringify(old[field] ?? null)) || next.productVersion !== previous?.productVersion;
    return { ...page, reviewed: changed ? false : page.reviewed };
  }) };
}
