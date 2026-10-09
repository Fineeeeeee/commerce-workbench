import { AppError } from './store.js';
import { capabilityConfig, configuredModel, type ModelCapability } from './model-capabilities.js';
import { modelOverride } from './model-settings.js';

export type ModelTask = 'market_text_signals' | 'market_opportunity_analysis' | 'market_signal_interpretation' | 'content_direction' | 'content_quality' | 'keyword_normalization' | 'product_brief' | 'seo_listing' | 'system_recommend' | 'system_question' | 'system_summary' | 'system_task_structure';
export type OperationCapability = 'TEXT_NORMALIZE' | 'TEXT_REASONING' | 'PRODUCT_BRIEF' | 'SEO_REASONING' | 'VISION_INSPECT' | 'IMAGE_GENERATION' | 'SYSTEM_REASONING';
export type ModelProfile = { provider: 'bailian'; task: ModelTask; capability?: ModelCapability; operationCapability?: OperationCapability; model: string; workspace: string; enableThinking: boolean; temperature: number; maxTokens: number };
export const operationCapabilityForTask = (task: ModelTask): OperationCapability => task === 'market_text_signals' || task === 'keyword_normalization' ? 'TEXT_NORMALIZE' : task === 'product_brief' ? 'PRODUCT_BRIEF' : task === 'seo_listing' ? 'SEO_REASONING' : task.startsWith('system_') ? 'SYSTEM_REASONING' : 'TEXT_REASONING';

const numberSetting = (value: string | undefined, fallback: number, minimum: number, maximum: number, label: string) => {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new AppError('MODEL_CONFIGURATION_INVALID', `${label} 配置无效`);
  return result;
};
const boolSetting = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value === '1' || value.toLowerCase() === 'true';

export function modelProfile(task: ModelTask, requestedModel?: string): ModelProfile | null {
  const workspace = process.env.COMMERCE_BAILIAN_WORKSPACE_ID;
  const enabled = process.env.COMMERCE_MARKET_AI_ENABLED === '1' || (process.env.COMMERCE_MARKET_AI_ENABLED === undefined && process.env.COMMERCE_COPY_ENABLED === '1');
  if (!enabled || !process.env.DASHSCOPE_API_KEY || !workspace || !/^[a-zA-Z0-9-]{1,80}$/.test(workspace)) return null;
  const operationCapability = operationCapabilityForTask(task);
  const marketTask = task === 'market_text_signals' || task === 'market_opportunity_analysis';
  const capability: ModelCapability = task === 'market_text_signals' || task === 'keyword_normalization' ? 'TEXT_FAST' : task.startsWith('system_') ? 'SYSTEM_REASONING' : 'TEXT_REASONING';
  const prefix = `COMMERCE_${capability}`;
  const taskOverride = task==='product_brief'?modelOverride('PRODUCT_BRIEF'):task==='seo_listing'?modelOverride('SEO_REASONING'):undefined;
  const base = configuredModel(capability);
  const configured = taskOverride || (marketTask ? base.model : configuredModel(capability, requestedModel).model);
  if(taskOverride&&requestedModel&&requestedModel!==taskOverride&&!capabilityConfig(capability).alternatives.includes(requestedModel)&&requestedModel!==capabilityConfig(capability).model)throw new AppError('MODEL_NOT_CONFIGURED','该模型未在当前功能中配置',409);
  if (requestedModel && marketTask && !marketAnalysisModelOptions().includes(requestedModel)) throw new AppError('MODEL_NOT_CONFIGURED', '该模型未在文本能力配置中启用', 409);
  return {
    provider: 'bailian', task, ...(capability ? { capability } : {}), operationCapability, workspace, model: requestedModel ?? configured,
    enableThinking: boolSetting(process.env[`${prefix}_THINKING`], false),
    temperature: numberSetting(process.env[`${prefix}_TEMPERATURE`], task === 'market_text_signals' ? 0.1 : 0.2, 0, 1.99, `${prefix}_TEMPERATURE`),
    maxTokens: Math.round(numberSetting(process.env[`${prefix}_MAX_TOKENS`], task.startsWith('system_') ? 2200 : task.startsWith('content_') ? 1800 : 10000, 256, 16000, `${prefix}_MAX_TOKENS`)),
  };
}

export function marketAnalysisModelOptions(): string[] {
  const configs = [capabilityConfig('TEXT_FAST'),capabilityConfig('TEXT_REASONING')].filter(config => config.enabled);
  return [...new Set(configs.flatMap(config => [config.model,...config.alternatives]))];
}

export function marketFallbackModels(task: 'market_text_signals' | 'market_opportunity_analysis', currentModel: string): string[] {
  const fast = capabilityConfig('TEXT_FAST'), reasoning = capabilityConfig('TEXT_REASONING');
  const candidates = task === 'market_text_signals'
    ? [...(fast.enabled ? fast.alternatives : []), ...(reasoning.enabled ? [reasoning.model,...reasoning.alternatives] : [])]
    : reasoning.enabled ? reasoning.alternatives : [];
  return [...new Set(candidates.filter(model => model !== currentModel))];
}

export function requireModelProfile(task: ModelTask): ModelProfile {
  const profile = modelProfile(task);
  if (!profile) throw new AppError('MODEL_NOT_CONFIGURED', '当前 AI 能力尚未配置，请检查模型服务连接', 409);
  return profile;
}
export function requireOperationProfile(capability:OperationCapability,task:ModelTask,requestedModel?:string):ModelProfile {
  if(operationCapabilityForTask(task)!==capability)throw new AppError('MODEL_CONFIGURATION_INVALID','模型任务与能力不匹配',409);
  const profile=modelProfile(task,requestedModel);
  if(!profile)throw new AppError('MODEL_NOT_CONFIGURED','当前模型能力尚未配置',409);
  return profile;
}
