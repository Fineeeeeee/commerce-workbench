# GitHub 项目调研与选型

核实日期：2026-09-15。证据来自 GitHub API、README、指定源码及工作流状态。没有安装或运行这些项目，没有完成安全审计或真实电商/模型联调。星数与近期推送不等于成熟度。

## 结论
不整体 fork 某一仓库。独立实现业务，参考 MediaForge 的商品创作流程、InvokeAI 的模型服务边界、Refine 的资源页组织。原因：当前需求同时涉及淘宝联盟数据与外部模型素材生产，没有发现直接覆盖全链路并经本次验证可投产的仓库。

| 项目 | 核实情况 | 有价值的设计 | 本项目取舍 |
| --- | --- | --- | --- |
| [MediaForge](https://github.com/arjun-go-go/mediaforge) | MIT；6 stars；2026-06-25 创建；2026-08-09 推送；README 明示早期开发 | 商品库、创作参数、任务详情、生成上下文 | 最贴近业务。参考流程，不引入其多租户、向量检索、自动修复链和整套运行基础设施 |
| [InvokeAI](https://github.com/Invoke-ai/InvokeAI) | Apache-2.0；约 2.8 万 stars；近期有推送 | 素材组织、生成队列、独立供应商实现 | 参考生成与资产边界，不搬整套创作引擎 |
| [Refine](https://github.com/refinedev/refine) | MIT；约 3.6 万 stars；2026-09-10 推送 | 资源、数据 provider、表格、抽屉、定制页面 | 参考后台交互；暂不引入额外 CRUD 框架，首版核心是跨资源的任务流程 |
| [NocoBase](https://github.com/nocobase/nocobase) | 活跃；GitHub 许可识别为 NOASSERTION，需读实际 LICENSE.txt | 数据建模、权限、工作流和插件 | 是企业表单类系统候选，但本项目优先定制素材与任务体验。不能按 MIT 项目处理其许可 |
| [coupons](https://github.com/silently9527/coupons) | GPL-3.0；598 stars；最后推送 2024-09-11 | 淘客商品列表、分类、商品详情、推广入口 | 偏消费者优惠券应用；README 的 Java 8/MySQL 5.7 等环境与 PC 未适配不符合当前目标，不直接采用 |

## 读到源码的证据

### MediaForge
观察提交：`777ad233b1ebfc1040090518a10ef6ea74d443fd`。该提交 GitHub CI 报告成功；本次未在本机运行其测试，不能据此宣称真实模型集成通过。

- [batch.py](https://github.com/arjun-go-go/mediaforge/blob/777ad233b1ebfc1040090518a10ef6ea74d443fd/mediaforge/gateway/routers/batch.py)：提交生成任务，返回 202 与 job_id，适合耗时任务入口。
- [openrouter_client.py](https://github.com/arjun-go-go/mediaforge/blob/777ad233b1ebfc1040090518a10ef6ea74d443fd/mediaforge/workers/openrouter_client.py)：模型参数封装、输出解析、日志摘要。其共享 POST 请求函数对读取/写入超时等情况执行自动重试，生成路径使用它。我们的付费任务必须先判断请求是否已被外部接受，不能直接照搬。
- [test_batch_persistence.py](https://github.com/arjun-go-go/mediaforge/blob/777ad233b1ebfc1040090518a10ef6ea74d443fd/tests/test_batch_persistence.py)：可见生成 worker 使用 mock；测试资产结果流转不等于验证第三方模型真实可用。
- README 列出的 PostgreSQL、Redis、Celery、Milvus、MinIO 和 LangGraph 覆盖多租户和检索场景；首版没有这些全部需求。

### InvokeAI
- [external_generation_base.py](https://github.com/Invoke-ai/InvokeAI/blob/main/invokeai/app/services/external_generation/external_generation_base.py)：独立 provider 接口与配置状态查询。
- [providers 目录](https://github.com/Invoke-ai/InvokeAI/tree/main/invokeai/app/services/external_generation/providers)：已看到 alibabacloud、gemini、openai、seedream 分开实现。
- [services 目录](https://github.com/Invoke-ai/InvokeAI/tree/main/invokeai/app/services)：图片记录、文件、boards、队列等分离。借鉴职责边界，不代表照抄其全部接口。

### Refine / NocoBase
- [Refine CRM 示例](https://github.com/refinedev/refine/tree/main/examples/app-crm-minimal/src)：路由、组件、数据 provider、认证 provider 分离；这些是前端业务组织能力，不是淘宝服务端连接器。
- [NocoBase LICENSE.txt](https://github.com/nocobase/nocobase/blob/main/LICENSE.txt)：观察到 2026-02-24 更新的具体许可协议；若改为直接采用，需按使用方式完整核对，而不能仅依赖 GitHub 标签。

## 参考方式
本轮仅形成原创需求文档与线框图，没有复制仓库源码或图片。未来如果复制具体实现，必须记录来源、许可和版权告知。供应商 API 一律回到官方文档核实，不能拿第三方项目的 model ID、endpoint 或字段当作当前官方契约。

## 首接平台的现实约束
- [淘宝联盟官方新手指南](https://developer.alibaba.com/docs/doc.htm?articleId=118970&docType=1&source=search&treeId=713)：需要媒体备案、AppKey 与权限申请，高级权限可能邀约。
- [淘宝费用规则](https://developer.alibaba.com/docs/doc.htm?articleId=104559&docType=1&treeId=713)：已核实每日部分 API 费用减免；减免不授予数据权限，不能保证个人账号获得所有商品/订单接口。
- 京东为下一阶段适配器；当前不承诺淘宝以外的真实接入。

## 决策变化说明
最早推荐 NocoBase 是按通用企业内部系统考虑。需求明确为无店铺选品、图像创作与多模型调用后，主要难点集中到任务和素材状态，因而现在倾向独立小型业务系统。若未来主体变为大量表单、审批和多部门权限，应重新比较，而非立即叠加另一套平台。
