# Category Visual Guide 最小实施方案（已批准实施）

## 边界

已执行 V13 → V14 迁移，完整备份位于 `.runtime/before-visual-guide-v14-3cac2604-fe8b-4b0a-9801-dd7d967686f4.sqlite`。迁移检查记录在 `.runtime/visual-guide-v14-verification.json`：历史表行内容与数量不变，FK 为 0。总览整理独立交付；参考图生成、Guide、三层 Prompt 与质量检查作为同一条完整链实施。

## V13 → V14

仅增加一张类目视觉指南版本表：

```sql
BEGIN IMMEDIATE;
CREATE TABLE category_visual_guides (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','SUPERSEDED')),
  guide_data TEXT NOT NULL CHECK (json_valid(guide_data) AND json_type(guide_data) = 'object'),
  source_references TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(source_references) AND json_type(source_references) = 'array'),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(category_id, version),
  CHECK (status = 'DRAFT' OR confirmed_at IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX category_visual_guide_confirmed
  ON category_visual_guides(category_id) WHERE status = 'CONFIRMED';
PRAGMA user_version = 14;
COMMIT;
```

部分唯一索引用于保证生成时只有一个确定的生效指南。新版本确认事务先将旧确认版本转为 SUPERSEDED，再确认新版本；指南内容按版本追加，不覆盖旧版本。没有人工确认过的外部建议不能自动变成正式规则。

迁移前完整备份 SQLite，记录各业务表数量、主键、FK。旧数据不回填指南，原素材、任务、设计稿、审核及导出关系不变。任一步失败回滚；已完成迁移后的恢复使用完整备份，不删除新表伪装回滚。

## 结构化指南

`guide_data` 保存图型构图、商品身份约束、风格、渠道适用范围、禁忌项。禁忌项包含稳定 code、说明、严重性、检查方式（程序／视觉辅助／人工），不能将外部经验写成官方平台强制规则。类目经验不能作为商品成分或功效事实。

`source_references` 保存仓库、文件、commit、提取日期和改写说明。提取日志链接到指南版本；当前未创建记录，不虚构记录 ID。

## 生成链

1. 已确认商品事实与真实参考素材：锁定商品名、规格、瓶身、包装及标签，素材必须属于当前 SKU。
2. 已确认类目指南与图型要求：构图、风格、渠道约束和禁忌项。
3. 当前页面 Brief、已确认文案与内容方向：页面用途、版式、需要呈现的信息。

优先级为商品事实 > 类目指南 > 页面要求。冲突在提交前显示，不靠模型自行决定。实际任务快照保存三层输入、Guide ID/版本、参考素材 ID/hash、最终 Prompt 和实际模型。

通过现有 IMAGE_GENERATION → Registry → 百炼 Adapter 调用已核实支持参考图的模型，不接入外部 skill 的第三方网关。生成后的完整图作为完整候选采用，不能再次叠加商品。历史背景产物保留原有渲染解释；历史版本不重绘、不重新审核。

## Quality Gate 与验证

指南禁忌项进入已有质量检查清单：程序检查尺寸、可验证文案／事实约束；多模态辅助检查主体、包装、中文和多余对象；人工决定最终采用。参考图条件生成仍可能重绘标签，不承诺自动保持主体或自动合规。

复用 jobs/tasks/artifacts、候选采用、版本、重试与审核链，不建第二套任务系统。验证参考素材真正进入请求、三层快照可追溯、完整图不重复合成、禁忌项进入检查、已确认内容不被生成自动覆盖，以及真实 LEADR 单页候选 → 质检 → 人工审核 → 导出。
