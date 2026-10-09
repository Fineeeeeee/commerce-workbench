import { z } from 'zod';
import { imageModelSchema } from './image.js';
import { editStrategySchema } from './image-type-guide.js';

const commonJob = { kitVersion: z.number().int().positive(), pageIds: z.array(z.string().uuid()).min(1).max(25) };
export const jobInputSchema = z.discriminatedUnion('operation', [
  z.object({ ...commonJob, operation: z.literal('export') }).strict(),
  z.object({ ...commonJob, operation: z.literal('copy'), copySlot: z.enum(['headline','subtitle','body']).optional(), productionBatchId: z.string().uuid().optional() }).strict(),
  z.object({ ...commonJob, operation: z.literal('image'), imageMode: z.enum(['draft', 'background', 'quality', 'premium']), imageModel: imageModelSchema.optional(), productionBatchId: z.string().uuid().optional(),editStrategy:editStrategySchema.optional(),seed:z.number().int().min(0).max(2147483647).optional() }).strict(),
]);
export type JobInput = z.infer<typeof jobInputSchema>;
export const taskStates = ['queued', 'running', 'waiting_external', 'saving_result', 'needs_reconciliation', 'succeeded', 'failed', 'cancelled'] as const;
export type TaskState = typeof taskStates[number];
export type TaskInfo = { id: string; pageId?: string | null; state: TaskState; stage: string; progress: number; total: number; error: string | null; recoveryAction: string | null; exportId: string | null; updatedAt: string };
export type JobInfo = { id: string; kitId: string; kitVersion: number; name: string; createdAt: string; operation: string; state: string; tasks: TaskInfo[]; usage: { inputTokens: number | null; outputTokens: number | null; imageCount: number | null; cost: null } };
export const terminal = (state: string) => ['succeeded', 'failed', 'cancelled', 'partial', 'needs_reconciliation'].includes(state);
export function jobState(tasks: Pick<TaskInfo, 'state'>[]): string {
  if (tasks.every(t => t.state === 'succeeded')) return 'succeeded';
  if (tasks.every(t => t.state === 'cancelled')) return 'cancelled';
  if (tasks.every(t => t.state === 'failed')) return 'failed';
  if (tasks.some(t => ['queued', 'running', 'waiting_external', 'saving_result'].includes(t.state))) return 'active';
  return tasks.some(t => t.state === 'needs_reconciliation') ? 'needs_reconciliation' : 'partial';
}
