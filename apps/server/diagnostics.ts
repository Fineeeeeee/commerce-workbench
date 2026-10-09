import { appendFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

type Event = { event: 'request' | 'task_submitted' | 'task_started' | 'task_finished' | 'worker_error'; requestId?: string; method?: string; route?: string; status?: number; durationMs?: number; taskId?: string; jobId?: string; state?: string; code?: string };
const token = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,100}$/.test(value) ? value : undefined;
export function diagnosticRecord(input: Event) {
  return { time: new Date().toISOString(), event: ['request', 'task_submitted', 'task_started', 'task_finished', 'worker_error'].includes(input.event) ? input.event : 'worker_error', requestId: token(input.requestId), method: token(input.method), route: typeof input.route === 'string' && /^\/[A-Za-z0-9_:/-]{0,180}$/.test(input.route) ? input.route : undefined, status: Number.isInteger(input.status) ? input.status : undefined, durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs!)) : undefined, taskId: token(input.taskId), jobId: token(input.jobId), state: token(input.state), code: token(input.code) };
}
export function diagnostics(directory: string) {
  const folder = join(directory, 'logs'); mkdirSync(folder, { recursive: true }); let warned = false;
  return (input: Event) => {
    try {
      const entry = diagnosticRecord(input), path = join(folder, `${entry.time.slice(0, 10)}-${process.pid}.ndjson`), line = JSON.stringify(entry) + '\n';
      if ((existsSync(path) ? statSync(path).size : 0) + Buffer.byteLength(line) > 10 * 1024 * 1024) throw new Error('log limit');
      appendFileSync(path, line, { encoding: 'utf8' });
    } catch { if (!warned) { warned = true; console.error('诊断日志无法继续写入，请检查磁盘空间或日志大小；业务状态请查询任务记录。'); } }
  };
}
