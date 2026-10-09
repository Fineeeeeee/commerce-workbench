import { z } from 'zod';

export const currentMarketOpportunityPromptVersion = 'market-opportunity-v3' as const;

const id = z.string().uuid();
const shortId = z.string().regex(/^P\d{2,3}$/);
const citation = z.object({ text: z.string().trim().min(1).max(500), evidence_record_ids: z.array(id).min(1).max(12) }).strict();
const keyword = z.object({ term: z.string().trim().min(1).max(30), category: z.string().trim().min(1).max(40), evidence_record_ids: z.array(id).min(1).max(12) }).strict();
const modelCitation = z.object({ text: z.string().trim().min(1).max(500), evidence_record_ids: z.array(shortId).min(1).max(8) }).strict();
const modelKeyword = z.object({ term: z.string().trim().min(1).max(30), category: z.string().trim().min(1).max(40), evidence_record_ids: z.array(shortId).min(1).max(8) }).strict();

export const marketTextSignalsSchema = z.object({
  selling_point_groups: z.array(keyword).max(12),
}).strict();
export const marketTextSignalsModelSchema = z.object({ selling_point_groups: z.array(modelKeyword).max(12) }).strict();

export const marketAiAnalysisSchema = z.object({
  facts: z.array(citation).max(10),
  inferences: z.array(citation).max(10),
  opportunities: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(1200),
    price_band: z.string().trim().max(100),
    specifications: z.array(z.string().trim().min(1).max(100)).max(20),
    core_basis: z.array(citation).min(1).max(20),
    selling_points: z.array(keyword).min(1).max(20),
    risks: z.array(citation).max(20),
    missing_data: z.array(z.string().trim().min(1).max(160)).max(30),
    replicability: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
    replicability_reason: z.string().trim().max(1000),
    evidence_record_ids: z.array(id).min(1).max(20),
  }).strict()).min(1).max(3),
  risks: z.array(citation).max(30),
  missing_data: z.array(z.string().trim().min(1).max(160)).max(30),
}).strict();
export const marketAiAnalysisModelSchema = z.object({
  inferences: z.array(modelCitation).max(10),
  opportunities: z.array(z.object({
    name: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(1200), price_band: z.string().trim().max(100), specifications: z.array(z.string().trim().min(1).max(100)).max(20), core_basis: z.array(modelCitation).min(1).max(8), selling_points: z.array(modelKeyword).min(1).max(12), risks: z.array(modelCitation).max(8), missing_data: z.array(z.string().trim().min(1).max(160)).max(20), replicability: z.enum(['HIGH','MEDIUM','LOW','UNKNOWN']), replicability_reason: z.string().trim().max(1000), evidence_record_ids: z.array(shortId).min(1).max(8),
  }).strict()).min(1).max(3),
  risks: z.array(modelCitation).max(10), missing_data: z.array(z.string().trim().min(1).max(160)).max(20),
}).strict();

export type MarketTextSignals = z.infer<typeof marketTextSignalsSchema>;
export type MarketAiAnalysis = z.infer<typeof marketAiAnalysisSchema>;
export type MarketAiMetadata = {
  modelId: string; modelVersion: string; requestId: string; promptVersion: string;
  fallbackUsed: boolean; lightModelId: string; lightModelVersion: string; lightRequestId: string;
};

const shortIdsJson = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: '^P\\d{2,3}$' } } as const;
const citationJson = { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, evidence_record_ids: shortIdsJson }, required: ['text', 'evidence_record_ids'] } as const;
const keywordJson = { type: 'object', additionalProperties: false, properties: { term: { type: 'string' }, category: { type: 'string' }, evidence_record_ids: shortIdsJson }, required: ['term', 'category', 'evidence_record_ids'] } as const;
export const marketTextSignalsJsonSchema = { type: 'object', additionalProperties: false, properties: { selling_point_groups: { type: 'array', maxItems: 12, items: keywordJson } }, required: ['selling_point_groups'] } as const;
export const marketAiAnalysisJsonSchema = { type: 'object', additionalProperties: false, properties: {
  inferences: { type: 'array', maxItems: 10, items: citationJson },
  opportunities: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 }, summary: { type: 'string', minLength: 1, maxLength: 1200 }, price_band: { type: 'string', maxLength: 100 }, specifications: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } }, core_basis: { type: 'array', minItems: 1, maxItems: 8, items: citationJson }, selling_points: { type: 'array', minItems: 1, maxItems: 12, items: keywordJson }, risks: { type: 'array', maxItems: 8, items: citationJson }, missing_data: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 2, maxLength: 160 } }, replicability: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] }, replicability_reason: { type: 'string', maxLength: 1000 }, evidence_record_ids: shortIdsJson,
  }, required: ['name', 'summary', 'price_band', 'specifications', 'core_basis', 'selling_points', 'risks', 'missing_data', 'replicability', 'replicability_reason', 'evidence_record_ids'] } },
  risks: { type: 'array', maxItems: 10, items: citationJson }, missing_data: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 2, maxLength: 160 } },
}, required: ['inferences', 'opportunities', 'risks', 'missing_data'] } as const;
