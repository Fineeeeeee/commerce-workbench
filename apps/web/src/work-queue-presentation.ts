import type { QueueItem } from '../../../packages/contracts/work-queue.js';

export function isFailedWork(item: Pick<QueueItem, 'status'>): boolean {
  return ['失败', '生成失败', '调用失败', '超时', 'FAILED', 'TIMEOUT', 'TIMED_OUT'].includes(item.status);
}

/** Stable display grouping only; server priority and deep-link targets remain untouched. */
export function presentWorkQueue(items: readonly QueueItem[], now = Date.now()): QueueItem[] {
  const group = (item: QueueItem) => {
    if (isFailedWork(item)) return 0;
    if (item.source !== 'MANAGER_ASSIGNED') return 3;
    return item.deadline && Date.parse(item.deadline) < now ? 1 : 2;
  };
  return [...items].sort((a, b) => group(a) - group(b));
}

export type ActivityEvent = { id:string; project_id:string; project_name:string; note:string; event_type?:string; created_at:string };
export function compactActivity(events: readonly ActivityEvent[]) {
  const result: Array<ActivityEvent & { count:number }> = [];
  for (const event of events) {
    const previous = result.at(-1);
    const page = event.note.match(/\b[FD]\d{2}\b/)?.[0];
    const previousPage = previous?.note.match(/\b[FD]\d{2}\b/)?.[0];
    if (previous && event.event_type && page && previous.project_id === event.project_id && previous.event_type === event.event_type && previousPage === page) previous.count++;
    else result.push({ ...event, count:1 });
  }
  return result;
}
