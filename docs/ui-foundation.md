# 基础组件使用约定

## 批次边界

第 0 批建立组件与词表，不替换页面，不删除旧样式。后续顺序：总览/项目、市场、内容、资料与设置。每批先记录改前截图，再接入、回归、记录改后截图，最后核对旧样式引用。

`components/StatusBadge.tsx` 和 `status-vocabulary.ts` 当前仍服务旧页面；它们不是新组件的状态来源。逐批迁移到 `components/StatusTag.tsx` 与 `status-catalog.ts` 后，才移除旧映射。不得让同一个已迁移页面混用两种映射。

## 样式入口

新组件使用 `components/foundation.css`（包含 `design-tokens.css`）。页面迁移批次才从前端样式入口统一导入，当前不导入，确保第 0 批不改变页面视觉。所有规则限定在 `ui-*` 类，token 作用域是 `.ui-foundation`。

## 状态

```tsx
<StatusTag domain="opportunity" status={opportunity.status}/>
<span>规则检查</span><StatusTag domain="ruleCheck" status="PASS"/>
<span>AI 辅助检查</span><StatusTag domain="aiCheck" status="PASS"/>
```

必须指定对象域；同名枚举不能跨域解释。中性=灰、待处理=橙、处理中=蓝、已确认=弱绿、失败/阻断=红、未识别=中性描边。排队和运行同语气但文字/图标不同；超时和失败同语气但文字/图标不同。不根据已用时推断超时。

待确认用于采用候选/版本；待审核用于对内容通过或退回。AI 未发现明显问题为中性、无对勾。样本核对结论和历史检索结果使用中性文字，不接 StatusTag。开发/测试遇到未知状态报错；生产显示“状态异常”，原始状态只在 title 提示中。

`active` 是任务汇总值，`running` 是单任务状态，显示一致不表示合并状态机。人工任务进行中、项目评估中/开发中均为中性，蓝色只用于后台运行。

## 按钮与页头

```tsx
<Button onClick={openObject}>查看</Button>
<Button variant="text" onClick={close}>取消</Button>
<PageHeader title="产品项目" primaryAction={{children:'新建项目',onClick:create}}/>
<Card compact>摘要</Card>
```

Button 默认次级、`type="button"`；表单提交显式设置 `type="submit"`。`busy` 禁用按钮并提供 aria-busy，调用方提供符合实际的按钮文案，不生成假进度。

每个页面最多一个实心主按钮；列表行内一律次级。抽屉/弹窗可有独立主按钮。内容工坊根据当前 Tab 和已有状态选择唯一主动作，不能在组件层重新计算业务资格。PageHeader 复用既有组件，新增可选 `primaryAction`，`actions` 放次级操作；旧调用本批保持不变。

## 来源

```tsx
<SourceTag source="fact" title="来源：当前批次程序统计"/>
<SourceTag source="ai" title="来源：模型分析候选"/>
```

SourceTag 只标识调用方提供的来源，不验证事实、不表达审核或采用。

## DRAFT 核对

当前 Product Brief 和 Listing 的创建路径均在 `apps/server/product-intelligence.ts`：模型输出经 schema 校验后才 INSERT DRAFT，Brief 还执行引用校验。Listing 保存标题和结构化建议。没有创建空白 Brief/Listing 草稿的接口，因此 DRAFT 显示“待确认”。此核对不保证历史候选质量，不改历史记录。
# 第1批补充
总览与项目待办通过 `presentWorkQueue` 稳定分组：失败、领导指派（逾期优先）、其他，组内保留输入顺序。行内操作使用次级按钮；弹窗主操作独立计数。已上市/关闭项目不高亮业务阶段，完成条件与对象深链不变。
# 第 1 批收尾
- 总览隐藏重点项目；非零指标独立展示，零值合并为一行。系统待办按类型/批次折叠，组顺序按首次出现位置、组内保持原顺序，不修改队列排序函数。
- 项目整行可点击并支持 Enter/Space；阶段摘要为三个现有数据计数和一个次级操作。已上市/关闭项目使用检查清单，不表达生命周期进度。
- `Select` 替代页面原生选择框，保留原 `value/defaultValue/name/required/onChange`；表单值仍通过原生隐藏字段提交，浮层支持方向键、Enter、Escape。页面不用自行实现下拉样式。
- Select 保留 8rem 可读宽度（不超过容器），长名称换行，箭头不收缩；不得在旁边再复制当前选中名称。flex/grid 父容器须允许子项收缩（`minmax(0,…)` / `min-width:0`）。
- `tests/browser/select-layout.html` 使用真实组件及页面样式验证窄列几何；菜单限制在视口内，空间不足时向上打开。自动回归另见 `tests/select-layout.test.tsx`。
