import { z } from 'zod';
import { AppError } from './store.js';
import { modelOverride } from './model-settings.js';

export type CopyProfile = { provider: 'bailian'; model: string; workspace: string; version: 'bailian-copy-v6' };
export type CopyResponse = { id: string; model: string; content: string; finishReason: string; usage: { input: number; output: number } | null };
export function copyProfile(): CopyProfile | null {
  const workspace = process.env.COMMERCE_BAILIAN_WORKSPACE_ID;
  if (process.env.COMMERCE_COPY_ENABLED !== '1' || !process.env.DASHSCOPE_API_KEY || !workspace || !/^[a-zA-Z0-9-]{1,80}$/.test(workspace)) return null;
  const model = modelOverride('COPY_GENERATION') || process.env.COMMERCE_COPY_MODEL?.trim() || 'qwen3.7-flash';
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(model)) return null;
  return { provider: 'bailian', model, workspace, version: 'bailian-copy-v6' };
}
const responseSchema = z.object({ id: z.string().max(200), model: z.string().max(120), choices: z.array(z.object({ message: z.object({ content: z.string().max(20000) }), finish_reason: z.string() })).length(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).nullish() });
const providerErrorSchema = z.object({
  code: z.string().max(100).optional(), request_id: z.string().max(100).optional(),
  error: z.object({ code: z.string().max(100).optional(), param: z.string().max(100).nullish(), message: z.string().max(2000).optional() }).passthrough().optional(),
}).passthrough();
async function rejected(response: Response) {
  let providerCode = '', requestId = response.headers.get('x-request-id') ?? '';
  try {
    const text = await response.text();
    if (text.length <= 16_000) {
      const parsed = providerErrorSchema.parse(JSON.parse(text));
      const code = parsed.code ?? parsed.error?.code ?? '';
      providerCode = /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : '';
      const param = parsed.error?.param && /^[A-Za-z0-9_.-]{1,100}$/.test(parsed.error.param) ? parsed.error.param : '';
      if (providerCode === 'invalid_parameter_error' && param) providerCode = `${providerCode}.${param}`;
      requestId = /^[A-Za-z0-9-]{1,100}$/.test(parsed.request_id ?? '') ? parsed.request_id! : requestId;
    }
  } catch { /* Never expose untrusted provider text. */ }
  const suffix = requestId ? `（百炼请求编号：${requestId}）` : '';
  if (/InvalidApiKey|invalid_api_key/i.test(providerCode)) return new AppError('PROVIDER_INVALID_KEY', `API Key 与北京地域接入方式不匹配${suffix}`);
  if (/Workspace|NOT.?AUTHORIZED/i.test(providerCode)) return new AppError('PROVIDER_WORKSPACE_DENIED', `API Key 无权访问当前业务空间，请核对工作空间 ID 与密钥归属${suffix}`);
  if (/Model.AccessDenied|AccessDenied.Unpurchased/i.test(providerCode)) return new AppError('PROVIDER_MODEL_DENIED', `当前业务空间尚未获得 ${copyProfile()?.model ?? '当前文案模型'} 推理权限${suffix}`);
  if (/Arrearage|AllocationQuota/i.test(providerCode)) return new AppError('PROVIDER_QUOTA_DENIED', `账户状态或免费额度限制阻止了本次调用${suffix}`);
  return new AppError('PROVIDER_REJECTED', `文字服务拒绝了请求${providerCode ? `（${providerCode}）` : ''}${suffix}，请检查权限或模型配置`);
}
export async function requestCopy(profile: CopyProfile, messages: { role: string; content: string }[], fetcher: typeof fetch = fetch): Promise<CopyResponse> {
  const active = copyProfile();
  if (!active || JSON.stringify(active) !== JSON.stringify(profile)) throw new AppError('CONFIGURATION_CHANGED', '文字服务配置已变化，请重新提交');
  const endpoint = `https://${profile.workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
  let response: Response;
  try {
    response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: profile.model, messages }) });
  } catch { throw new AppError('RESULT_UNCERTAIN', '文字请求结果尚无法确认，请核对服务记录；不会自动再次调用', 409); }
  if (!response.ok) {
    if ([400, 401, 403, 404, 422].includes(response.status)) throw await rejected(response);
    await response.body?.cancel();
    throw new AppError('RESULT_UNCERTAIN', '文字服务未返回明确结果，请核对后处理；不会自动再次调用', 409);
  }
  try {
    const reader = response.body?.getReader(); if (!reader) throw new Error('empty');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 128000) { await reader.cancel(); throw new Error('large'); } chunks.push(part.value); }
    const joined = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
    const result = responseSchema.parse(JSON.parse(new TextDecoder().decode(joined))), choice = result.choices[0]!;
    return { id: result.id, model: result.model, content: choice.message.content, finishReason: choice.finish_reason, usage: result.usage ? { input: result.usage.prompt_tokens, output: result.usage.completion_tokens } : null };
  } catch { throw new AppError('RESULT_UNCERTAIN', '返回结果不完整或无法解析，需要核对服务记录；不会自动再次调用', 409); }
}
