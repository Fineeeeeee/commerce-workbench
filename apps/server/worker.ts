import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { Tasks } from './tasks.js';
import { executeExport } from './export-worker.js';
import { executeCopy } from './copy-service.js';
import { executeImage } from './image-service.js';
import { diagnostics } from './diagnostics.js';

const store = new Store(resolve('.runtime')), tasks = new Tasks(store), owner = randomUUID();
const log = diagnostics(store.directory);
let stopped = false;
process.on('SIGINT', () => { stopped = true; }); process.on('SIGTERM', () => { stopped = true; });
process.on('disconnect', () => { stopped = true; });
try {
  while (!stopped) {
    try {
      const lease = tasks.claim(owner);
      if (lease) {
        const started = Date.now(); log({ event: 'task_started', taskId: lease.id, jobId: lease.jobId });
        try { if (lease.operation === 'copy') await executeCopy(tasks, lease); else if (lease.operation === 'image') await executeImage(tasks, lease); else await executeExport(tasks, lease); } catch (e) { tasks.fail(lease, e); }
        const status = tasks.info(lease.jobId).tasks.find(t => t.id === lease.id);
        log({ event: 'task_finished', taskId: lease.id, jobId: lease.jobId, state: status?.state, durationMs: Date.now() - started }); continue;
      }
    } catch { log({ event: 'worker_error', code: 'WORKER_CHECK_FAILED' }); console.error('后台任务检查未完成，下次继续检查'); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { store.close(); }
