# Visual Knowledge Extraction Log

提取日期：2026-10-04。整理：Codex。用途：本项目类目视觉指南与 Prompt／检查规则。洗发水指南 v1 已通过页面创建并确认，具体记录见本文末尾；未读取的外部文件不计为已落地知识。

| 来源与固定版本 | 已读取文件 | 提取与转化目标 | 当前状态 |
| --- | --- | --- | --- |
| [wzj177/ecommerce-image-suite](https://github.com/wzj177/ecommerce-image-suite/tree/2d508bd990df0397026406f210a5915b2c955469)，`2d508bd990df0397026406f210a5915b2c955469`，Apache-2.0 | [references/image-types.md](https://github.com/wzj177/ecommerce-image-suite/blob/2d508bd990df0397026406f210a5915b2c955469/references/image-types.md) | 图型按目的拆分构图；商品结构、颜色、比例与细节保真要求。改写成适用于日化商品的 Guide 图型与主体检查，不照搬服装材质示例 | 已核对固定版本；待人工整理及确认 |
| [motiful/product-shots](https://github.com/motiful/product-shots/tree/063c508b0b7f4db5cda89f10bdf20df25026dfc5)，`063c508b0b7f4db5cda89f10bdf20df25026dfc5`，MIT | [skills/product-shots-main-image/SKILL.md](https://github.com/motiful/product-shots/blob/063c508b0b7f4db5cda89f10bdf20df25026dfc5/skills/product-shots-main-image/SKILL.md) | 同商品多图使用共同参考图锚点；图型选择与生成后检查分离。转为任务素材引用与主体一致性检查 | 已核对；Amazon 白底、占比及平台要求不作为淘宝／JD 官方规则导入 |
| 同上 | [skills/product-shots-detail-page/SKILL.md](https://github.com/motiful/product-shots/blob/063c508b0b7f4db5cda89f10bdf20df25026dfc5/skills/product-shots-detail-page/SKILL.md) | 每模块注入参考图、跨图色彩／光线／商品一致性。转为三层 Prompt 的参考素材注入及套图检查 | 已核对；Amazon A+ 比例、安全区不直接替代现有 5+12 模板 |
| 同上 | `skills/product-shots-image-gen/references/model-selection.md` | 区分参考编辑与含文字任务的能力需求，供 Registry 兼容检查参考 | 固定版本全文获取失败；仅核对 commit 变更摘要，不录为已提取规则，不照搬模型效果结论 |
| 同上 | `skills/product-shots-ad-creative/SKILL.md` 及禁用词 references | 禁忌项与 self-check 的结构化方式 | 固定版本全文获取失败；尚未提取禁用词，不伪造清单 |

用户提供的四个 motiful 名称是实际仓库内的 skill 目录，不是四个独立仓库。外部 Skill 中的执行指令、密钥配置、第三方网关和自动重生成流程不执行；项目仅提取知识，运行时不依赖外部仓库。

V14 页面实测已创建洗发水指南 `5878c350-911f-40fa-874f-710d6f1de167`，版本 1，当前状态 CONFIRMED。对应图型目的、商品身份约束与参考图锚定来源见上述已核对文件。指南中的风险功效词是本项目规则，不冒充未读取的外部禁用词清单。保留源许可与出处；不宣称第三方资料证明官方渠道合规或生成效果。
