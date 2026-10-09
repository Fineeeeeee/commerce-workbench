import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AppError } from './store.js';
import { modelOverride } from './model-settings.js';
import { imageModelCompatibility } from './model-registry.js';
import { selectableImageModels, type ImageMode, type ImageModel } from '../../packages/contracts/image.js';

const imageModels = [...selectableImageModels,'wanx-background-generation-v2'] as const;
export type ImageProfile = { provider: 'bailian'; mode: ImageMode; model: typeof imageModels[number]; workspace: string; version: 'bailian-image-v3'; engine?: 'REFERENCE_IMAGE';seed?:number };
export type ImageResponse = { id: string; model: string; url: string; imageCount: number | null; inputTokens: number | null; outputTokens: number | null };
export type PendingImageResponse = { id: string; model: 'wanx-background-generation-v2'; pending: true };

export function imageProfile(mode: ImageMode, requestedModel?: ImageModel): ImageProfile | null {
  if (process.env.COMMERCE_IMAGE_ENABLED !== '1' || !process.env.DASHSCOPE_API_KEY) return null;
  const workspace = process.env.COMMERCE_BAILIAN_WORKSPACE_ID?.trim();
  if (!workspace || !/^[a-zA-Z0-9-]{1,80}$/.test(workspace)) return null;
  const configured = requestedModel && !['draft','background'].includes(mode) ? requestedModel : mode === 'draft' ? process.env.COMMERCE_IMAGE_DRAFT_MODEL : mode === 'background' ? 'wanx-background-generation-v2' : mode === 'quality' ? modelOverride('IMAGE_GENERATION') || process.env.COMMERCE_IMAGE_MODEL : process.env.COMMERCE_IMAGE_PREMIUM_MODEL;
  const model = configured?.trim() || (mode === 'draft' ? 'z-image-turbo' : mode === 'background' ? 'wanx-background-generation-v2' : mode === 'quality' ? 'qwen-image-2.0' : 'qwen-image-3.0-pro');
  if (!imageModels.includes(model as typeof imageModels[number])) return null;
  return { provider: 'bailian', mode, model: model as typeof imageModels[number], workspace, version: 'bailian-image-v3' };
}

export const supportsReferenceImage=(model:string)=>imageModelCompatibility(model).referenceImage;

const responseSchema = z.object({
  request_id: z.string().max(200),
  output: z.object({ choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.array(z.object({ image: z.string().url().max(4000).optional(), text: z.string().max(20000).optional(), type: z.string().optional() }).refine(item => !!item.image || item.text !== undefined)).min(1) }),
  })).min(1), finished: z.boolean().optional() }),
  usage: z.object({ image_count: z.number().int().nonnegative().optional(), input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).optional(),
});

function providerError(status: number, body: unknown, requestId: string | null) {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const code = typeof value.code === 'string' ? value.code.slice(0, 100) : `HTTP_${status}`;
  const suffix = requestId ? `（百炼请求编号：${requestId}）` : '';
  if (status === 401 || status === 403 || /AccessDenied|Unauthorized/i.test(code)) return new AppError('PROVIDER_MODEL_DENIED', `图片服务权限不足（${code}）${suffix}`);
  if (status === 429 || /Throttl|Limit/i.test(code)) return new AppError('PROVIDER_BUSY', `图片服务当前繁忙（${code}）${suffix}`);
  return new AppError('PROVIDER_REJECTED', `图片服务拒绝了请求（${code}）${suffix}`);
}

const uploadPolicySchema = z.object({ data: z.object({
  upload_dir: z.string().min(1).max(1000), upload_host: z.string().url().max(2000), oss_access_key_id: z.string().min(1).max(500),
  signature: z.string().min(1).max(4000), policy: z.string().min(1).max(10000), x_oss_object_acl: z.string().min(1).max(100), x_oss_forbid_overwrite: z.string().min(1).max(100),
}) });
const backgroundSubmitSchema = z.object({ request_id: z.string().max(200), output: z.object({ task_id: z.string().max(200), task_status: z.string() }) });
const backgroundStatusSchema = z.object({ request_id: z.string().max(200), output: z.object({
  task_id: z.string().max(200), task_status: z.string(), results: z.array(z.object({ url: z.string().url().max(4000) })).optional(), code: z.string().max(200).optional(),
}), usage: z.object({ image_count: z.number().int().nonnegative().optional() }).optional() });

async function temporaryUpload(profile: ImageProfile, source: string, fetcher: typeof fetch): Promise<string> {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (!match) throw new AppError('IMAGE_INPUT_MISSING', '商品场景合成需要透明 PNG 主体图');
  const policyResponse = await fetcher(`https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${profile.model}`, { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` }, signal: AbortSignal.timeout(30_000) });
  let policyBody: unknown; try { policyBody = await policyResponse.json(); } catch { throw new AppError('PROVIDER_INVALID_RESPONSE', '图片临时上传凭证无法识别'); }
  if (!policyResponse.ok) throw providerError(policyResponse.status, policyBody, policyResponse.headers.get('x-request-id'));
  const parsed = uploadPolicySchema.safeParse(policyBody); if (!parsed.success) throw new AppError('PROVIDER_INVALID_RESPONSE', '图片临时上传凭证结构不完整');
  const policy = parsed.data.data, host = new URL(policy.upload_host);
  if (host.protocol !== 'https:' || !(host.hostname === 'aliyuncs.com' || host.hostname.endsWith('.aliyuncs.com'))) throw new AppError('PROVIDER_INVALID_RESPONSE', '图片临时上传地址不可信');
  const name = `${randomUUID()}.png`, key = `${policy.upload_dir}/${name}`, form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id); form.append('Signature', policy.signature); form.append('policy', policy.policy);
  form.append('x-oss-object-acl', policy.x_oss_object_acl); form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite); form.append('key', key); form.append('success_action_status', '200');
  form.append('file', new Blob([Buffer.from(match[1]!, 'base64')], { type: 'image/png' }), name);
  const upload = await fetcher(policy.upload_host, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
  if (!upload.ok) throw new AppError('IMAGE_UPLOAD_FAILED', '透明商品主体未能上传到百炼临时存储');
  return `oss://${key}`;
}

async function requestBackground(profile: ImageProfile, prompt: string, source: string | null, fetcher: typeof fetch, onAccepted?: (pending: PendingImageResponse) => void, pending?: PendingImageResponse): Promise<ImageResponse> {
  let taskId = pending?.id;
  if (!taskId) {
    if (!source) throw new AppError('IMAGE_INPUT_MISSING', '商品场景合成需要商品参考图');
    let temporaryUrl: string;
    try { temporaryUrl = await temporaryUpload(profile, source, fetcher); } catch (error) { if (error instanceof AppError) throw error; throw new AppError('RESULT_UNCERTAIN', '透明商品主体上传中断，请核对后重新提交'); }
    let submitted: Response;
    try {
      submitted = await fetcher(`https://${profile.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/background-generation/generation`, {
        method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable', 'X-DashScope-WorkSpace': profile.workspace },
        body: JSON.stringify({ model: profile.model, input: { base_image_url: temporaryUrl, ref_prompt: prompt, neg_ref_prompt: '文字，数字，水印，标识，其他商品，人物，模糊，变形' }, parameters: { n: 1, model_version: 'v3' } }),
      });
    } catch { throw new AppError('RESULT_UNCERTAIN', '商品场景任务提交中断，结果状态需要人工核实'); }
    let body: unknown; try { body = await submitted.json(); } catch { throw new AppError('PROVIDER_INVALID_RESPONSE', '商品场景服务返回了无法识别的内容'); }
    if (!submitted.ok) throw providerError(submitted.status, body, submitted.headers.get('x-request-id'));
    const parsed = backgroundSubmitSchema.safeParse(body); if (!parsed.success) throw new AppError('PROVIDER_INVALID_RESPONSE', '商品场景任务返回结构不完整');
    taskId = parsed.data.output.task_id; onAccepted?.({ id: taskId, model: 'wanx-background-generation-v2', pending: true });
  }
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    let statusResponse: Response;
    try { statusResponse = await fetcher(`https://${profile.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` }, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new AppError('PROVIDER_QUERY_FAILED', '商品场景任务状态暂时无法查询，可安全恢复查询'); }
    let body: unknown; try { body = await statusResponse.json(); } catch { throw new AppError('PROVIDER_QUERY_FAILED', '商品场景任务状态无法识别，可安全恢复查询'); }
    if (!statusResponse.ok) throw providerError(statusResponse.status, body, statusResponse.headers.get('x-request-id'));
    const parsed = backgroundStatusSchema.safeParse(body); if (!parsed.success) throw new AppError('PROVIDER_INVALID_RESPONSE', '商品场景任务状态结构不完整');
    const status = parsed.data.output.task_status;
    if (status === 'SUCCEEDED') {
      const url = parsed.data.output.results?.[0]?.url; if (!url) throw new AppError('OUTPUT_INVALID', '商品场景任务没有返回可保存图片');
      return { id: taskId, model: profile.model, url, imageCount: parsed.data.usage?.image_count ?? 1, inputTokens: null, outputTokens: null };
    }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) throw new AppError('PROVIDER_REJECTED', `商品场景任务未完成（${parsed.data.output.code ?? status}）`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new AppError('PROVIDER_QUERY_FAILED', '商品场景任务仍在处理，可稍后安全恢复查询');
}

export async function requestImage(profile: ImageProfile, prompt: string, source: string | null, size: string, fetcher: typeof fetch = fetch, onAccepted?: (pending: PendingImageResponse) => void, pending?: PendingImageResponse): Promise<ImageResponse> {
  const active = imageProfile(profile.mode, profile.model === 'wanx-background-generation-v2' ? undefined : profile.model as ImageModel);
  if (!active || active.workspace !== profile.workspace || active.model !== profile.model || active.version !== profile.version) throw new AppError('CONFIGURATION_CHANGED', '图片服务配置已变化，请重新提交任务');
  if (profile.mode === 'background') return requestBackground(profile, prompt, source, fetcher, onAccepted, pending);
  const content: Array<{ image?: string; text?: string }> = [];
  if(profile.engine==='REFERENCE_IMAGE'&&(!source||!supportsReferenceImage(profile.model)))throw new AppError('IMAGE_INPUT_MISSING','参考图生成需要商品素材和兼容模型');
  if(profile.engine==='REFERENCE_IMAGE'&&source&&Buffer.byteLength(source.split(',')[1]??'','base64')>10*1024*1024)throw new AppError('IMAGE_INPUT_TOO_LARGE','参考图超过模型输入大小限制，未发送生成请求',409);
  // Fail before dispatch rather than letting the provider silently truncate safety rules.
  if(profile.engine==='REFERENCE_IMAGE'&&Array.from(prompt).reduce((sum,char)=>sum+(char.charCodeAt(0)>127?2:1),0)>imageModelCompatibility(profile.model).promptTokenLimit)throw new AppError('IMAGE_PROMPT_TOO_LONG','当前指南与页面信息超出保守输入预算，请精简图型要求；未发送生成请求',409);
  if (source && (profile.engine==='REFERENCE_IMAGE'||profile.model==='qwen-image-edit-plus')) content.push({ image: source });
  content.push({ text: prompt });
  const parameters = profile.engine==='REFERENCE_IMAGE' ? {size,n:1,prompt_extend:false,watermark:false,...(profile.seed!==undefined?{seed:profile.seed}:{})} : profile.mode === 'draft'
    ? { size, prompt_extend: false }
    : profile.mode === 'quality'
      ? { size, n: 1, prompt_extend: false, enable_thinking: true, watermark: false }
      : { size: '2K', n: 1, watermark: false };
  let response: Response;
  try {
    response = await fetcher(`https://${profile.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`, {
      method: 'POST', signal: AbortSignal.timeout(300_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` },
      body: JSON.stringify({ model: profile.model, input: { messages: [{ role: 'user', content }] }, parameters }),
    });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new AppError('PROVIDER_TIMEOUT', '图片生成超过 5 分钟，任务已结束，可以重新生成');
    throw new AppError('PROVIDER_REQUEST_FAILED', '图片服务连接失败，任务已结束，可以重新生成');
  }
  const requestId = response.headers.get('x-request-id');
  let body: unknown;
  try { body = await response.json(); } catch { throw new AppError('PROVIDER_INVALID_RESPONSE', `图片服务返回了无法识别的内容${requestId ? `（百炼请求编号：${requestId}）` : ''}`); }
  if (!response.ok) throw providerError(response.status, body, requestId);
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new AppError('PROVIDER_INVALID_RESPONSE', `图片服务返回结构不完整${requestId ? `（百炼请求编号：${requestId}）` : ''}`);
  const choice = parsed.data.output.choices[0]!;
  if (choice.finish_reason !== 'stop') throw new AppError('OUTPUT_INVALID', '图片没有正常生成完成，不能保存为候选');
  const url = choice.message.content.find(item => item.image)?.image;
  if (!url) throw new AppError('OUTPUT_INVALID', '图片服务没有返回可保存的图片');
  return { id: parsed.data.request_id, model: profile.model, url, imageCount: parsed.data.usage?.image_count ?? null, inputTokens: parsed.data.usage?.input_tokens ?? null, outputTokens: parsed.data.usage?.output_tokens ?? null };
}
