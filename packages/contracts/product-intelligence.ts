import { z } from 'zod';

const uuid = z.string().uuid();
const sentence = z.string().trim().min(1).max(600);
export const briefSuggestionSchema = z.object({ text: sentence, evidenceIds: z.array(uuid).max(12) }).strict();
export const briefAiSchema = z.object({
  marketOpportunity: briefSuggestionSchema,
  targetUserAndScene: briefSuggestionSchema,
  priceBand: briefSuggestionSchema,
  specification: briefSuggestionSchema,
  coreSellingPoints: z.array(briefSuggestionSchema).min(1).max(6),
  differentiation: briefSuggestionSchema,
  productDesign: briefSuggestionSchema,
  risks: z.array(briefSuggestionSchema).min(1).max(8),
  pendingValidation: z.array(sentence).min(1).max(12),
}).strict();
export type BriefAi = z.infer<typeof briefAiSchema>;
export const briefContentSchema = z.object({
  marketFacts: z.array(z.object({ text: sentence, batchId: uuid, evidenceEntryIds: z.array(uuid).min(1).max(12) }).strict()).max(8),
  suggestions: briefAiSchema,
  scopeNote: sentence,
}).strict();
export type BriefContent = z.infer<typeof briefContentSchema>;

export const listingFactTextSchema = z.object({
  text: sentence,
  sourceFactIds: z.array(z.string().min(1).max(120)).min(1).max(20),
}).strict();
export const listingCandidateSchema = z.object({
  titles: z.array(z.object({ text: z.string().trim().min(1).max(160), sourceFactIds: z.array(z.string().min(1).max(120)).min(1).max(20), keywordTerms: z.array(z.string().min(1).max(40)).max(12) }).strict()).min(1).max(3),
  suggestedKeywords: z.array(z.object({ term: z.string().trim().min(1).max(40), sourceFactIds: z.array(z.string().min(1).max(120)).max(12), marketEntryIds: z.array(uuid).max(8) }).strict()).max(12),
  sellingPoints: z.array(listingFactTextSchema.extend({text: z.string().trim().min(1).max(80)})).min(1).max(5),
  detailSuggestions: z.array(listingFactTextSchema).min(1).max(8),
  risks: z.array(sentence).max(8),
}).strict();
export type ListingCandidate = z.infer<typeof listingCandidateSchema>;
export const listingContentSchema = listingCandidateSchema.extend({
  sourceBatchId: uuid.optional(),
  scopeNote: sentence.optional(),
  confirmedTitleFactIds: z.array(z.string().min(1).max(120)).min(1).max(20).optional(),
}).strict();

const citedTextJson = { type:'object',additionalProperties:false,required:['text','evidenceIds'],properties:{text:{type:'string'},evidenceIds:{type:'array',items:{type:'string'}}} };
export const briefJsonSchema = { type:'object', additionalProperties:false, required:['marketOpportunity','targetUserAndScene','priceBand','specification','coreSellingPoints','differentiation','productDesign','risks','pendingValidation'], properties: {
  marketOpportunity:citedTextJson,targetUserAndScene:citedTextJson,priceBand:citedTextJson,specification:citedTextJson,
  coreSellingPoints:{type:'array',items:citedTextJson},differentiation:citedTextJson,productDesign:citedTextJson,
  risks:{type:'array',items:citedTextJson},pendingValidation:{type:'array',items:{type:'string'}},
} };

const listingFactTextJson = {type:'object',additionalProperties:false,required:['text','sourceFactIds'],properties:{text:{type:'string'},sourceFactIds:{type:'array',items:{type:'string'}}}};
export const listingJsonSchema = { type:'object',additionalProperties:false,required:['titles','suggestedKeywords','sellingPoints','detailSuggestions','risks'],properties:{titles:{type:'array',items:{type:'object',additionalProperties:false,required:['text','sourceFactIds','keywordTerms'],properties:{text:{type:'string'},sourceFactIds:{type:'array',items:{type:'string'}},keywordTerms:{type:'array',items:{type:'string'}}}}},suggestedKeywords:{type:'array',items:{type:'object',additionalProperties:false,required:['term','sourceFactIds','marketEntryIds'],properties:{term:{type:'string'},sourceFactIds:{type:'array',items:{type:'string'}},marketEntryIds:{type:'array',items:{type:'string'}}}}},sellingPoints:{type:'array',items:listingFactTextJson},detailSuggestions:{type:'array',items:listingFactTextJson},risks:{type:'array',items:{type:'string'}}}};
