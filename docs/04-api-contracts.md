# API 与输出契约

## V5 市场机会接口（2026-09-17，已实现）

| 方法与路径 | 行为 |
|---|---|
| POST `/api/market/opportunity-preview` | 输入 `batchId + entryIds`；服务端重算历史同款、新品信号、纳入/排除项、关键词来源、价格分布和缺失证据，不落库 |
| GET/POST `/api/product-opportunities` | 查询产品机会 / 保存机会，同时创建不可分离的 `market_evidence` 证据快照 |
| GET `/api/product-opportunities/:id` | 读取机会、来源条目分析、关键词来源及已关联项目数量 |
| POST `/api/product-projects/:id/opportunities` | 只允许 READY 且类目相容的机会加入项目；复用 `project_evidence` 并写 `OPPORTUNITY_LINKED` 时间线 |

机会分析只纳入 `confirmed` 与 `firstSeen` 条目；`old`、`suspectedRelist`、`pending` 明确排除。保存时不信任前端预览，后端重新读取批次、历史记录与人工核对结论。每个关键词必须引用本次纳入的竞品记录。系统给出确定性归纳，不自动判定“真正新品”，也不替代人工判断配方、包材和营销方式是否可复刻。

榜单 CSV 现包含原 8 列及类目、价格、卖点原文、成分配方线索、包装形式、营销方式、达人直播依赖。历史 8 列数据读取时补为空值，原始记录与主键不改；导出统一使用完整 15 列。

## V4 产品业务接口（2026-09-17，已实现）

| 方法与路径 | 行为 |
|---|---|
| GET `/api/business-summary` | 项目阶段、证据/SPU/SKU 数量、最近业务事件和最近内容产出 |
| GET `/api/categories` | 类目树节点及该类目最新属性模板 |
| GET `/api/content-templates` | 可用渠道内容模板；首版包含淘宝日化商品图 5+12 |
| GET/POST `/api/market-evidence` | 市场证据列表 / 新建带来源、摘要和原始备注的证据 |
| GET/POST `/api/product-projects` | 产品项目列表 / 新建草稿项目 |
| GET/PUT `/api/product-projects/:id` | 完整项目聚合 / 乐观锁更新项目与阶段 |
| POST `/api/product-projects/:id/evidence` | 关联已存在的市场证据并写时间线 |
| POST `/api/product-projects/:id/spus` | 在项目下建立 SPU；校验项目类目一致性 |
| POST `/api/spus/:id/skus` | 建立 SKU，复用现有 products 与 product_versions |
| GET/POST `/api/channel-deliveries` | 查询 / 记录 SPU、SKU、渠道及内容版本交付 |
| GET/POST `/api/business-feedback` | 查询 / 按 SKU 和渠道记录时间段经营反馈 |

项目详情一次返回项目、类目模板、证据、SPU、SKU、套图、交付、反馈和事件，供现场演示完整链路。写操作严格校验项目、SPU、SKU 和套图归属；阶段只允许按当前简单状态机推进或关闭。

## 任务接口与当前完成范围

2026-09-16 当前实现支持 export、copy 与 image。提交 body 严格为 kitVersion、operation、pageIds；image 额外要求 imageMode（draft/quality/premium），Idempotency-Key 为 UUID。profileId/profileVersion/任意 parameters 不接受，模型允许列表、配置与提示词由服务端锁定。旧 POST /api/kits/:id/exports 已撤下，GET /api/exports 及历史下载保持。

已实现 GET /api/kits/:id/copy-candidates（最近 100 个候选）、POST /api/kits/:id/adoptions（Idempotency-Key；baseVersion、artifactId、content）、POST /api/tasks/:id/reconciliation（conclusion、evidence、reviewer）。content 严格为 headline、subtitle、body、evidenceIds、notes，约束见 packages/contracts/copy.ts。conclusion 仅 not_completed / completed_unretrievable。采用验证归属、商品版本、设计稿版本和排版；核对只记录人工结论，不自动再次生成。

已实现 GET /api/kits/:id/image-candidates、POST /api/kits/:id/image-adoptions 与 GET /api/artifacts/:id/content。draft=`z-image-turbo` 只生成场景草图，不允许采用；background=`wanx-background-generation-v2` 将透明商品主体上传到与模型绑定的百炼临时存储，再异步生成电商背景；quality=`qwen-image-3.0-pro`、premium=`wan2.7-image-pro` 属于生成式编辑，包装文字和边缘必须人工核对。供应商任务号在轮询前持久化，查询中断可恢复且不重复创建任务；临时结果 URL 必须下载、校验并保存为本地产物后任务才成功。采用后创建新设计稿版本并清除本页审核。

job 增加 usage:{inputTokens,outputTokens,imageCount,cost}，无法得知的用量为 null，cost 当前恒为 null；聚合为已记录用量。所有响应带服务生成的 X-Request-Id，异常处理器返回 error:{code,message,requestId,resolution}，前端可凭编号定位日志。

**下面早期任务表格为设计历史，其中 profile 参数、artifactIds 数组与 artifacts/content 尚未实现；不得作为当前客户端契约。当前任务输入输出以 packages/contracts/tasks.ts、copy.ts 和本节为准。**

以下表格中涉及模型或采用的行为为已批准目标，不代表已实测；导出阶段的 job 响应为 {id,kitId,kitVersion,name,createdAt,operation,state,tasks}，子任务携带 progress/total、stage、error、recoveryAction、exportId。取消返回 cancelledIds、uncancelledIds 和 job；恢复仍返回同一 job。

本节及 [任务工程设计](07-task-engineering.md) 是下一阶段依据，取代后文旧项目/联盟任务接口设想。全部为本系统内部契约，不是供应商接口。不会同时维护两套生成 API。

| 方法与路径 | 输入 / 返回 |
|---|---|
| POST /api/kits/:id/jobs | 必填 Idempotency-Key；body: kitVersion、operation（copy/image/export）、pageIds（export 必须为整套）、profileId（生成必填）、profileVersion、parameters。服务端锁定资料和完整输入；201 不使用，统一 202 返回持久 jobId、任务统计与轮询地址。|
| GET /api/jobs?kitId=&cursor=&limit= | limit 默认 20、最大 100；createdAt 与 id 稳定游标；返回 items、nextCursor。|
| GET /api/jobs/:id | 固定输入版本、子任务状态计数、逐页结果引用、错误和费用状态；无可信百分比时 percent=null。|
| POST /api/jobs/:id/cancel | 只取消未领取的 queued 子任务，与 worker 领取使用同一事务条件；返回 cancelledIds、uncancelledIds 及原因。已执行部分不假装取消。|
| POST /api/tasks/:id/resume | 带 Idempotency-Key；仅恢复明确安全的本地保存/渲染失败，或继续供应商只读查询。外部接受状态未知且不可查询时 409 RESULT_UNCERTAIN；绝不隐式重发生成请求。|
| POST /api/kits/:id/adoptions | Idempotency-Key；baseVersion、artifactIds。产物必须属于该商品、对应页面且可用；商品资料版本需与任务一致。事务创建新 kit version，受影响页审核取消；冲突 409，不自动合并。|
| GET /api/artifacts/:id/content | 按产物编号读取有效文件；校验业务归属、存在性，不接受文件路径或任意下载 URL。|

正文不接受供应商地址、密钥、费用值、任务状态或内部 lease 字段。pageIds 必须唯一且属于所提交 kitVersion；生成能力与参数按已验证配置检查，缺失能力返回 503，不创建空任务。

同幂等键、同规范输入返回原 job/结果，同键不同输入 409 IDEMPOTENCY_CONFLICT；校验幂等记录必须先于“当前版本已变化”检查，使已成功请求的网络重发仍能取回原结果。幂等作用域包括资源和操作，保留至相关记录清理获得批准。恢复和采用也不能仅依赖前端禁用按钮。

统一错误拟扩展为 error:{code,message,requestId,resolution}，requestId 用于查脱敏日志，不暴露异常堆栈。所有写操作校验严格结构。400 输入错误，404 资源缺失，409 版本/状态/幂等冲突，429 队列或额度限制，503 能力未准备好。供应商超时不能简单映射为可重试 500。

工程实施时同步替换现有 POST /api/kits/:id/exports 的同步调用及前端下载流程，不做双轨兼容；既有导出记录与下载链接继续保留。现有 POST /api/ai/:capability 未实现占位接口应在统一任务接口接通时撤下，不接出第二条调用链。

以下为我们系统的拟定内部 API，不是淘宝或任何模型官方接口。供应商 endpoint、签名、权限、分页、频控和模型参数在具体适配时核实，不假定兼容。

## 本轮已经实现的内部 API

2026-09-15：下面接口为当前应用实际实现；后文旧联盟/付费任务接口仍为设计，未实现。

| 方法与路径 | 行为 |
| --- | --- |
| GET /api/health | 本地服务状态 |
| GET/POST /api/products | 列表 / 新建独立商品 |
| GET/PUT /api/products/:id | 读取 / 以 baseVersion + data 保存新资料版本 |
| GET /api/products/:id/versions/:version | 不可变历史资料 |
| GET/POST /api/products/:id/assets | 素材列表 / multipart 上传，要求来源与使用权确认 |
| GET /api/assets/:id/content | 以随机 ID 访问真实原图 |
| GET/POST /api/products/:id/kits | 套图列表 / 创建 5 张主图和 11–20 张详情结构 |
| GET/PUT /api/kits/:id | 读取 / 乐观版本保存；修改内容会清除相关审核 |
| GET /api/kits/:id/revisions | 版本列表 |
| GET /api/kits/:id/revisions/:version | 历史设计稿 |
| POST /api/kits/:id/restore | 以 version + baseVersion 恢复为新版本，重新审核 |
| GET /api/kits/:id/check | 返回明确待完善项，不虚构自动法规审核 |
| GET /api/kits/:id/pages/:pageId/preview | 当前保存版本的 SVG 预览，不接受任意素材路径 |
| POST /api/kits/:id/exports | 以 version 锁定导出；本地有界串行栅格化，无付费模型 |
| GET /api/exports | 最近 100 条导出记录 |
| GET /api/exports/:id/download | 下载已完成 ZIP |
| GET /api/connections | 四项外部能力的真实未接入状态，无密钥值 |
| POST /api/ai/:capability | 当前明确返回 503 CONFIGURATION_MISSING，无模拟生成 |

输入使用 `packages/contracts/domain.ts` 的严格 schema；不认识的字段拒绝。错误为 `{error:{code,message}}`，不返回堆栈或文件路径。导出为同步操作，不能把本轮说成有持久付费任务队列。未实现的旧接口返回 404。

## 后续业务接口（设计）
| 方法与路径 | 输入要点 | 输出/行为 |
| --- | --- | --- |
| POST /api/projects | name、objective | 201 project |
| GET /api/projects | cursor、limit | items、nextCursor |
| PATCH /api/projects/:id | name、objective | 更新项目 |
| GET /api/connections | 无 | 配置摘要、configured、每项 capability 状态；绝不返回凭证 |
| POST /api/connections | provider、credentialEnvNames、已支持的 endpointProfile、limits | 保存元数据，不声称连通 |
| POST /api/connections/:id/probes | capability | 创建只读能力验证任务；可能收费的探测需要先明确成本 |
| POST /api/projects/:id/product-search-tasks | connectionId、query、平台支持的 filters | 202 task；范围由权限决定 |
| POST /api/projects/:id/products | searchResultId | 引用已持久化候选结果，加入项目 |
| GET /api/projects/:id/products | cursor、filters | 商品摘要与最新快照标识 |
| POST /api/projects/:id/analysis-tasks | snapshotIds、connectionId、modelId、objective | 202 task |
| POST /api/projects/:id/image-tasks | snapshotId、referenceAssetIds、connectionId、modelId、prompt、parameters | 202 task |
| GET /api/tasks/:id | 无 | 状态、阶段、进度、输出引用、用量、错误 |
| GET /api/tasks | projectId、status、cursor | 持久任务列表 |
| POST /api/tasks/:id/cancel | 无 | 仅未外发排队任务可取消；其他返回 409 |
| POST /api/assets | multipart 图片、projectId、source、rightsConfirmation | 校验并保存资产 |
| GET /api/assets/:id/content | 无 | 有效文件内容；不接受磁盘路径参数 |
| PUT /api/projects/:id/asset-selection | productId、purpose、assetId | 校验归属后设置采用版本 |

推广/订单 API 待官方能力验证后补充实际契约，不能先设计假成功返回。

## 统一任务格式
```json
{
  "id": "task_example",
  "kind": "image_generation",
  "status": "waiting_external",
  "stage": "provider_processing",
  "progress": {"completed": 0, "total": 1, "percent": null},
  "output": null,
  "usage": {"cost": null, "currency": null, "costStatus": "unavailable"},
  "error": null
}
```
没有可信百分比就使用阶段状态，不按计时器伪造进度。成功输出分别引用 reportId、assetIds 或 searchResultId，不能把供应商响应直接透传前端。

## 幂等
所有任务提交要求 `Idempotency-Key`。作用域包含项目和操作类型；规范化输入哈希在服务端计算。同键同输入返回原任务，同键不同输入返回 409 IDEMPOTENCY_CONFLICT。用户主动生成新版本使用新键。内部幂等不能保证外部 exactly-once；网络不确定时按对账状态处理。

## 能力而非任意参数
连接 capability 状态：unconfigured、unverified、available、denied、expired、unsupported。检查接口能用不代表所有能力能用。

能力定义包括：operation、协议版本、是否支持参考图、支持尺寸、图片数量上限、输出方式（同步/外部任务）、查询能力与幂等支持。未知参数在提交前拒绝，不默默丢弃。

供应商适配器按职责拆分：
- 商品：search、fetchSnapshot；返回 normalized fields 和字段来源。
- 分析：analyze；返回待验证结构与 usage。
- 生图：submit、可选 poll；结果是 completed、accepted 或明确错误。
- 推广：权限验证后单独实现，不塞进商品查询适配器。

只有供应商协议和模型均已实测的组合才标为支持。新增账号可以配置信息，新增协议需要实现代码和契约测试。

## 分析输出 Schema（示意）
```json
{
  "schemaVersion": "1",
  "summary": "基于已有数据的比较结论",
  "findings": [{
    "claim": "具体观察",
    "evidence": [{"snapshotId": "snapshot_example", "fieldPath": "price.amountMinor"}],
    "interpretation": "推断及适用条件"
  }],
  "missingData": ["采购成本"],
  "suggestedActions": ["补充成本后再比较利润"]
}
```
引用必须属于本任务输入快照、字段必须存在；程序计算确定性数值。模型文字与结构通过校验后才成为正式报告。校验不能保证所有语义正确，页面仍需展示证据供用户检查。

## 商品输出
最小字段：platform、externalId、title、capturedAt；price、image、coupon、commission 均允许缺失并注明原因。每个数值附单位和口径，sourceMetadata 保留接口/协议标识。不得把返佣引单量映射为真实销量。

## 错误格式
```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "该连接未获商品查询权限",
    "requestId": "request_example",
    "resolution": "review_connection_permissions"
  }
}
```
错误包括 CONFIGURATION_MISSING、PERMISSION_DENIED、AUTH_EXPIRED、RATE_LIMITED、BUDGET_EXCEEDED、INVALID_INPUT、PROVIDER_UNAVAILABLE、OUTPUT_INVALID、RESULT_UNCERTAIN、ASSET_SAVE_FAILED。

响应不包含供应商密钥、完整请求头、内部堆栈或含凭证的远程 URL。错误是否可重试由操作与外部协议共同决定，不能仅靠 HTTP 5xx 自动重发 POST。
# 市场研究接口（2026-09-16）

- `GET /api/market/template`：UTF-8 BOM CSV 空模板。
- `POST /api/market/preview`：`{ batch, csv }`，校验元信息及全部行，不保存。
- `POST /api/market/batches`：相同输入，事务保存原始行与标准字段。
- `GET /api/market/batches`：批次列表及行数。
- `GET /api/market/batches/:id/entries?q=&verdict=`：批次内搜索及最新结论筛选，按该批指标降序。
- `GET /api/market/entries/:id/candidates`：现有记录中条码、链接或品牌与标题相同的疑似关联，携带来源。不是新品分类结果。
- `POST /api/market/entries/:id/reviews`：`relatedEntryId`（可空）、`verdict`（old/candidate/different/unknown）、`reason`、`evidence`、`reviewer`。追加核对历史。
- `GET /api/market/batches/:id/export?q=&verdict=`：相同筛选条件导出，包含原始行、来源、口径、最新结论及关联记录编号，转义表格公式。
