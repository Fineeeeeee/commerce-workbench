import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.js';
import { AppError } from './store.js';
import { requireModelProfile, modelProfile, type ModelTask } from './model-router.js';
import { requestStructured } from './structured-model-provider.js';

type RecordedTask = Extract<ModelTask,'keyword_normalization'|'product_brief'|'seo_listing'|'market_signal_interpretation'|'system_recommend'|'system_question'|'system_summary'|'system_task_structure'>;
type Input = { task: RecordedTask; subjectType: 'project'|'sku'|'batch'|'market_signal'|'system'; subjectId: string; input: unknown; systemPrompt: string; outputName: string; jsonSchema: object; validator: z.ZodType<unknown>; requestedModel?: string; reuseSucceeded?: boolean };

export async function recordedStructuredRun<T>(store: Store, input: Input & { validator: z.ZodType<T> }) {
  const profile = input.requestedModel ? modelProfile(input.task,input.requestedModel) : requireModelProfile(input.task);
  if (!profile?.capability) throw new AppError('MODEL_NOT_CONFIGURED','模型能力未配置',409);
  const capability = profile.capability;
  const id = randomUUID(), createdAt = new Date().toISOString(), started = Date.now();
  const serialized = JSON.stringify(input.input);
  const fingerprint = createHash('sha256').update(`${input.task}:${serialized}`).digest('hex');
  if (input.reuseSucceeded) {
    const cached = store.db.prepare("SELECT id,output_data,model,model_version FROM ai_inference_runs WHERE task_type=? AND subject_type=? AND subject_id=? AND input_fingerprint=? AND model=? AND status='SUCCEEDED' ORDER BY created_at DESC LIMIT 1").get(input.task,input.subjectType,input.subjectId,fingerprint,profile.model);
    if (cached?.output_data) {
      const parsed = input.validator.safeParse(JSON.parse(String(cached.output_data)));
      if (parsed.success) return { id:String(cached.id), output:parsed.data, model:String(cached.model), modelVersion:cached.model_version?String(cached.model_version):null, requestId:null, cached:true };
    }
  }
  const save = (status: string, output: unknown, version: string | null, code: string | null) => store.db.prepare(`INSERT INTO ai_inference_runs
    (id,task_type,capability,subject_type,subject_id,provider,model,model_version,input_fingerprint,input_data,output_data,status,latency_ms,error_code,human_evaluation,adopted_at,created_at)
    VALUES (@id,@task,@capability,@subjectType,@subjectId,@provider,@model,@version,@fingerprint,@input,@output,@status,@latency,@error,@evaluation,@adopted,@created)`).run({
      id,task:input.task,capability,subjectType:input.subjectType,subjectId:input.subjectId,provider:profile.provider,model:profile.model,version,
      fingerprint,input:serialized,output:output === null ? null : JSON.stringify(output),status,latency:Date.now()-started,error:code,evaluation:null,adopted:null,created:createdAt,
    });
  try {
    const result = await requestStructured(profile,[{role:'system',content:input.systemPrompt},{role:'user',content:serialized}],input.outputName,input.jsonSchema,input.validator);
    save('SUCCEEDED',result.output,result.modelVersion,null);
    return { id, output: result.output, model: profile.model, modelVersion: result.modelVersion, requestId: result.requestId, cached:false };
  } catch (error) {
    save(error instanceof AppError && error.code === 'RESULT_UNCERTAIN' ? 'UNCERTAIN' : 'FAILED',null,null,error instanceof AppError ? error.code : 'INTERNAL_ERROR');
    throw error;
  }
}
