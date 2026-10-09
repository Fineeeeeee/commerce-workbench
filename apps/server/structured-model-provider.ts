import { z } from 'zod';
import { AppError } from './store.js';
import { modelProfile, type ModelProfile } from './model-router.js';
import { modelCompatibility, type StructuredMode } from './model-registry.js';

export type ModelAttempt = { mode: StructuredMode; requestId: string | null; errorCode: string | null; safeMessage: string | null; status: 'SUCCEEDED' | 'FAILED' };
export type StructuredResponse<T> = { requestId: string; modelVersion: string; output: T; usage: { input: number; output: number } | null; requestMode?: StructuredMode; attempts?: ModelAttempt[] };
export class ModelRequestError extends AppError { constructor(code: string, message: string, public attempts: ModelAttempt[], status = 409) { super(code,message,status); } }
const responseSchema = z.object({ id: z.string().max(200), model: z.string().max(120), choices: z.array(z.object({ message: z.object({ content: z.string().max(100000) }), finish_reason: z.string() })).length(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).nullish() });
const providerErrorSchema = z.object({ code: z.string().max(100).optional(), request_id: z.string().max(100).optional(), error: z.object({ code: z.string().max(100).optional(), param: z.string().max(100).nullish() }).passthrough().optional() }).passthrough();
class ProviderRequestError extends AppError { constructor(code:string,message:string,public requestId:string|null,public parameter:string|null,status=409){super(code,message,status);} }
export function modelErrorCategory(code:string): 'RETRYABLE'|'NON_RETRYABLE_CONFIG'|'REQUEST_INCOMPATIBLE'|'OUTPUT_INVALID' {
  if (['RESULT_UNCERTAIN','PROVIDER_RATE_LIMIT','PROVIDER_TRANSIENT'].includes(code)) return 'RETRYABLE';
  if (code==='REQUEST_INCOMPATIBLE') return 'REQUEST_INCOMPATIBLE';
  if (code.startsWith('OUTPUT_') || code==='INVALID_AI_EVIDENCE') return 'OUTPUT_INVALID';
  return 'NON_RETRYABLE_CONFIG';
}

async function rejected(response: Response, profile: ModelProfile) {
  let code = '', requestId = response.headers.get('x-request-id') ?? '', parameter = '';
  try { const body = providerErrorSchema.parse(JSON.parse(await response.text())); code = body.code ?? body.error?.code ?? ''; requestId = body.request_id ?? requestId; parameter = body.error?.param ?? ''; } catch { /* Do not expose provider response text. */ }
  const suffix = requestId ? `（百炼请求编号：${requestId}）` : '';
  if (/Model.AccessDenied|AccessDenied.Unpurchased|permission/i.test(code)) return new ProviderRequestError('PROVIDER_MODEL_DENIED', `${profile.model} 尚未获得推理权限${suffix}`, requestId,parameter);
  if (/InvalidApiKey|invalid_api_key|unauthorized/i.test(code)||response.status===401) return new ProviderRequestError('PROVIDER_INVALID_KEY', `百炼凭证无效${suffix}`,requestId,parameter);
  if (/invalid_parameter|unsupported_parameter|unsupported_response_format/i.test(code)) return new ProviderRequestError('REQUEST_INCOMPATIBLE', `模型请求参数不兼容${parameter?`（${parameter}）`:''}${suffix}`,requestId,parameter);
  if (/quota/i.test(code)) return new ProviderRequestError('PROVIDER_QUOTA_EXHAUSTED', `当前模型额度不足${suffix}`,requestId,parameter,409);
  if (/rate.?limit|throttl/i.test(code)||response.status===429) return new ProviderRequestError('PROVIDER_RATE_LIMIT', `模型请求频率受限${suffix}`,requestId,parameter,429);
  if (response.status>=500) return new ProviderRequestError('PROVIDER_TRANSIENT',`模型服务暂时不可用${suffix}`,requestId,parameter,503);
  return new ProviderRequestError('PROVIDER_REJECTED', `百炼结构化分析请求被拒绝${code ? `（${code}）` : ''}${suffix}`,requestId,parameter);
}

async function requestStructuredOnce<T>(profile: ModelProfile, messages: Array<{ role: 'system'|'user'; content: string }>, name: string, schema: object, validator: z.ZodType<T>, mode: StructuredMode, fetcher: typeof fetch): Promise<StructuredResponse<T>> {
  const active = modelProfile(profile.task, profile.model);
  if (!active || JSON.stringify(active) !== JSON.stringify(profile)) throw new AppError('CONFIGURATION_CHANGED', '市场分析模型配置已变化，请重新提交', 409);
  const endpoint = `https://${profile.workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
  let response: Response;
  try {
    const prepared = mode === 'json_schema' ? messages : [{role:'system' as const,content:`Return only valid JSON matching this schema. JSON schema: ${JSON.stringify(schema)}`},...messages];
    response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: profile.model, messages: prepared, ...(mode === 'text_json' ? {} : {response_format:mode === 'json_schema' ? { type: 'json_schema', json_schema: { name, strict: true, schema } } : {type:'json_object'}}), enable_thinking: profile.enableThinking, temperature: profile.temperature, max_tokens: profile.maxTokens }) });
  } catch { throw new AppError('RESULT_UNCERTAIN', '市场分析请求结果无法确认，不会自动重复调用', 409); }
  if (!response.ok) throw await rejected(response, profile);
  try {
    const parsed = responseSchema.parse(await response.json()), choice = parsed.choices[0]!;
    if (choice.finish_reason !== 'stop') throw new AppError('OUTPUT_TRUNCATED', '百炼返回内容被截断，未保存为候选', 409);
    let json: unknown; try { json = JSON.parse(choice.message.content); } catch { throw new AppError('OUTPUT_NOT_JSON', '百炼返回内容不是有效 JSON，未保存为候选', 409); }
    const validated = validator.safeParse(json);
    if (!validated.success) {
      const paths = [...new Set(validated.error.issues.map(issue => issue.path.slice(0, 4).join('.') || 'root'))].slice(0, 6).join('、');
      throw new AppError('OUTPUT_SCHEMA_MISMATCH', `百炼返回字段未通过约束：${paths}，未保存为候选`, 409);
    }
    return { requestId: parsed.id, modelVersion: parsed.model, output: validated.data, usage: parsed.usage ? { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens } : null, requestMode:mode };
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('OUTPUT_INVALID', '百炼响应结构不完整，未保存为候选', 409); }
}

export async function requestStructured<T>(profile: ModelProfile, messages: Array<{ role: 'system'|'user'; content: string }>, name: string, schema: object, validator: z.ZodType<T>, fetcher: typeof fetch = fetch): Promise<StructuredResponse<T>> {
  const modes=modelCompatibility(profile.model).structuredModes;
  const attempts:ModelAttempt[]=[];
  for (let index=0;index<modes.length;index++) {
    const mode=modes[index]!;
    try {
      const result=await requestStructuredOnce(profile,messages,name,schema,validator,mode,fetcher);
      attempts.push({mode,requestId:result.requestId,errorCode:null,safeMessage:null,status:'SUCCEEDED'});
      return {...result,attempts};
    } catch(error) {
      const code=error instanceof AppError?error.code:'INTERNAL_ERROR';
      const requestId=error instanceof ProviderRequestError?error.requestId:null;
      attempts.push({mode,requestId,errorCode:code,safeMessage:error instanceof AppError?error.message:'模型请求未完成',status:'FAILED'});
      const parameter=error instanceof ProviderRequestError?error.parameter:null;
      const formatProblem=code==='REQUEST_INCOMPATIBLE'&&!!parameter&&/response_format|json_schema|json_object/i.test(parameter);
      if (!formatProblem||index===modes.length-1) throw new ModelRequestError(code,error instanceof AppError?error.message:'模型请求未完成',attempts,error instanceof AppError?error.status:500);
    }
  }
  throw new ModelRequestError('REQUEST_INCOMPATIBLE','没有兼容的结构化输出模式',attempts);
}
