# commerce-workbench 前端重构方案（评审稿）

> 状态：待评审，未实施
> 范围：apps/web 前端全部页面与样式
> 本文档是 Phase 0 产出物，评审通过后作为后续所有阶段的验收依据

---

## 0. 本轮禁止项（全程生效）

- 不换技术栈（保持 React 19 + Vite + 原生 CSS）
- 不引入 UI 框架（antd / MUI 等）、不引入 Tailwind / CSS Modules、不引入全局状态库
- 不改数据库 schema、不改后端业务规则、不重写 API
- 不增加大规模动画（skeleton 用静态灰块，不做 shimmer）
- 不趁机扩业务模块
- 红线操作（删除文件、安装依赖）执行前逐项单独确认

---

## 1. 现状问题清单（依据代码核对）

| # | 问题 | 位置 | 性质 |
|---|------|------|------|
| P1 | 死代码文件：`image-panel.tsx` 无任何引用（app 只用 `image-panel-task.tsx`） | apps/web/src/image-panel.tsx | 删除 |
| P2 | 死组件：`Overview`、`productProgress` 无引用，功能与 `BusinessOverview` 重复 | workspace.tsx L6-28 | 删除 |
| P3 | 隐藏渲染：market.tsx 渲染榜单表格/筛选器/信号统计/机会区块后用 CSS `display:none` 藏掉 | market.tsx L62、L64-67；market-opportunity.css L3；market-insights.css L3 | 删除（有副作用，见 Phase 1） |
| P4 | 全局类名冲突：`.evidence-list` 在 styles.css（编辑面板卖点证据）与 market-insights.css（原始证据列表）同名不同义，两文件全局加载互相渗透 | styles.css L2；market-insights.css L3 | 作用域收敛 |
| P5 | `.error-banner` 三处定义互相覆盖（文档流 / fixed top:76px / fixed top:12px left:15%），同页可能双横幅叠加 | styles.css；feedback.css L1；market.css L2 | 统一为单一定义 |
| P6 | 全局 `i` 标签选择器污染所有 `<i>` 元素 | styles.css L2 | 改类名 `.v-divider` |
| P7 | 无设计变量：`:root` 仅 4 个变量，上百处硬编码 hex/px；同一语义色多种写法；metric 字号六档（22/24/25/30/32/38px） | 全部 CSS | Phase 2 tokens |
| P8 | 字号低于可读下限：8px/9px 约 20 处 | canvas-meta、mini-art、workflow-note、claims-grid small 等 | 建立文字层级 |
| P9 | 断点七档（1550/1150/1100/900/800/700/600）部分行为重复 | 全部 CSS | 实测后合并 |
| P10 | 内联样式：jobs.tsx 三处 `style={{...}}` | jobs.tsx L34、L48 | 转类名 |
| P11 | 巨型组件：app.tsx 183 行承载 9 视图 + 4 modal；studio 视图独占 40 行嵌套 JSX | app.tsx | Phase 4 拆分 |
| P12 | Modal 样板重复 7 处，且缺 Esc / focus trap / focus 恢复 / 滚动锁定 | app.tsx×3、product-form、market.tsx×4 | 抽组件 + a11y |
| P13 | 四套徽章体系并存：`.outline-badge` / `.signal-*` / `.stage-*` / `.opportunity-status` | 多处 | 统一 `.badge` |
| P14 | 按钮尺寸覆盖散落 10+ 处（font-size 9~12px 局部改写） | 多处 | `.btn-sm/.btn-xs` |
| P15 | 重复选择器：products 视图同时有 SPU 层级树和 `.product-switcher` 平铺按钮选同一事物 | app.tsx L166-167 | 删 product-switcher |
| P16 | `history` 视图不在导航中，只能从 studio 按钮进入 | app.tsx | 并入 studio tab |
| P17 | 交互缺陷：视图切换不回顶部；toast 4200ms；离开确认文案未说明"丢弃修改"后果；禁用按钮原因只放 title tooltip | app.tsx L50/L55/L73；image-panel-task L69 | Phase 3/5 修正 |
| P18 | 状态形态不统一：三种 loading、四种错误展示、`partial` 状态有 label 无 UI 形态 | 全局 | Phase 2 状态体系 |
| P19 | 页面缺"下一步动作"：总览/项目/资料库只展示数据，不回答"现在该干什么" | business-ui、app.tsx | Phase 3 |
| P20 | 信息全量平铺：市场机会卡 dl 全展开、原始证据全量渲染（500 条样本时不可读）、token 费用信息外露 | market-insights.tsx | 三级信息层级 |

---

## 2. Phase 0：页面任务说明

### 2.1 七个核心页面

#### ① 工作总览（BusinessOverview）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 10 秒内知道"现在有什么在进行、我接下来该干什么" |
| 第一主操作 | 点击"最近内容产出"进入上次未完成的设计稿 |
| 第一屏必须看到 | 4 个指标卡（进行中项目/市场证据/SPU/最近产出）、最近业务事件、最近内容产出入口 |
| 二级信息 | 项目阶段分布（stage-board）、完整事件列表 |
| 高级/调试信息 | 无 |
| 完成后下一步 | → 内容与创意（继续制作）或 → 产品项目（推进阶段） |
| 缺失项（需补） | "下一步动作"提示行：如「2 套设计稿有待审核页面 → 去处理」 |

#### ② 市场洞察（Market + MarketInsights）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 判断当前批次榜单里有没有值得立项的机会，并完成人工审核 |
| 第一主操作 | 勾选证据 → "AI 分析所选"；或对 DRAFT 候选点"人工审核" |
| 第一屏必须看到 | 批次概览（样本数/价格中位数/品牌数）+ 机会候选的状态和数量 |
| 二级信息 | 程序统计明细（价格带/规格/缺失率）、卖点组合、每条机会的完整 dl、原始证据全文 |
| 三级信息 | modelVersion、fallbackUsed、promptVersion 判断、核对 modal 原始 JSON、review 历史 |
| 完成后下一步 | 机会 READY → "加入项目" → 产品项目页 |
| 页面顺序（强制） | 批次概览 → 程序事实 → AI 机会候选 → 风险/缺失 → 原始证据 |

#### ③ 产品项目（ProductProjects）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 推进一个项目到下一阶段，知道当前卡在哪 |
| 第一主操作 | "推进至 XX 阶段"按钮 |
| 第一屏必须看到 | 项目名 + 当前阶段 + 下一步动作（需补） + 缺失项（需补） |
| 二级信息 | 8 个 section 完整列表、checklist 明细 |
| 三级信息 | expectedUpdatedAt 乐观锁、事件原始记录 |
| 完成后下一步 | 有 SKU → "进入内容与创意"；内容审核后 → "记录交付" |

#### ④ 产品资料库（products 视图）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 维护某个 SKU 的定义、卖点、素材，确认资料完整度 |
| 第一主操作 | 选中 SKU 后"编辑资料"或"上传图片" |
| 第一屏必须看到 | SPU→SKU 层级树、当前商品核心事实（品牌/规格/版本） |
| 二级信息 | 卖点卡片全文与来源、素材尺寸/格式明细 |
| 三级信息 | 资料版本号、pending 卖点来源追溯 |
| 完成后下一步 | 资料齐全 → "进入内容与创意"（当前缺此出口，需补） |

#### ⑤ 内容与创意（studio）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 完成一套图：填/确认文案 → 生成视觉 → 逐页审核 → 导出 |
| 第一主操作 | 编辑当前页文案并"确认当前文案"；全部审核后"检查并导出整套" |
| 第一屏必须看到 | 当前商品、设计稿状态（未保存/版本/审核进度 n/m）、画布预览 |
| 二级信息 | AI 候选文案、视觉候选图、卖点证据原文、版式/颜色/缩放设置 |
| 三级信息 | templateId、productVersion diff、copyStatus 状态机、幂等键提示 |
| 完成后下一步 | 本页审核完 → 下一页；整套审核完 → 版本与导出 tab |
| 流程顺序（强制） | 选择模板 → 资料完整度 → 文案 → 视觉 → 审核 → 版本 → 导出 |

#### ⑥ 渠道交付（BusinessRecords kind=delivery）

| 维度 | 定义 |
|------|------|
| 用户进来想完成什么 | 查某个 SKU 用哪一版内容交付到了哪个渠道 |
| 第一主操作 | 查看记录（本页只读）；新增必须去项目详情 |
| 第一屏必须看到 | 交付记录列表（渠道/时间/关联内容版本） |
| 二级信息 | 交付备注 |
| 高级信息 | kitVersion 与设计稿的关联追溯 |
| 完成后下一步 | 空态给"去产品项目记录交付"直达按钮（当前只有文字，需补） |

#### ⑦ 经营反馈（BusinessRecords kind=feedback）

同 ⑥ 结构。第一屏：按 SKU/渠道的销量、转化率记录。完成后下一步：数据异常 → 回到内容迭代（提示文案，不做自动跳转）。

### 2.2 三级信息层级规则（全局适用）

| 层级 | 展示方式 | 判定标准 | 现有实例 |
|------|----------|----------|----------|
| L1 一级 | 默认可见 | 直接支撑当前页面主操作 | 指标卡、状态徽章、标题、主按钮、审核进度 |
| L2 二级 | `<details>` 或"展开"按钮 | 决策依据，但每次任务不必看 | 证据全文、风险/缺失明细、统计分布、卖点来源、review 历史 |
| L3 三级 | 嵌套 details 或不渲染 | 调试/审计信息 | modelVersion、fallbackUsed、promptVersion、原始 JSON、token usage |

执行规则：

1. L3 信息保留在 DOM 的唯一理由是审计（如核对 modal 的原始行 `<pre>`），必须放进 L2 details 内再嵌一层
2. `promptVersion === 'market-opportunity-v2'` 判断逻辑保留在代码里，界面徽章「旧规则候选 · 需重新分析」不暴露版本号
3. token usage（jobs.tsx）降为 L3：默认只显示任务状态，费用信息收进 details

---

## 3. Phase 1：低风险清理（不叫"零风险"）

### 3.1 删除前副作用检查清单（每项必过）

```
□ grep 该标识符的全部引用（含动态 import、字符串拼接）
□ 是否被 useEffect / 轮询依赖
□ 是否参与 API query 参数或 sessionStorage key
□ handler 是否被其他组件调用
□ 是否承担版本兼容逻辑（如 promptVersion 判断）
□ npm run typecheck && npm test 通过
```

### 3.2 删除项与检查结论

| 项 | 副作用检查结论 |
|----|----------------|
| `image-panel.tsx` 整文件 | 已 grep：无引用。删除文件属红线，执行前单独确认 |
| workspace.tsx 的 `Overview` + `productProgress` | 已 grep：无引用。连带删 workspace.css 中 `.overview-page/.overview-summary/.overview-product/.overview-columns/.overview-work/.overview-materials/.work-row` |
| market.tsx 被 `display:none` 的 JSX（L62/L64-65/L67） | ⚠️ 有副作用：`q/verdict/signal → query` 参与 entries 与 opportunity-overview 的 fetch URL。须先读 apps/server 对应路由，确认**无参数**与**参数为 all/空串**行为一致才可删 state；导出链接一并删 |
| market.css 的 `.market-summary/.market-table/.market-rank` | 依赖上项结论；`.signal-*` 需 grep tsx 确认 MarketInsights 是否使用后再定去留 |
| styles.css 死类：`.sidebar-note/.note-line/.local-status/.topbar-right/.avatar/.heading-dot/.workspace-label span` | 已核对 JSX 不存在；逐个 grep className 确认后删 |
| market.css L2 `.market-page>.error-banner` | 与 feedback.css 冲突，删（见 3.3） |

### 3.3 CSS 冲突修复（根因层面）

- **`.evidence-list`**：不改类名，改作用域收敛——market-insights.css 的规则全部加 `.raw-evidence` 前缀（该 section 已有此类名）；styles.css 中编辑面板的加 `.editor-content` 前缀。JSX 不动
- **`.error-banner`**：保留 feedback.css 的 fixed 方案作为唯一全局定义；删 market.css L2；market.tsx L61 与 business-ui L35/L59 的局部错误改用 `.notice.warning`（内联、随内容流动）
- **全局 `i` 选择器**：改 `.v-divider` 类，替换 app.tsx L125/L133 两处

### 3.4 CSS 作用域规范（写入本文档 + 项目 CLAUDE.md）

不引入 CSS Modules / Tailwind，立规矩：

1. 新页面必须在根节点声明页面类（如 `.market-page`），页面私有样式一律嵌套在页面类下
2. 全局类只允许出现在 styles.css，且仅限：布局原语（.card/.empty/.actions/.notice）、表单原语、徽章、modal
3. 禁止新增无前缀的通用名词全局类（.list/.grid/.header/.content 这类）
4. 跨页面复用的块用 BEM 风格前缀（如 `.mi-*` 限 market-insights 内部）
5. code review 检查项：新 CSS 规则先问"它属于哪一层"

### 3.5 消灭内联样式

jobs.tsx 三处 → `.card-pad/.job-body/.job-pager`（挂 `.history-page` 根类下）。

### 3.6 验证

typecheck + test + build；手动打开 7 个视图确认**无任何视觉变化**（有变化即引入 bug）。
**本阶段结束时截取视觉 baseline**（见 Phase 5.3）。

---

## 4. Phase 2：Design Tokens + 状态体系 + 通知语义 + 基础组件

### 4.1 完整 Design Tokens（styles.css `:root`，单文件，不新建 tokens.css）

**颜色**：

```css
--ink:#203a3e; --muted:#839095; --teal:#235654; --border:#e3e9e9;
--success-bg:#e6f3ea; --success-ink:#286044;
--warning-bg:#fcf7e9; --warning-ink:#8a5517;
--danger-bg:#fbefed;  --danger-ink:#8b3733;
--surface:#fff; --surface-alt:#f7f9f8; --page-bg:#f4f6f7;
```

色值全部从现有代码收敛，不发明新色。所有 `.signal-*/.stage-*/.opportunity-status/.notice/.image-task-state/.inline-checks/.error-banner` 的硬编码色机械替换为变量。

**Typography（建立文字层级，不是简单提字号）**：

```css
--text-caption:11px;      /* 辅助说明、时间戳、徽章。现 8/9/10px 全部归入，为全局下限 */
--text-secondary:12px;    /* 次要正文、表单帮助文字 */
--text-body:13px;         /* 正文基准（root 14px 保留给表单输入） */
--text-emphasis:15px;     /* 强调正文 */
--text-section:16px;      /* section 标题（补现 h2 18px 与 h3 13px 之间的断层） */
--text-card-title:18px;   /* 卡片/面板标题（现 h2） */
--text-page-title:26px;   /* 页面标题（现 27/28px 收敛） */
--text-metric:30px;       /* 指标大数字（现六档收敛为一档） */
--leading-tight:1.4; --leading-body:1.7; --leading-loose:1.8;
```

执行时逐文件替换裸 font-size；`h3{font-size:13px}` 这类"标题比正文小"的倒挂一并纠正。

**Shadow / elevation（现有 6 种收敛为 3 级）**：

```css
--shadow-1:0 1px 3px #204d3c0d;    /* 卡片、segmented 选中态 */
--shadow-2:0 4px 22px #293e3c17;   /* 悬浮面板、artboard、toast */
--shadow-3:0 20px 80px #142e3433;  /* modal */
```

**z-index 阶梯（现有 15/50/90/100 收敛，相对顺序不变）**：

```css
--z-sidebar:20; --z-banner:60; --z-overlay:70; --z-toast:80;
```

**内容宽度**：

```css
--width-page:1250px;      /* .standard-page */
--width-settings:1050px;
--width-modal-sm:500px; --width-modal-md:720px; --width-modal-lg:820px;
```

**图标尺寸（lucide 现有 12 种收敛为 4 档）**：

```
--icon-inline:14      /* 随文字：徽章、行内提示 */
--icon-control:16     /* 按钮内、导航（现 15/16/17/19 归入） */
--icon-standalone:20  /* 独立/列表图标（现 20/23/25 归入） */
--icon-empty:32       /* 空态大图（现 32/34/38 归入） */
```

**间距 / 圆角 / 布局常量**：

```css
--sp-1:6px; --sp-2:12px; --sp-3:18px; --sp-4:24px; --sp-5:36px;
--r-sm:6px; --r-md:9px; --r-lg:12px;
--sidebar-w:216px; --topbar-h:70px;
```

feedback.css 等处的定位魔数（top:76px/left:240px）替换为基于 `--topbar-h/--sidebar-w` 的计算。

### 4.2 统一页面状态体系

新建 `components/states.tsx`（单文件六导出，不建目录树）：

| 状态 | 组件/形态 | 现状 → 目标 |
|------|-----------|-------------|
| Loading | `<PageLoading/>`（居中 spinner+文案）；区块级静态灰块 skeleton（无动画） | 现三种形态（.business-loading 文本 / .empty spinner / 裸文本"正在检查模板资料……"）统一 |
| Empty | `<EmptyState icon title desc action/>` | 6 处替换；空态必须带动作出口（渠道交付空态补"去产品项目"按钮） |
| Error | 全局：App 层 fixed banner（仅手动关闭，不自动消失）；区块：`.notice-error` 内联 | 见 4.3 |
| Partial Success | `<PartialState done pending onShowPending/>`，文案「{done}/{total} 完成，{pending} 待核对」+ 过滤入口 | tasks 的 `partial` 有 label 无 UI；先用处：TemplatePanel 批量结果、JobPanel（如 28 页中 24 完成 4 待核对） |
| Success | toast + 行内状态徽章 | — |
| Disabled / Missing Data | 禁用按钮必须伴随**可见**的缺失原因文字，不允许只靠 title tooltip | image-panel-task L69 改按钮旁 `.hint` 文本；`.state-missing_data` 形态推广为标准 |

### 4.3 错误 / Toast / Notice 语义规范

| 类型 | 载体 | 消失策略 | 现有实例归属 |
|------|------|----------|--------------|
| success | 全局 toast（顶部居中） | 自动 3000ms | `message()` 全部 |
| info | 全局 toast | 自动 5000ms | 「已提交任务，可离开页面」类 |
| warning | 内联 `.notice.warning` | 手动关闭或条件消除 | outdated 同步提示、missingEvidence |
| error（全局阻断） | fixed error-banner | **仅手动关闭，无超时** | App 层 setError |
| error（区块局部） | 内联 `.notice-error` | 随重试成功消除 | market / business-ui 局部 error |
| field error | 紧贴字段，`aria-describedby` 关联 | 随输入修正消除 | copy issues、表单校验 |

**去重规则**：同一错误只出现一次——API 抛错由捕获它的那一层展示；App 层 banner 只展示未被局部捕获的错误。禁止 toast 与 banner 同时弹同一内容。

### 4.4 基础组件（本轮只建四个，无新依赖）

```
components/Modal.tsx        — 7 处调用点替换
components/PageHeader.tsx   — eyebrow + title + desc + actions，9 处替换
components/Section.tsx      — title / desc / actions / status(徽章或count) / body 五槽位，
                              替换 business-ui 私有 Section、market-insight-section、
                              template-panel-head、editor-heading 四种区块头形态（~15 处）
components/states.tsx       — 4.2 六个状态组件
```

**Modal 可访问性完整清单**：

- 已有：`role="dialog"`、`aria-modal`、`aria-labelledby`
- 补齐：Esc 关闭；focus trap（Tab 循环在 modal 内）；打开时聚焦首个可交互元素；关闭后 focus 恢复触发按钮（useRef 记录 document.activeElement）；背景滚动锁定（body overflow，卸载恢复）
- 实现约 40 行原生代码，不引库
- 关闭按钮 aria-label 统一为 `关闭{title}`

### 4.5 徽章与按钮统一

- 四套徽章 → 一套 `.badge` + 语义 modifier（badge-success/warning/danger/neutral），色值映射到 token；保留 `.signal-*` 的色值对应关系，删另外三套类
- 按钮**不抽组件**（现有 primary/icon-button/text-button 体系无维护痛点），新增 `.btn-sm/.btn-xs`（字号下限 11px）替换 10+ 处局部 font-size 覆盖

### 4.6 验证

typecheck + build；对照 Phase 0 文档逐页目检。此阶段允许视觉变化，但每处变化必须能对应到某条 token/状态规则。

---

## 5. Phase 3：三个核心页面信息架构重排

前置：Phase 0 文档评审通过 + Phase 2 的 Section/状态组件就绪。

### 5.1 市场洞察

现有 section 顺序已符合强制顺序，重排的是每层信息密度：

```
① 批次概览（L1）
   4 指标 + 来源/区间 + 下一步提示：「勾选证据运行 AI 分析」或「有 N 个候选待审核」
② 程序事实（L1 摘要 + L2 明细）
   L1：价格中位数、Top3 高频卖点、整体缺失率
   L2 details：价格带/规格/品牌店铺/缺失率四宫格、卖点组合
   程序事实 vs AI 推断左右对照（fact-inference-grid）保留
③ AI 机会候选（L1 卡片头 + L2 卡内明细）
   L1：状态徽章、标题、摘要、证据覆盖数、主操作（人工审核/加入项目）
   L2 卡内 details：价格带/规格/核心依据/风险/缺失数据 dl（现全量平铺，收起）
   L3：modelMetadata 收进 details 内嵌套层
④ 风险/缺失
   不新增独立区块：随 ③ 的 L2 展示 + 批次级 missingEvidence 汇总条（notice.warning）
⑤ 原始证据（L1 前 20 条 + L2 展开全部）
   现全量渲染 entries（500 条样本不可读）；默认 20 条 +「展开全部 N 条」
```

### 5.2 产品项目（详情页）

```
① 阶段卡（现 project-hero 扩展）——回答"现在该干什么"
   当前阶段徽章 + 推进按钮
   下一步动作与缺失项由共享业务规则函数推导，优先放在 packages/contracts 或复用已有后端规则；
   React 页面只展示推导结果，不复制项目状态转换或完成条件，避免前后端规则漂移。
   推导输入只使用项目当前真实数据：checklist、市场证据、SPU、SKU、内容、交付、经营反馈。
   EVALUATING 等阶段不预设尚未确认的企业流程；例如只有当前 checklist 明确存在且未完成的项目，
   才能显示对应缺失项。没有真实数据依据时显示可验证的结构性缺项，不虚构“完成配方/包装确认”等动作。
② 完成情况（新增区块）
   8 个 section 的 count 汇总成一行徽章带
   （证据 n · SPU n · SKU n · 内容 n · 交付 n · 反馈 n），点击滚动到对应 section
③–⑩ 现有 8 个 section 顺序保留
   （市场证据→Brief→SPU→SKU→内容→交付→反馈→时间线）
   每 section 用 Section 组件；列表超过 3 条收起为 L2
   SPU 创建的 inline-business-form（10 个裸 input 平铺）改 Modal + form-grid，与 ProductForm 同构
```

### 5.3 内容与创意（studio）

画布左 + 编辑右骨架保留，重排编辑面板与流程指引：

```
① 商品 ribbon + kit toolbar：保留；版本/未保存/审核进度是 L1
② TemplatePanel：位置保留（对应"选择模板→资料完整度"）
   facts 已在 details 内 ✓；批量操作结果改用 PartialState（n/m 完成）
③ 编辑面板按任务流重排为三组（Section 组件）：
   A 文案：主/副/正文 + 确认按钮（L1）；AI 候选面板收进 details（L2）
   B 视觉：素材选择（L1）+ AI 视觉面板收进 details（L2）；
     版式/颜色/缩放移入「高级排版」details（L2）——低频调整项，
     现平铺在 claims 之后，打断"文案→视觉→审核"主线
   C 审核与追溯：引用卖点 pills（L1，审核必需）+ 证据原文（L2）
     + 待完善 issues + 底部固定审核按钮（editor-bottom 保留）
④ workflow-note（页面底部静态文字）
   → 移到 kit-toolbar 下方，改状态驱动 stepper：每步按实际数据显示
     完成/进行中/未开始，点击滚动到对应区块；静态装饰文字删除
⑤ history 视图 → studio 内 tab「内容制作 | 版本与导出」
```

### 5.4 其余页面小修

- 工作总览：补"下一步动作"提示行（2.1-① 缺失项）
- 产品资料库：SKU 详情底部补「资料完整 → 进入内容制作」出口按钮；删 `.product-switcher`（P15）
- 渠道交付/经营反馈：空态补直达按钮
- 交互修正：`navigate()` 加 `window.scrollTo(0,0)`；离开确认文案改「当前修改未保存，离开将丢弃这些修改。是否离开？」（confirm 机制保留，防丢数据是业务需要）

### 5.5 验证

对照 Phase 0 每页"第一屏必须看到"清单逐页检查；typecheck + build。

---

## 6. Phase 4：组件抽取收尾 + app.tsx 拆分 + IA 细节

- app.tsx 拆分：
  - `studio-view.tsx`（L122-163 JSX + reviewPage/exportAll/editPage）
  - `library-view.tsx`（L165-170）
  - history 已并入 studio 的「内容制作 | 版本与导出」tab，不新建独立 `history-view.tsx`
  - 如 tab 内容需要拆分，按真实职责命名为 `version-export-panel.tsx`（或同等职责名称）
  - app.tsx 只留 shell / 导航 / 全局 state / 错误 toast（约 80 行）
- View 类型删除 `'history'`（并入 studio tab）
- Phase 3 重排后新出现的重复形态（预计：stepper、徽章带）此时再抽取——先重排后抽取，避免抽两次
- Modal/PageHeader/EmptyState/Section 剩余调用点全部替换完毕
- 文件结构：仅新建 `components/`（states/Modal/PageHeader/Section）+ `studio-view.tsx`、`library-view.tsx`，以及确有必要时的 `version-export-panel.tsx`；不做更深目录树（12 个源文件规模不值得）

---

## 7. Phase 5：响应式 + Accessibility + 视觉回归 + 全链路验收

### 7.1 断点合并（以实际布局为依据，不机械合并）

1. 每视图在 1440/1280/1100/1024/900/768/700/600/375 逐档截图
2. 记录每档真实崩点（哪个区块先溢出/换行/挤压）
3. 只合并"行为完全相同"的媒体查询块；行为不同的保留并注明原因
4. 预期 4–5 档，以实测为准——1150 与 1100 行为确实不同就不合并

### 7.2 Accessibility 清单

```
□ Tab 可达所有操作（重点：page-strip 横向缩略图、template-status-grid）
□ icon-only 按钮全部有 aria-label（nav ✓、canvas 翻页 ✓、Modal 统一后复查）
□ 状态不只靠颜色：
  - .reviewed-dot/.draft-dot（纯色点）→ 已审核改 ✓ 图标或形状差异
  - .event-dot、.status-dot 同理检查
  - signal/stage/badge 均带文字 ✓
□ 表单 label 关联：包裹式 ✓；market 各 form 的 name= input 逐个复查
□ field error 用 aria-describedby 关联到 input（copy issues、review form）
□ focus-visible 已有 ✓，确认 Modal focus trap 不破坏
□ details/summary 键盘可操作性（原生支持，验证不被 CSS 破坏）
```

### 7.3 视觉回归

- Baseline 时机：**Phase 1 结束时**（清理不应产生视觉变化，此时截图即重构前基线）
- 覆盖：工作总览 / 市场洞察 / 产品项目详情 / 产品资料库 / 内容与创意（含编辑面板展开态）/ 每个 modal
- 视口：1440 / 1024 / 768 三档
- 方式：手动截图存 `docs/visual-baseline/`；Phase 2、3、5 结束后各对比一轮
- 不引入 Playwright（新依赖 + 禁止项）；如认为值得装，单独提出再议
- 对比重点：字号 token 替换后的溢出，`.page-thumb`、`.canvas-footer`、`.segmented` 最可能崩

### 7.4 全链路验收

```
导入榜单 → AI 分析 → 人工审核机会 → 加入项目 → 推进阶段 → 建 SPU → 建 SKU
→ 建 kit → 批量文案 → 确认文案 → 生成视觉 → 采用 → 逐页审核（含 partial 场景）
→ 导出整套 → 任务面板轮询 → 下载 → 记录交付 → 录入反馈
```

每一步检查：状态反馈符合 4.3 语义表、错误只出现一次、L1/L2/L3 层级符合 2.2。

---

## 8. 执行顺序总览

| Phase | 内容 | 产出 | 验证门槛 |
|-------|------|------|----------|
| 0 | 页面任务说明 + 三级信息层级 | 本文档 | **你确认后才动代码** |
| 1 | 低风险清理 + CSS 冲突 + 作用域规范 | 死代码清除、规范入 CLAUDE.md | typecheck/test/build + 无视觉变化 + baseline 截图 |
| 2 | Tokens + 状态体系 + 通知语义 + Modal/Section/PageHeader/states | 设计系统落地 | 对照 token 规则逐页目检 |
| 3 | 市场洞察/产品项目/studio 重排 + 其余页面小修 | 三个核心页面新 IA | 对照 Phase 0"第一屏"清单 |
| 4 | app.tsx 拆分 + 剩余组件抽取 + history tab | 代码结构收敛 | typecheck + 全视图回归 |
| 5 | 断点实测合并 + a11y + 视觉回归对比 + 全链路验收 | 验收报告 | 7.4 全链路走通 |

约定：

- 每个 Phase 独立 commit，不混提
- Phase 1 的删除清单（尤其删文件项）执行前逐个再确认
- 每 Phase 结束跑 `npm run typecheck && npm test && npm run build`

### 2026-10-04 参考设计收口

#### 交互与语义约定

- 每页唯一问题：总览“先处理什么”；项目“下一步做什么”；机会“依据是否足够”；内容“本页能否审核”；研究“结果是什么、可信范围是什么”。摘要默认可见，支撑信息进入 Tab 或抽屉。
- 展示色统一：READY / CONFIRMED / SUPERSEDED / 已审核使用灰色；DRAFT / 待审核 / 缺资料使用提示色；Queued / Processing 使用进行中色；Failed / Timeout 使用错误色。仅映射外观，不合并领域状态或增加合法迁移。
- 面向用户使用：产品机会、市场依据、产品企划、渠道文案、内容工坊、来源追溯。内部枚举保留英文。
- 保留原 project / batch / sku / kit / page / from 参数；Tab 和抽屉使用 `ui.*` 参数。Back、Forward、刷新恢复位置，不触发业务动作。候选仍由原 artifact 和任务记录保存，采用复用原版本与幂等接口。
- 调试模型设置按功能保存模型 ID，留空继承原配置；只影响新调用。文案和生图有未结束任务时不能切换，避免改变原任务的配置快照。模型权限、额度和输出兼容性仍按既有运行时校验。
- 不伪造版本、任务 ETA、联系人或质量通过结论；方案修订号保留原审计语义。生成不覆盖当前稿，人工采用后重新审核。

- 一级入口固定为六项；交付和反馈保留项目入口及设置内的次级查阅，不删除已有记录或 API。
- 总览使用重点项目、真实指标、统一待办行与动态；项目使用筛选表格和七个业务阶段摘要；市场分研究、机会、监控，统计再按职责分 Tab；内容工坊使用页目录、预览编辑、质检审核三栏。
- 同页同一指标只保留一个统计出口：研究扫描量与样本指标分开；总览 Tab 不重复指标卡计数；内容只保留一处 ProgressClaim，页列表承载逐页状态。来源说明聚合，内部编号不作为业务标题。
- 机会详情、来源追溯、项目时间线和后台任务使用共享 Modal 的抽屉布局；正式确认、版本历史、业务状态迁移保持原规则。
- 视觉留档：`docs/visual-baseline/reference-{overview,market,projects,project-detail,studio,library}-{1440,768,375}.png`，机会列表与抽屉另存 `reference-opportunities-1440.png` / `reference-opportunity-drawer-1440.png`。
- 验证：typecheck、136 个 tests、build 通过；只读 FK 检查为 0，schema 为 V13。构建仍提示主 JS 包超过 500 KB；本轮没有调用模型或京东采集。
