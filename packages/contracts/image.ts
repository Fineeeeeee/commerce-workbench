import { z } from 'zod';
import type { DesignPage, ProductInput } from './domain.js';
import { templateById } from './content-template.js';

export const imageModeSchema = z.enum(['draft', 'background', 'quality', 'premium']);
export type ImageMode = z.infer<typeof imageModeSchema>;
export const selectableImageModels = ['z-image-turbo','qwen-image','qwen-image-plus','qwen-image-2.0','qwen-image-2.0-pro','qwen-image-edit-plus','wan2.7-image','qwen-image-3.0-pro','wan2.7-image-pro'] as const;
export const imageModelSchema = z.enum(selectableImageModels);
export type ImageModel = z.infer<typeof imageModelSchema>;
export const productionImageMode: ImageMode = 'quality';
export const productionImageModel = 'qwen-image-2.0' as const;
export type ImageCandidate = {
  id: string;
  taskId: string;
  pageId: string;
  pagePurpose: string;
  kitVersion: number;
  productVersion: number;
  createdAt: string;
  mode: ImageMode;
  model: string;
  width: number;
  height: number;
  prompt: string;
  contentUrl: string;
  visualMode?: 'BACKGROUND'|'REFERENCE_IMAGE';
  generationContext?:{imageTypeVersion:number;categoryGuideVersion:number;editStrategy:string;seed?:number;sourceInferenceRunId?:string};
};

const directions: Record<string, string> = {
  '主视觉首图': '淘宝高转化首图背景。中央偏下以平静水面和柔和光区自然形成约55%的真实商品主体空间；使用水面倒影、柔和体积光和少量兰花意象，背景有明确前中后景，上方和底部通过低细节景深自然留出排版空间。',
  '四卖点页': '四卖点信息背景。中央偏右通过光区自然留出商品主体空间，左侧及下方形成四处低细节但彼此可区分的自然区域；用清爽水流、蓬松发丝轮廓和轻盈气泡构建层次。',
  '成分 / 产品机理页': '成分与机理背景。预留三组真实成分说明区和发丝机理示意区，只生成抽象结构、液滴和发丝质感，不生成成分名称或科学结论。',
  '香氛情绪页': '香氛情绪背景。使用溪流、幽兰、晨雾和通透光影，底部通过三处低细节光区自然承载香调内容，中央保持清晰视觉动线。',
  '凭证 / 清单页': '凭证清单背景。保持规整可信的低细节布景，由程序后续叠加真实凭证和清单；不生成证书、印章、编号、二维码或清单文字。',
  '产品总览': '详情页产品总览背景。建立品牌氛围、商品主体区、规格区和核心卖点区，画面层次完整。',
  '用户痛点 / 使用需求': '用户需求背景。使用油腻扁塌与清爽蓬松的抽象对照，预留人群标签和需求说明区，不出现医疗画面。',
  '核心卖点总览': '核心卖点总览背景。预留四个等权卖点卡片区和中央商品主体区，视觉动线清晰。',
  '卖点展开 1': '单一卖点深度解释背景。使用一个中心视觉隐喻和两到三块说明区域，保留依据脚注位置。',
  '卖点展开 2': '第二卖点深度解释背景。采用横向分区构图，包含效果意象、说明卡片和依据脚注区域。',
  '成分 / 配方页': '成分配方背景。使用液滴、原料质感和抽象分子结构，预留真实成分名称与说明区，不生成化学式或功效结论。',
  '香氛体验页': '香氛体验背景。使用通透水汽、兰花和溪畔自然氛围，预留香型说明区。',
  '使用体验 / 场景页': '使用体验背景。呈现细腻泡沫、清水和柔顺发丝的连续视觉节奏，预留体验说明区。',
  '使用方法页': '使用方法背景。为取用、揉搓、按摩、冲洗步骤预留连续图示区和注意事项区。',
  '规格参数页': '规格参数背景。中央预留商品主体，旁边预留容量、产地、香型等参数表格区，版面可信易读。',
  '品牌 / 产品信息页': '品牌与产品信息背景。预留品牌说明、产品信息和来源说明区，商品小比例陈列。',
  '收尾 / 购买引导页': '详情收尾背景。保留品牌标题、核心利益点、规格和购买引导区，形成完整视觉收束。',
  '产品首图': '淘宝高转化首图。商品占画面约55%，正面站立，右侧或上方形成强视觉焦点；使用水面倒影、柔和体积光和少量兰花意象，背景有明确前中后景，预留一块完整的大标题区、两处圆形卖点标记区和底部促销信息区。',
  '核心卖点': '核心利益点展示。商品居中偏右，左侧预留三个纵向卖点卡片区；用清爽水流、蓬松发丝轮廓和轻盈气泡表达控油、蓬松与清爽，信息密度高但层级清楚。',
  '产品特点': '产品特点展示。使用近景产品与局部质感特写，周围安排三处可放置短文案的功能说明区；通过透明水膜、轻盈泡沫和柔顺发丝表达洗后触感。',
  '适用需求': '适用需求展示。商品置于中央，两侧形成油腻扁塌与清爽蓬松的视觉对照区域，预留人群标签和问题说明区，不出现真实人物面部。',
  '规格信息': '规格与购买信息展示。商品完整正面呈现，旁边预留容量、产地、香型和包装信息区域；底部留出规格卡和购买提示区，整体像成熟淘宝商品信息页。',
  '产品定位': '详情页开场。以品牌氛围、香型记忆和商品主视觉建立高级感，商品与溪流、幽兰、晨雾形成完整场景，上方留品牌标题，下方留定位说明。',
  '特点说明一': '单一卖点深度解释页。使用清晰的中心视觉隐喻和两到三块说明区域，避免装饰空洞；保留标题、证据说明和脚注位置。',
  '特点说明二': '第二卖点深度解释页。采用不同于上一页的横向分区构图，包含商品、效果意象、说明卡片和证据脚注区域。',
  '特点说明三': '第三卖点深度解释页。采用近景材质与完整商品组合，预留三段短说明，保持与整套浅蓝水墨香氛风格一致。',
  '使用体验': '洗发体验页。呈现细腻泡沫、清水冲洗和柔顺发丝的连续视觉节奏，预留三步体验说明，商品保持清晰可识别。',
  '细节展示': '商品细节页。展示泵头、瓶身材质、标签和容量区域的局部特写位置，使用放大框式构图，并保留对应说明区。',
  '使用场景': '浴室与梳妆场景页。使用干净高级的真实生活场景，商品是唯一明确商品主体，预留场景标题和两处体验文案区。',
  '适用对象': '适用人群页。使用发丝状态和头皮清爽感的抽象视觉，不出现医疗画面；预留油性发质、易扁塌等人群标签区。',
  '规格展示': '规格参数页。商品完整正面加背面信息占位结构，预留容量、尺寸和装箱信息表格区，背景简洁但不能像空白模板。',
  '使用资料': '使用方法页。为取用、揉搓、冲洗三个步骤预留连续图示区和注意事项区，商品在首尾形成视觉闭环。',
  '产品信息': '详情页收尾信息板。预留完整商品信息表、品牌与售后说明区，商品小比例陈列，版面规整、可信、便于阅读。',
};

export function imagePrompt(product: ProductInput, page: DesignPage, mode: ImageMode): string {
  const format = page.kind === 'main' ? '正方形电商主图' : '3:4竖版电商详情页';
  const templatePurpose = templateById(page.templateId)?.purpose ?? page.purpose;
  const direction = directions[templatePurpose] ?? `${templatePurpose}主题页。建立明确的商品主体、信息区和视觉动线，避免大面积空白。`;
  const visual = `制作${format}的无文字视觉背景。设计任务：${direction}主色使用${page.background}对应的浅冷色，${page.accent}对应的深色只作少量点缀。画面必须达到成熟淘宝日化商品页的信息承载密度，保留规划好的商品占位区和文案区，但区域本身不能是大片纯色。所有留白只能通过景深、光影、构图和自然环境形成，禁止画出可见边框、矩形面板、圆形徽章、卡片、表格、网格、按钮或任何界面占位符。使用商业棚拍级光影、真实材质、精细倒影与有层次的布景，禁止廉价渐变、简单贴图和模板感。画面中禁止出现商品、瓶子、泵头、容器、包装、中文、字母、数字、水印、价格、促销标签、二维码或品牌标识。`;
  if (mode === 'draft') return `生成一张纯场景背景概念图。${visual}画面只能包含抽象柔和光影、轻微水波纹理和少量自然植物虚化元素；不得出现商品、瓶子、泵头、容器、包装、标签、人物或可识别物体，中央大面积留空。`;
  if (mode === 'background') return `为后续程序叠加真实商品主体生成完整布景。${visual}`;
  return `为日化商品的${templatePurpose}生成可复用背景。${visual}真实商品图会由程序在生成后叠加，背景中必须保持商品占位区域干净且光向一致。`;
}
