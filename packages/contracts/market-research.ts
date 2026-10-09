import { z } from 'zod';

export const marketResearchStates = ['CREATED','COLLECTING','NORMALIZING','IMPORTING','ANALYZING','REVIEW_REQUIRED','COMPLETED','FAILED'] as const;
export type MarketResearchState = typeof marketResearchStates[number];
export const marketResearchInputSchema = z.object({
  sourcePlatform: z.literal('jd'), collectionProfile: z.enum(['shampoo','facial_cleanser']),
  targetCount: z.number().int().min(1).max(100).default(50), maxPages: z.number().int().min(1).max(20).default(10),
}).strict();
export const projectMarketResearchInputSchema = z.object({
  targetCount: z.number().int().min(1).max(100).default(50),
}).strict();
export type MarketResearchJob = {
  id:string; initiatingProjectId:string|null; sourcePlatform:string; collectionProfile:string; targetCount:number; maxPages:number;
  state:MarketResearchState; failedStage:string|null; scannedCount:number; validCount:number; opportunityCount:number;
  manifestData:Record<string,unknown>; marketBatchId:string|null; errorCode:string|null; safeMessage:string|null;
  retryCount:number; version:number; createdAt:string; updatedAt:string;
};
