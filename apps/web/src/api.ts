export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number, public requestId: string | null, public resolution: string | null) { super(requestId ? `${message}（问题编号：${requestId}）` : message); }
}
const readSnapshots=new Map<string,unknown>();
let snapshotEpoch=0;
// Navigation may reuse an observed response while the normal GET refreshes it.
// A write invalidates snapshots; this never skips a request or replays a mutation.
export const peekApi=<T,>(path:string):T|null=>(readSnapshots.get(path) as T|undefined)??null;
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const mutation=!['GET','HEAD'].includes((options?.method??'GET').toUpperCase());
  const readEpoch=snapshotEpoch;
  try {
  const headers = new Headers(options?.headers);
  if (options?.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers });
  let result;
  try { result = await response.json(); } catch { throw new ApiError('服务返回了无法识别的内容，请检查当前操作状态', 'INVALID_RESPONSE', response.status, response.headers.get('X-Request-Id'), 'review_current_state'); }
  if (!response.ok) throw new ApiError(result.error?.message || `请求失败（${response.status}）`, result.error?.code || 'REQUEST_FAILED', response.status, response.headers.get('X-Request-Id'), result.error?.resolution || null);
  if(mutation){snapshotEpoch++;readSnapshots.clear();operationFeedback({tone:'success',message:'操作成功'});}
  else if(readEpoch===snapshotEpoch&&!options?.signal?.aborted){if(readSnapshots.size>=100&&!readSnapshots.has(path))readSnapshots.delete(readSnapshots.keys().next().value!);readSnapshots.set(path,result);}
  return result as T;
  }catch(error){if(mutation&&!(error instanceof DOMException&&error.name==='AbortError'))operationFeedback({tone:'error',message:error instanceof ApiError?error.message:'操作未完成，请检查连接后再试'});throw error;}
}
export const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
import { operationFeedback } from './feedback-events.js';
