import { AppError } from './store.js';
import { modelOverride } from './model-settings.js';

export const capabilities = ['TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION','SYSTEM_REASONING'] as const;
export type ModelCapability = typeof capabilities[number];
export type CapabilityConfig = { capability: ModelCapability; provider: 'bailian'; model: string; modelVersion: string | null; enabled: boolean; usageNote: string; alternatives: string[] };

const validModel = (value: string) => {
  const model = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(model)) throw new AppError('MODEL_CONFIGURATION_INVALID', '模型 ID 配置无效', 409);
  return model;
};
const list = (value: string | undefined) => value?.split(',').map(part => validModel(part)).filter(Boolean) ?? [];

export function capabilityConfig(capability: ModelCapability): CapabilityConfig {
  const entries: Record<ModelCapability, { prefix: string; fallback: string; note: string }> = {
    TEXT_FAST: { prefix: 'COMMERCE_TEXT_FAST', fallback: 'qwen3.7-flash', note: '文本清洗、归类和结构化抽取' },
    TEXT_REASONING: { prefix: 'COMMERCE_TEXT_REASONING', fallback: 'qwen3.8-max', note: '产品企划、市场判断及 Listing 建议' },
    VISION_INSPECT: { prefix: 'COMMERCE_VISION_INSPECT', fallback: 'qwen-vl-plus', note: '视觉候选辅助检查，不替代人工审核；多模态输出经程序校验' },
    IMAGE_GENERATION: { prefix: 'COMMERCE_IMAGE_GENERATION', fallback: 'qwen-image-2.0', note: '背景及视觉候选生成' },
    SYSTEM_REASONING: { prefix: 'COMMERCE_SYSTEM_REASONING', fallback: 'qwen3.8-max', note: '仅在主动触发时读取结构化业务摘要，解释待办和项目健康，不更改业务状态' },
  };
  const setting = entries[capability];
  const model = validModel(modelOverride(capability) || process.env[`${setting.prefix}_MODEL`] || (capability === 'TEXT_FAST' ? process.env.COMMERCE_MARKET_LIGHT_MODEL : capability === 'TEXT_REASONING' ? process.env.COMMERCE_CONTENT_REVIEW_MODEL : capability === 'IMAGE_GENERATION' ? process.env.COMMERCE_IMAGE_MODEL : undefined) || setting.fallback);
  const defaults = capability === 'TEXT_REASONING' ? ['qwen-plus'] : [];
  const alternatives = [...new Set((process.env[`${setting.prefix}_ALTERNATIVES`] === undefined ? defaults : list(process.env[`${setting.prefix}_ALTERNATIVES`])).filter(item => item !== model))];
  return { capability, provider: 'bailian', model, modelVersion: modelOverride(capability)?null:process.env[`${setting.prefix}_VERSION`]?.trim() || null, enabled: process.env[`${setting.prefix}_ENABLED`] !== '0', usageNote: setting.note, alternatives };
}

export function configuredModel(capability: ModelCapability, requested?: string): CapabilityConfig {
  const config = capabilityConfig(capability);
  if (!config.enabled) throw new AppError('MODEL_NOT_CONFIGURED', '该模型能力当前未启用', 409);
  if (requested && requested !== config.model && !config.alternatives.includes(requested)) throw new AppError('MODEL_NOT_CONFIGURED', '只能选择已配置的模型', 409);
  return { ...config, model: requested ?? config.model, modelVersion:requested&&requested!==config.model?null:config.modelVersion };
}
