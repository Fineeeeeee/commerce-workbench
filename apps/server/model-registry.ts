export type StructuredMode = 'json_schema' | 'json_object' | 'text_json';
export type ModelCompatibility = { structuredModes: StructuredMode[]; vision: boolean; contextTokens: number | null; maxOutputTokens: number | null };

// Verified editing protocol: Alibaba Cloud qwen-image-edit-api, checked 2026-10-04.
export function imageModelCompatibility(model:string){
  return {referenceImage:['qwen-image-edit-plus','qwen-image-2.0','qwen-image-2.0-pro','qwen-image-3.0-pro'].includes(model),promptTokenLimit:model.startsWith('qwen-image-2.0')?1300:800};
}

// Only advertise request modes verified against the provider's model contract.
// Unknown models start with locally validated text JSON rather than an assumed native mode.
export function modelCompatibility(model: string): ModelCompatibility {
  const id = model.toLowerCase();
  const schema = /^qwen3\.(?:7-(?:plus|flash|max)|8-(?:flash|max))(?:-|$)/.test(id);
  const object = schema || /^qwen3\.6-(?:plus|flash|max)(?:-|$)/.test(id) || /^qwen(?:-plus|-max|-flash)(?:-|$)/.test(id);
  return { structuredModes: schema ? ['json_schema','json_object','text_json'] : object ? ['json_object','text_json'] : ['text_json'], vision: /^(?:qwen-vl|qwen3\.[678]-(?:max|omni))/.test(id), contextTokens: null, maxOutputTokens: null };
}
