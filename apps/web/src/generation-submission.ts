import { terminal, type JobInfo } from '../../../packages/contracts/tasks.js';

type SubmissionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function generationSubmissionKey(storage: SubmissionStorage, name: string, previous?: Pick<JobInfo, 'state'> | null): string {
  if (previous?.state === 'needs_reconciliation') throw new Error('上次结果尚未核实，请在版本与导出的后台任务中核对，暂不重新请求模型。');
  if (previous && terminal(previous.state)) storage.removeItem(name);
  const key = storage.getItem(name) ?? crypto.randomUUID();
  storage.setItem(name, key);
  return key;
}
