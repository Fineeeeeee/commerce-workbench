import type { ImageTypeData } from './image-type-guide.js';
import type { VisualGuideSource } from './visual-guide.js';

export const imageTypeTemplateKey='taobao-daily-care-5-12';
export const imageTypeSources:VisualGuideSource[]=[
  {repository:'wzj177/ecommerce-image-suite',path:'references/image-types.md',commit:'2d508bd990df0397026406f210a5915b2c955469',extractedAt:'2026-10-05T00:00:00.000Z',extractedBy:'Codex 编辑整理',adaptation:'只借用主体保真、卖点分区和场景层次原则；服装材质、白底占比与渠道字体建议不作为官方规则。'},
  {repository:'motiful/product-shots',path:'skills/product-shots-detail-page/SKILL.md',commit:'063c508b0b7f4db5cda89f10bdf20df25026dfc5',extractedAt:'2026-10-05T00:00:00.000Z',extractedBy:'Codex 编辑整理',adaptation:'借用模块化信息与统一参考商品锚点；A+ 尺寸、安全区、平台政策不移植。'},
];
// Editorial specifications: these slot decisions are local proposals, not vendor policies.
const slots:Array<[string,string,string,string,string]>=[
  ['F01','首图：识别商品与核心购买理由','居中完整商品，占高55–65%；顶部独立标题区','纯净浅底，弱场景，不遮标签','营销首图；参考白底主体原则但不等同白底主图'],
  ['F02','四卖点：快速理解已确认差异','左侧完整商品，右侧四项等距卖点；不挤成正文','低纹理浅底','核心卖点图／feature module，三项布局改为本模板四项'],
  ['F03','成分机理：说明已确认成分与作用范围','商品与事实分区，最多三个解释区','干净底色，抽象元素不冒充显微证据','信息模块；材质特写不适用于成分机理'],
  ['F04','香氛情绪：表达已确认香调与感受','完整商品为中心；香调意象在周边，文案留独立区域','低饱和场景，背景虚化','lifestyle 原则改写；服装场景不移植'],
  ['F05','凭证清单：核对真实资质与包装内容','真实凭证或清单与商品分区；编号不可造','中性文档底','无直接参照，本项目编辑规则'],
  ['D01','总览：建立商品识别','上方标题、中间完整商品、下方事实摘要','整洁浅底','详情页 hero module'],
  ['D02','需求：解释适用场景','需求示意与商品各一块，避免夸张痛苦对比','克制生活场景','详情页场景信息模块'],
  ['D03','卖点总览：浏览选择依据','商品旁分块列卖点，每块一项，不重复','轻背景，统一网格','核心卖点图／feature module'],
  ['D04','卖点一：展开一个已确认理由','一个视觉焦点加一条解释，商品仍可识别','浅底或单一场景','单卖点模块；不借用服装版型描述'],
  ['D05','卖点二：补充独立理由','与D04同风格，独立内容，不复制前页','浅底或单一场景','单卖点模块'],
  ['D06','配方：呈现真实成分信息','成分文字与商品分区；不生成虚构实验','中性低纹理底','无直接成分参照，本项目事实信息规则'],
  ['D07','香氛体验：说明确认香调','商品居中，香调分层文字不覆盖瓶身','柔和虚化环境','lifestyle 信息模块'],
  ['D08','使用场景：建立场景联想','商品完整，场景退后，不添加另一款商品','场景适度虚化','场景图；不引入模特使用效果证据'],
  ['D09','使用方法：清楚说明步骤','步骤按阅读顺序排列，商品作为稳定锚点','简洁底色','详情页步骤模块，本项目编辑安排'],
  ['D10','规格：核对容量与包装','完整商品与参数表分区；只显示确认参数','中性浅底','规格信息模块'],
  ['D11','品牌：识别真实品牌与商品','品牌名、商品和确认资料分区','品牌统一底色','品牌模块；不编造品牌历史'],
  ['D12','收尾：归纳购买依据','完整商品加一句收尾，无虚构优惠或倒计时','沿用整套色调','详情页收尾模块，本项目编辑安排'],
];
export const imageTypeDrafts=slots.map(([slotId,purpose,framing,backgroundRule,sourceMapping])=>({
  templateKey:imageTypeTemplateKey,slotId,sources:imageTypeSources,
  data:{purpose,cameraAngle:'沿用参考图正面视角；不强行旋转标签面',framing,lighting:'左上45°大面积柔光；接触阴影方向一致',backgroundRule,
    mustShow:['参考商品身份','本页已确认文字'],mustNotShow:['额外商品或遮挡标签','虚构功效与凭证'],
    textOverlayRule:'文字置于独立留白区，逐字保留，禁止改写或补字',
    commonFailureModes:['瓶身轮廓、泵头或标签被重绘','已确认中文被替换或产生乱码','商品悬浮或阴影方向冲突'],
    styleVariant:{domestic:'清晰信息分区；确认文字完整，不堆促销装饰',crossBorder:'克制留白，文字简洁；仅为设计参考，非平台合规配置'},sourceMapping,
  } satisfies ImageTypeData,
}));
