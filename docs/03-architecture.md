# 系统架构与数据设计

## V4 第一阶段（2026-09-17，已实施）

系统的业务聚合根由“当前商品套图”调整为产品项目，完整链路为市场证据 → 产品项目 → SPU → SKU → 内容与创意 → 渠道交付 → 经营反馈。仍采用单体 Fastify 服务、React 前端、SQLite 和私有文件存储，没有引入微服务、消息队列或工作流引擎。

数据库版本 4 新增 `categories`、`category_template_versions`、`content_templates`、`product_projects`、`project_stage_events`、`market_evidence`、`project_evidence`、`spus`、`channel_deliveries`、`business_feedback`。`products` 明确作为 SKU，只新增可空 `spu_id`；`kits` 保留必填 `product_id`，新增 `spu_id`、`sku_id`、`channel` 与 `content_template_id`。这一设计让旧商品、素材、任务、候选、套图版本和导出继续使用原主键与关联。

产品项目使用七个明确状态，不建设通用流程引擎。阶段变化与关键动作追加到 `project_stage_events`。类目属性保存在版本化 JSON 模板，首版只提供日化个护 / 洗护发 / 洗发水及其六组属性。内容模板首版提供“淘宝日化商品图 5+12”。

V3 → V4 前使用 SQLite `VACUUM INTO` 创建一致性备份。迁移只接受具备商品、商品版本、套图、套图版本四张核心表的已知 V3 结构；残缺或未知结构不进入 V4。现有 LEADR 500ml 商品保持原 product ID，关联到新建项目与 SPU；所有旧套图仍通过原 product_id 读取。

## 阅读与实施顺序（2026-09-16）

当前已实现商品内容六张表、市场研究三张表及任务六张表，数据库版本 3。后台导出使用持久任务与独立 worker；真实模型和费用结算仍未接入。

完整任务设计及实际完成范围见 [任务工程设计](07-task-engineering.md)。本文下方较早的同步导出描述和“后续联盟与付费任务实体”仅保留历史背景，当前执行以该文档实施记录为准；独立商品模式不改回依赖 projects。当前技术选择继续保留：单业务服务、单机 SQLite、私有文件；首版任务执行不引入 Redis 或消息中间件。

状态：2026-09-15 用户已批准下述本地素材生产数据结构，开始实施。原联盟与付费任务设计保留为后续方向，不能当成本轮已实现功能。

## 本轮实施决策

- 以独立商品为业务入口，不要求平台 ID；无淘宝账号也可使用。
- SQLite 使用当前 Node 24 的 `node:sqlite`，锁定 Node 24.15 以上的 24.x 运行环境。该模块在此版本仍为实验状态，仅用于本地试点；采用 prepare/run/all/get 等基础 API 并测试重启持久化。
- 当前 schema：`products`（最新资料版本）；`product_versions`（不可变资料 JSON）；`assets`（商品归属、内容哈希、格式、尺寸和来源）；`kits`（商品关联、当前版本）；`kit_versions`（不可变整套页面 JSON、绑定商品版本）；`exports`（导出版本、状态、文件及错误）。外键和乐观版本检查防止跨商品引用、旧页面覆盖新数据。
- 每套固定 5 张主图，详情页允许 11–20 张，默认 12 张。每页保存用途、标题、副标题、正文、素材、背景色、版式、商品缩放及文案来源引用。模板只提供内容结构，文案不是模型生成。
- 服务端统一 SVG 模板用于预览，Sharp 将同一模板栅格化；批量 ZIP 包含有序 PNG 和可编辑设计 JSON，不称为 PSD。页面需完成文案、素材、来源引用与人工确认才可正式导出；每次修改清除相关审核。
- 保存采用不可变版本；历史恢复作为新版本，导出绑定固定版本。上传校验解码格式、尺寸与文件上限；字体固定本机可用中文字体。文件置于私有目录，随机 ID 访问。
- AI 文案、生图、热点与 PS 尚未实现。返回明确未配置/未接入，绝不使用本地模板伪装 AI。付费队列在协议确定后实施；本轮本地导出为同步有界任务，保留执行记录，不新增未批准的队列表。
- 此 schema 首次创建只接受空数据库或已知 schema 版本，拒绝自动迁移未知数据库。导入用户材料须显式执行工具，不把真实产品硬编码为应用初始数据。

## 技术决策
- React + TypeScript + Vite：桌面业务前端，使用成熟表单/表格/弹窗组件，定制项目和素材工作区。
- Node.js + TypeScript + Fastify：单一业务服务；worker 独立进程，共享内部 contracts 和数据库访问模块。
- SQLite（WAL、本地磁盘）：当前单用户场景下承载业务与持久任务；短写事务和 busy timeout，不使用网络共享磁盘。不承诺任意规模扩展。
- 私有本地文件存储：图片按随机资产 ID 管理，通过业务接口访问；不暴露任意文件路径。
- 不增加 Redis、向量库或图编排框架。具体依赖版本和 API 实施前查官方资料并锁定。

以上选择针对本地单人首版，不是企业服务器高可用方案。未来多人需求需要重新评估数据库和部署，不写一套没有实际需要的双数据库兼容层。

## 服务边界
浏览器 → 业务 API → 业务记录与任务（同一事务）→ worker → 供应商适配器 → 校验与文件保存 → 结果入库 → 页面读取。

前端禁止直接连接淘宝或模型。服务端仅监听回环地址；限制允许的 Origin/Host，拒绝跨站写请求，不启用通配 CORS。对文件读取、项目关联、任务关联逐项校验。公网发布不在本轮范围。

## 后续联盟与付费任务实体（设计参考，非本轮建表清单）
| 表 | 关键字段/约束 |
| --- | --- |
| projects | id、name、objective、created_at、updated_at |
| connections | id、provider、credential_env_names、endpoint_profile、capabilities、limits、config_version；不保存明文凭证 |
| products | id、platform、external_id；平台与外部标识联合唯一，不猜测不同平台相同商品 |
| product_snapshots | id、product_id、captured_at、normalized_data、source_metadata；不可变 |
| project_products | project_id、product_id；联合唯一；记录选择的 snapshot |
| tasks | id、project_id、kind、status、input_snapshot、connection_config_version、lease_owner、lease_until、created_at |
| task_attempts | id、task_id、phase、external_request_id、external_job_id、sanitized_error、started_at、finished_at |
| reports | id、task_id、schema_version、validated_output、prompt_version |
| assets | id、task_id、project_id、product_snapshot_id、relative_path、mime、bytes、sha256、source、rights_confirmation |
| asset_selections | project_id、product_id、purpose、asset_id；唯一选择键，保留采用变更记录 |
| idempotency_keys | scope、key、request_hash、task_id；联合唯一 |
| usage_ledger | task_id、connection_id、unit、amount、currency、cost_status、reserved_amount；费用口径明确 |
| promotion_records | 获得权限后确认字段；预期关联项目、商品、推广位、链接与时间 |
| effect_snapshots | 获得权限后确认字段；保留返回口径、查询区间、状态，不先编造订单结构 |

源响应仅保留业务必需、脱敏后的字段；访问凭证、含 token 的 URL 和买家敏感数据不作为调试全文长期保存。

## 任务执行与一致性
1. 校验能力、输入、配置版本和幂等键，在短事务中创建 task 及预算预留。
2. worker 原子领取可执行任务并写租约。连接并发限制覆盖所有进程，不仅是内存计数器。
3. 外部请求前记录 attempt 的提交阶段。长任务续租；失效 worker 使用租约代次约束，防止旧进程覆盖新结果。
4. 有外部任务 ID 时持久化 ID，再按供应商协议查询；查询成功后校验输出。
5. 文件先写私有暂存并校验 MIME、尺寸、字节数与哈希，再原子转为最终资产；数据库事务登记资产和成功结果。
6. 外部成功但文件/数据库未成功：进入结果保存阶段重试，只重试保存，不重新生成。崩溃留下未登记文件时列入人工清理，不自动删除。

## 状态机
`queued → running → waiting_external → saving_result → succeeded`

- 校验/权限/明确拒绝：failed，附业务错误原因。
- 外部接受情况未知：needs_reconciliation；若协议可查则对账，不能查询则用户处理。
- 租约过期：提交前可重新排队；已提交则查询外部状态；未知则待核实，不能一律重跑。
- 首版只允许取消尚未外发的 queued 任务。外部运行中不显示虚假的取消成功。
- 失败后的“重新生成”是新付费动作、新任务和新输入版本；不是覆盖历史任务。

## 凭证与额度
首版 UI 保存环境变量名与非秘密配置；用户在启动环境注入密钥，读取接口只返回 configured 布尔值。环境中缺失就阻止该连接执行。更改凭证存储方案前单独评审。

预算可准确预估上限时先原子预留、完成后结算；若供应商无法给出可靠计费上限，只展示用量估算并限制任务数量，不声称系统有严格货币上限。供应商账单可能延迟，费用状态区分 actual/estimated/unavailable。

## 文件与远程响应
- 不把任意用户 URL 直接交给服务器下载。供应商下载地址按协议限制 HTTPS、域名、解析结果和重定向，阻止本地/私网地址；限制大小、时间和内容类型。
- 上传验证实际文件格式，不仅依赖扩展名。下载名称与存储路径分离，阻止路径穿越。
- HTML/Markdown 输出渲染需转义或严格清洗，不执行模型返回脚本。
# 2026-09-16 市场研究结构（已批准并实施）

仅扩展本项目 SQLite，从版本 1 事务迁移至版本 2；保留既有六张表和全部数据。执行前创建数据库一致性备份，迁移失败回滚，不覆盖备份、不自动清理文件。

新增三张表：

| 表 | 字段与职责 |
|---|---|
| market_batches | id、name、source、platform、period_start、period_end、metric_name、metric_unit、imported_at。记录榜单来源、统计区间和排序口径。 |
| market_entries | id、batch_id 外键、row_number、raw_data、normalized_data、created_at；批次与行号唯一。原始行不可覆盖；标准字段包括链接、标题、品牌、规格、店铺、条码（可缺失）、榜单数值、提供的时间证据。缺失不补造。 |
| market_reviews | id、entry_id 外键、related_entry_id 可空外键、verdict、reason、evidence、reviewer、created_at。追加核对历史：老品证据、新品候选、不同款、证据不足；保留依据与人工填写的确认人，不宣称已建立账号认证。 |

首轮入口采用明确列名的 UTF-8 CSV 与导入预览；校验通过且用户提交后整批事务保存。下载字段模板、查看筛选、候选关联、人工核对和导出构成完整流程。所有导出保留来源、统计口径、结论和依据，防止表格公式执行。相同名称只是疑似关联，链接新建和首次采集都不能作为市场首发证明；不做无依据自动删除或跨口径热度排名。

用户已批准三张表及迁移。本模块不新增网络采集、模型调用、凭证配置、商品字段、账号权限或生产相关表。已实现迁移备份与版本检查，以及导入、核对、筛选导出、重启后历史保留的集成测试。
