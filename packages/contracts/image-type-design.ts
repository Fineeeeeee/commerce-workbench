import type { ImageTypeData } from './image-type-guide.js';

/** Editorial design proposal, never an automatic confirmed guide update. */
export function designEnhancedDraft(slot:string,data:ImageTypeData):ImageTypeData {
  const scene=slot==='F01'?'蓝灰渐变、清透水面、远处柔焦花影；商品落于浅色台面，不遮标签。':slot==='F02'?'低对比蓝灰渐变，纹理在边缘；四卖点等距留白，用细线分隔。':slot==='F04'||slot==='D07'?'柔焦花园与光斑在后景；商品与文字保持留白，花材不充当成分证明。':data.backgroundRule;
  return {...data,backgroundRule:scene,textOverlayRule:'逐字保留确认文案。宋体主标题、无衬线正文，字号2:1；深蓝灰字，克制蓝色强调，留白对齐，不堆纯黑大字。',styleVariant:{...data.styleVariant,domestic:'商业摄影与编辑式排版，单一焦点；不添加文字、促销或徽章。'}};
}
