import { z } from 'zod';
const text=(max:number)=>z.string().trim().min(1).max(max);
export const visualGuideSourceSchema=z.object({repository:text(200),path:text(200),commit:z.string().regex(/^[a-f0-9]{40}$/),extractedAt:z.string().datetime(),extractedBy:text(100),adaptation:text(600)}).strict();
