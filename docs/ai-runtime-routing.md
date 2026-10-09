# AI 模型路由现状

业务任务先映射到 capability，由 `model-capabilities.ts` 读取服务端配置；`model-registry.ts` 记录已核实的模型请求模式，`structured-model-provider.ts` 负责百炼请求、错误分类和本地结构校验。更换同一 capability 的兼容模型只需修改服务端 `COMMERCE_<CAPABILITY>_MODEL` 或 `COMMERCE_<CAPABILITY>_ALTERNATIVES`，不修改业务代码。未知模型先用文本 JSON 加本地校验，不假定支持原生 JSON Schema。

| 业务 | 当前路由 | 旧配置 |
| --- | --- | --- |
| 市场文本整理、关键词归一 | TEXT_FAST | `COMMERCE_MARKET_LIGHT_MODEL` 暂作为默认值兼容入口 |
| 市场机会、Product Brief、SEO、内容方向/质检 | TEXT_REASONING | `COMMERCE_CONTENT_REVIEW_MODEL` 暂作为默认值兼容入口；`COMMERCE_MARKET_ANALYSIS_MODEL` 不再参与路由 |
| 多模态检查 | VISION_INSPECT | 通过 capability 选择，视觉请求仍由现有检查服务执行 |
| 生图 | IMAGE_GENERATION 部分接入 | draft/background/quality/premium 的既有模式和模型变量仍是 legacy；涉及不同图像 API 契约，本轮不改生成链 |
| 内容文案 | legacy `COMMERCE_COPY_MODEL` | 独立生成任务与文案契约仍保持原状，本轮不迁移 |
| 系统建议 | SYSTEM_REASONING | 已通过 capability 选择 |

市场研究重试只读取已保存的批次和程序统计。模型尝试、请求模式、请求 ID、错误及备用原因写入 research job manifest；正式机会仍按原审核流程保存。额度不足或输出无效时仅尝试该任务配置的备用模型：文本整理可使用配置的推理模型，综合分析不会自动降级到轻量模型。
