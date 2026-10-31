# 区块设置项复用手册 v1.18

版本：v1.18（2026-10-31）
范围：已在两个区块上验证：40838（2026-10-23，20 pass / 0 fail；2026-10-26 产品对比前台加验后 21 pass / 0 fail）与 47748（2026-10-26，配置后 16 pass / 0 fail，配色与宽度加验后 20 pass / 0 fail，分类 oracle 两处加验后 22 pass / 0 fail；2026-10-27 样式检查加验后 31 pass / 5 fail，5 个 fail 均为用户已确认的样式偏差；2026-10-28 三层验证分段实跑后 48 pass / 7 fail，7 个 fail 全是已知问题，无新增），并对 40838 做了回归（20 pass / 0 fail）。v1.6 新增：分享给其他人用的包（任何智能体都能跑）与页面选择（新建自定义页面 / 系统页名称）。v1.7 新增：基线捕获与应用（画像 `baseline`，区块加到新页后自动按基线配好再跑）。v1.11 新增：按能力分段跑（`CAPABILITY_FILTER`）与多段报告合并（`scripts/merge-reports.mjs`），长套件被运行环境重启打断时可分段跑完再合并。v1.12 新增：自定义筛选夹具准备流程（探测前置、每种类型一个字段的交并集真值表、收尾只恢复区块）。
目的：为区块各个设置项形成可复用的流程和脚本，不是以测出某个区块的缺陷为目标。40838 是首个样本，47748 是第二个验证样本；顺带发现的问题只记录，不在本手册里深挖。

相关文档：模型见 `docs/BLOCK_TESTING_MODEL.md`；40838 盘点见 `docs/SETTINGS_INVENTORY_40838.md`，覆盖见 `docs/SETTINGS_COVERAGE_40838.md`；47748 盘点见 `docs/SETTINGS_INVENTORY_47748.md`，覆盖见 `docs/SETTINGS_COVERAGE_47748.md`；画像见 `profiles/40838.json` 与 `profiles/47748.json`。

## 1. 原则

1. 复用最小单位是设置项能力，不是区块。一个设置项跑通后，下一个区块声明有它，就复用同一套验证。
2. 新区块只是多个能力的组合。组合只对有依赖的能力做两两组合，不做全量笛卡尔积。
3. 每个场景后恢复默认配置，保证用例互相独立、可重复跑。
4. 只断关键结果。主观视觉项只截图取证，不做硬断言。
5. 断言来源要明确。Figma 或业务规则没确认的，先标 `candidate`，不直接写成硬断言。
6. 专属逻辑第二次被复用时，提升为能力模块。第一次先写专属检查。

## 2. 验证分三层

| 层 | 定义 | 适用 |
| --- | --- | --- |
| 设置层 | 设置项存在、选项与默认值正确；改值、保存、重开回读仍保持；最后恢复原状 | 所有设置项的底线 |
| 效果层 | 保存并预览后，前台可观察效果与设置一致 | 前台能看到变化的设置项 |
| 数据层 | 前台结果与内容管理数据按规则独立算出的预期集合一致，不只看页面变了 | 动态区块 |

状态口径：`pass` 通过；`fail` 失败；`na` 无此设置项（区块中根本没有对应设置项，不判 fail）；`skip` 前置条件不满足而跳过；`record` 只取证、不判通过也不判失败。

什么时候用 `record`：前台观察不到效果、效果依数据而定、或设置含义未确认。什么时候用 `na`：已确认区块没有该设置项。什么时候用 `skip`：探查失败、定位不唯一、没有可切换的值、缺少 oracle/styleSpec、预览不可交互或被测元素未渲染。两者都不冒充通过。

两项 CSS 检查按 2026-10-23 的拍板，只取证记录：读到 CSS 时为 `record`，读不到为 `skip`，不参与失败判定。

## 3. 接入新区块的固定流程

1. **收提测包**：区块 ID、名称、类别、目标站点、目标页、语言、Figma 链接（精确到画板节点为佳）、数据模式（静态 / 动态 / 混合）、动态区块的数据来源与范围。缺的先标待确认。
2. **盘点设置项**：按 `docs/templates/SETTINGS_INVENTORY_TEMPLATE.md` 逐个子区域记录。每个设置项记控件类型、当前值、选项、默认值。盘点时不改值。
3. **写画像**：按 `profiles/TEMPLATE.json` 写 `profiles/<BLOCK_ID>.json`，声明 `capabilities`。画像是运行器组合套件的唯一入口。
4. **映射能力**：逐项对照第 6 节能力库。能命中的直接用；命中不了的，先写专属检查，第二次复用再提升为能力。
5. **跑起来并沉淀**：跑 `npm run test:block`，看报告；失败先分是代码定位问题、还是设置本身问题；跑完恢复原状；把新增的能力、画像、覆盖表一起提交。

## 4. 编辑器机制（40838 已验证）

- 区块由多个可编辑子区域组成，每个子区域是 `.backstage-blocksEditor-wrap`，带 `data-blockseditor-type`。40838 的三个子区域分别是 `phoenix_blocks_filterStyle`、`phoenix_blocks_gallery`、`phoenix_blocks_button`。
- 每个子区域第一个 `a.backstage-widgettool-btns`（id 形如 `editorBtn-<settingId>-<uuid>`）是设置，第二个是编辑样式。settingId 与 uuid 每次都可能变，不可写死。
- 设置弹窗渲染在主页面 DOM：`.backstage-dialog.backstage-dialog-widgetsettinsframe`，底部 `.backstage-dialog-bottom` 有取消 / 保存。例外：47748 的「设置与选取数据」弹窗底部是关闭 / 保存，没有取消。关弹窗时先试取消，再试关闭。
- 同一个 `data-blockseditor-type` 可以出现多次。47748 有两个 `phoenix_blocks_gallery` 子区域（产品分类在前，产品列表在后），弹窗标题与功能都不同。只按 type 定位会撞到第一个，必须按 type + 弹窗标题 + 同类子区域序号区分（画像里用 `dialogTitle` 与 `wrapIndex` 传参）。
- 选中区块后右侧 `.siteblocks-setting-operateTools` 是容器级操作（ID、背景、配色、间距、上移下移、复制、删除），不是组件功能设置。
- 预览根节点不要用 LA 类名。40838 预览里有 `LA40838`，47748 预览里没有 LA 类。通用根节点是 `.siteblocks-setting-wrap[data-appid]`，编辑器与预览都适用。
- 添加区块时，添加面板不一定有 develop 页签。47748 添加时面板里只有待审核（review）页签，没有开发页签；代码要先判断页签存在再点，不存在就跳过，不硬等超时。
- 登录态会过期。10-23 存的 storageState 到 10-26 已失效，打开编辑器会被重定向到领动首页。失效时用 `scripts/explore-login.mjs`（.env 账号）重新登录，刷新 `src/fixtures/storageState-demo-xujiying.json`。
- 按钮区的链接编辑浮层是例外：它在画布 frame 内，是 `.editor-box`，不在主页面弹窗里；关闭靠点浮层里的保存，取消、关闭图标、Escape 均无效。
- 预览正文在 iframe 里，不能只查主文档。直接访问 preview 域名不等于编辑器预览会话。
- 编辑器有常驻连接，等待用条件轮询，不用 networkidle 硬等。

## 5. 运行器与公共工具

运行入口是 `src/run.mjs`，配置在 `src/config.mjs`，从 `.env` 读。关键参数：`BLOCK_ID` 必填；`PROFILE` 可覆盖画像路径，默认 `profiles/<BLOCK_ID>.json`；`TARGET_PAGE` 默认 `products`。

执行顺序（`src/run.mjs` 的 `main`）：

1. 打开编辑器，进目标页，按需添加区块。
2. 按画像 `capabilities` 的顺序，依次跑各能力的 `runSettingsLayer({ page, canvas, context, config })`。
3. 保存页面，打开预览。
4. 先跑 7 项通用前台检查（`src/checks.mjs`），再按同样顺序跑各能力的 `runFrontLayer({ frame, config })`。
5. 写 JSON 报告到 `reports/`，截图到 `screenshots/`，报告里会脱敏密码、代理与编辑器地址。

能力注册表在 `src/run.mjs` 的 `capabilityRegistry`，目前有 4 项。新增能力要同时做到两件事：在 `src/capabilities/<id>.mjs` 里导出 `runSettingsLayer` 与 `runFrontLayer`，并在注册表里登记。画像里声明了但注册表里没有的能力会被跳过，不会报错。

画像里的能力不是只有 id：`runCapabilityLayer` 会把整条画像条目作为 `capability` 传给模块，模块用它读自己的参数。47748 用到的参数：`dialogTitle`（弹窗标题，默认是模块写死的标题）、`wrapIndex`（同 type 子区域里的序号，默认 0）、`variant`（变体说明，只作记录）、`fixedSettings`（弹窗隐藏、设计稿给定的固定值，例如 47748 筛选的逻辑 / 触发 / 范围）。40838 的画像没有这些字段时，全部走默认值。

每层异常隔离：某个能力抛错，只记一条 `<capability>-settings-error` 或 `<capability>-front-error` 的 fail，不影响其他能力。

公共工具在 `src/capabilities/shared.mjs`：

- `widgetSession({ page, canvas, config, type, title, wrapIndex })`：打开、保存、取消设置弹窗。取消时先关标题匹配的弹窗；如果实际打开的是另一个标题的弹窗，也把它关掉——残留弹窗会遮住页面保存按钮，让整轮失败。关弹窗先试取消，再试关闭。
- `probeControls(session)`：快照弹窗内全部 `input / select / textarea`，含 label、上下文、值、checked、options。未命名 radio 组也要原样记录。
- `persistControl({ session, page, target, alternate, afterSwitch })`：持久化闭环的标准事务。改值、保存、重开回读、恢复原值、再保存页面；恢复失败也会记 fail。控件身份每次重开都要复核 `index + tag + type + name + label + value`，只靠序号不安全。事务开始时如果弹窗是关着的（上一个事务以取消收尾），先自动打开，不假设弹窗还开着。
- `radioPersist({ session, page, name, prefixes })`：按 label 前缀定位一组 radio 的两个选项，做闭环。组完全不存在返回 `na`；探查失败、定位不唯一、不可切换或当前选中不唯一时返回 `skip`，不硬做。
- `radioGroupPersist({ session, page, name, labels })`：任意个选项的 radio 组闭环（例如 47748 列表数据来源的 4 个选项）。组不存在返回 `na`；探查失败、选项不全、当前选中不唯一或有选项 disabled 时返回 `skip`。
- `poll(read, accepts)`：10 秒轮询读值。读值超时或断言读不到值时算“没匹配上”，不直接抛错——前台本来就没有筛选组的区块（47748），基线采集应记 record，而不是在最后一毫秒抛超时。
- `previewSelector(blockId)`：预览根节点，`.siteblocks-setting-wrap[data-appid]`，不要用 LA 类名。

## 5.1 Fresh-block live-scene flow (opt-in)

The separate fresh-block entry tests a newly inserted default instance and leaves it on the page. It does not read, capture, apply, or restore a site baseline. Existing baseline-based `npm run test:block` remains unchanged.

Page selection is mandatory. Configure one of:

```sh
node scripts/fresh-block.mjs --page-kind custom --page-name "<configured page name>"
node scripts/fresh-block.mjs --page-kind system --page-id "<editor page id>" --page-url "/<page path>"
```

Equivalent environment keys are `FRESH_PAGE_KIND`, `FRESH_PAGE_NAME` (custom), and `FRESH_PAGE_ID` plus `FRESH_PAGE_URL` (system). There is no default page; incomplete selection refuses to start. `src/fresh-settings-adapter.mjs` loads each profile capability's exported `freshSettings` contract. Adapted definitions provide `settings` with `apply` and `check` functions, `persistedControls` references for controls covered by their existing persistence assertions, and optional dependency metadata. The shared adapter applies non-interfering groups, saves once per group, reruns failed settings alone, and uses retain-tested-values semantics without a restore method. Capabilities that have not exposed definitions are listed as `not-adapted`, never as passes. Full editor inventories remain in both report snapshots; post-publish comparison uses only controls explicitly declared by adapted capabilities, while the report gives the count of inventoried controls not covered by those definitions. This prevents inactive picker UI state from being mistaken for a persistence assertion without filtering by field label. A batch that requires an unavailable baseline is refused before opening the page rather than silently checking a dependent value in a changed state.

The fresh-block workflow identifies instances solely by the configured block number (`data-appid`) on the explicitly selected page. Before deleting anything, it requires a unique `settingId` and editor ordinal for every matching instance, then deletes every instance of that block number one at a time and verifies after each action that exactly one target instance disappeared and counts of every other block number stayed unchanged. It adds one default instance, saves and reloads, and requires exactly one instance with the newly captured `settingId` before testing settings. It never uses a marker or sidecar instance registry.

First-run default control values are stored outside version control at `.local/fresh-defaults/<encoded-host>/<encoded-block-id>.json`; subsequent differences are informational report entries, not failures. Batch settings are saved by declared non-interfering groups. Failed settings are rerun alone; conflicting confirmed failures retain only the first by check order, while the report lists the suppressed setting/value/expected/actual/screenshot. All-pass runs leave the final batch values. The page is published after checks, and the JSON report includes editor/front links, block instance identity/position, current values, changed-default notes, per-check outcomes, and failure screenshot paths. Exactly one target-number block remains for the next run.

Capability definitions are opt-in and must preserve their existing assertion values and evidence fields. They can declare shared `settings-dialog`, `canvas-popover`, or `right-rail-flyout` lifecycles, which sequence open/read/apply/commit/cancel and reject unknown or incomplete surfaces. The popover commit is its verified save-and-close action; rail flyouts use their own save/cancel controls. A definition that cannot bind a setting to an available fixture/control at runtime returns a precise `notAdaptedReason`; its read-only observations remain in the report, but it is not counted as adapted. Check-only capabilities may run their existing profile-driven assertions after publication without adding a settings batch. Fresh current/default inventories also include the selected block's color and width rail controls. Unsupported capability definitions remain explicit report entries. The existing baseline runner remains on its existing settings-layer path.

For post-publish verification, adapted definitions also identify their persisted controls by dialog region, control index, and control type. The full current and reloaded inventories remain in the report; the equality assertion covers only declared controls, and the report counts controls outside adapted definitions as unverified. This separates stored settings from inactive picker UI state without filtering controls by CMS item name or label. The custom-filter fresh definition reuses the fixture-declared field choice and its existing persistence oracle; profile-declared fixed radio values and field inventory remain separately recorded.

特殊控件不走通用 `persistControl`：背景颜色是 Spectrum 取色器，先试 `jQuery(input).spectrum('set', ...)` 加 `trigger('change')`，失败再降级到取色面板点选。两种方式都失败且尚未保存时，记 `skip`，不记 fail。

背景颜色效果检查的两个实测结论（2026-10-28，40838）：(1) **设置项本身不生效**：保存的 rgb(1,2,3) 在画布和预览里哪都没出现，`.prodfield-form` 三种状态全是透明，样式表里也没有这个颜色——`cff-background-front/backend` 的 fail 是真问题，不是检查读错了元素（探针 `scripts/probes/probe-40838-filter-background.mjs`）。(2) **效果检查的恢复回读不可信**：上一轮两个背景检查的恢复在会话内回读都通过了，但新会话探针读到的持久化值仍是 rgb(1,2,3)；探针用同样路径恢复成 rgb(139,0,0) 后新会话读回才确认落库。恢复类验证必须用新会话读持久化值，会话内重开读绿不算数——`tx.remember` 的恢复回读目前就是会话内读，须按此口径复核。

## 6. 能力库 v1.5（已在两个区块上验证的 7 个）

### 6.1 custom-filter-fields（选择自定义筛选字段）

来源：40838 筛选区，`phoenix_blocks_filterStyle`，弹窗标题「设置自定义字段筛选」。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `cff-settings-fields` | 欲筛选字段（多选） | record：可选字段清单 |
| `cff-settings-state` | 逻辑 / 触发 / 范围当前值 | pass/fail：三组 radio 各有唯一选中值；全部 radio 组原样记在 evidence 里 |
| `cff-settings-persist` | 欲筛选字段 | 设置层闭环 |
| `cff-radio-persist` | 逻辑、触发、范围三组 radio | 设置层闭环；产品范围切换后只记录切换前后预览基线，不硬断言数据变化 |
| `cff-select-persist` | 筛选后跳转页 | 设置层闭环 |
| `cff-color-persist` | 背景颜色 | 设置层闭环，Spectrum API，`rgb(139,0,0)` 改 `rgb(1,2,3)` 再恢复 |
| `cff-field-front-group` | 欲筛选字段 | 效果层：启用字段、保存页面后，预览新增以该字段命名的筛选组，再恢复 |
| `cff-groups-baseline` | 筛选组基线 | record：组标题与值清单 |
| `cff-facet-narrow` | 选值后刻面收窄 | 效果层：其他组值集合为基线子集、已选标签出现该值 |
| `cff-clear-restore` | Clear Filters | 效果层：清除后各组值集合与基线相等 |

47748 验证结论：

- 字段多选本身复用成立。47748 的字段是 18 个，字段值子选项（value 形如 `826554_1`）不计入字段数；`cff-settings-fields` 只计 value 为纯数字字段 ID 的 checkbox。
- 逻辑 / 触发 / 范围在 47748 的弹窗里隐藏，但取设计稿固定值（交集 / 更改筛选项后自动筛选 / 当前分类产品），画像用 `fixedSettings` 声明，`cff-settings-state` 报固定值而不是“本区块无此设置”。跳转页 / 背景颜色不存在，`cff-select-persist`、`cff-color-persist` 定位不到时记为 na。**规则：子设置项不存在时记为无此设置项（na），不判 fail；存在但值不对时才判 fail。**
- 前台筛选组 DOM 有两种形态：40838 是 `.prodfield-single` / `.prodfield-left-fieldname`，47748 是 `.pf-field-group` / `.pf-field-title`（值都是 `label`）。选择器同时兼容两种。
- 47748 配置前预览里没有筛选组；后台配置（启用 2 个筛选字段）后渲染出 2 个组，`cff-field-front-group` 与 `cff-groups-baseline` 都能验证。**但 47748 的筛选在编辑器预览里不可交互**：整个筛选表单 `pointer-events:none`，点标签、强制点单选框都选不上（对照：40838 的筛选表单是 `auto`，可点选收窄）。前台层先判可交互性，不可交互时 `cff-facet-narrow` 与 `cff-clear-restore` 直接 skip、只验证组渲染，不因渲染原因判 fail。

已知局限（写进代码与覆盖表，不当作通过）：

- 并集与自动触发在预览刻面行为上与默认模式无可区分差异，只做设置层验证。
- 「默认展开 / 收起」「不开启 / 开启」两组 radio 归属标签未完全捕获，只记录当前值，不翻转。
- 产品范围切换的效果依数据而定，只记录不硬断言。
- 数据层精确集合断言（单字段、交集、并集）目前是 40838 的 oracle 探针脚本（`scripts/probes/verify-oracle-*.mjs`），还没固化进这个能力模块的前台层。固化时要处理夹具维护：内容管理保存时要点「重复确认」弹窗，保存后有同步延迟、不能立即回读。

### 6.2 product-list-display（产品列表设置）

来源：40838 产品列表区，`phoenix_blocks_gallery`，弹窗标题「设置产品列表」。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `pld-fields` | 展示字段（多选） | record：字段清单。40838 实测 54 个，含重复副本（27 个自定义字段出现两遍，属已知现象），系统属性 Brand、Product Code、Model、Brief 在内；47748 实测 27 个（4 系统 + 23 自定义） |
| `pld-data-source-persist` | 列表数据来源（4 选项 radio） | 设置层闭环（`radioGroupPersist`）；40838 没有这组，记为 na（无此设置项） |
| `pld-page-size-persist` | 每页产品数量 | 设置层闭环：20 改 10 再改回 20，上限 100 |
| `pld-pagination-persist` | 分页展示 是 / 否 | 设置层闭环 |
| `pld-compare-persist` | 产品对比 关 / 开 | 设置层闭环；47748 没有这项，记为 na（无此设置项） |
| `pld-compare-front` | 产品对比 | 效果层（40838，v1.3 新增）：对比开 + 勾 Brand → 保存页面 → 临时预览。勾 2 个可见 `input.compared-input`（每卡网格/列表两份，只取可见的），断底部栏 `.compareMenu` 带 `show`、计数 `Compare(2/6)`、栏里含两产品名；点 `.compareButton`（DIV）展开 `.compareMenu_large`（`display: block`、含两产品名，`<table>` 在预览里始终为空、只记 evidence 不断言）；点 `.opt-btn .save`（Inquire）跳到 `/phoenix/admin/prod/inquire`，断页里有 “Product Inquire”、两产品名与 Brand 列。最后恢复对比关闭 + Brand 未勾选并保存页面，恢复写在 finally 里。只在有产品对比设置的区块上跑，定位不到则 skip |
| `pld-data-source-category-front` | 列表数据来源选部分分类 | 效果层（47748，v1.4 新增）：数据来源切“选择部分产品分类”、仅勾 oracle 分类（测试分类）→ 保存页面 → 临时预览，列表直接为 oracle 的 7 个上架产品，无需点导航；导航里分类个数只记 evidence（两个设置相互独立，不断言）。最后恢复数据来源回“所有产品”并保存页面，恢复写在 finally 里。只在有数据来源组的区块上跑，画像里没有 oracle 夹具时 skip |
| `pld-display-field-persist` | 展示字段 | 设置层闭环：任选一项翻转 |
| `pld-front-note` | 产品列表前台可观察性 | record：只记录预览里是否检测到产品列表候选元素，不做效果断言 |

47748 验证结论：

- 弹窗标题与序号必须由画像传入：47748 用标题「设置与选取数据」、同类子区域序号 1；40838 用默认标题「设置产品列表」、序号 0。
- 数量输入的标签在两个区块上不同：40838 是「每页产品数量」，47748 是「显示产品总数量」。代码按两个标签找，匹配到的标签记在 evidence 里。**含义随分页变（2026-10-26 用户确认）**：分页=是时为每页产品数量，分页=否时为总数量；`pld-page-size-persist` 按当前分页状态注明含义。
- 47748 的分页默认是“否”，40838 默认是“是”。默认值按实测记录，不假设跨区块相同。2026-10-26 后台配置后 47748 的分页改为“是”、数量 20 此时为每页产品数量。

已知局限：40838 预览里本来没有产品列表渲染，列表类设置的前台效果不可观察，只做设置层验证。产品列表设置保存后，预览开始渲染 20 个产品（此前为 0），这是实测现象，不是本能力的断言。47748 配置前预览里产品列表也是空的；配置后（数据来源所有产品、分页“是”、展示字段勾 6 项）渲染出 20 个 `.prodlist-pro-name`，`pld-front-note` 已检测到，本版仍只验证设置持久化，未断言列表效果。

### 6.3 button-link（按钮链接）

来源：40838 按钮区，`phoenix_blocks_button`，画布内 `.editor-box` 浮层。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `btn-state` | 链接、文本、新窗口当前值 | record |
| `btn-text-persist` | 按钮文本 | 设置层闭环 |
| `btn-url-persist` | 链接网址 | 设置层闭环。40838 当前是 `mailto:service@mail.com`，预览 DOM 里 href 显示为 `javascript:void(0)` |
| `btn-target-persist` | 在新窗口打开 | 设置层闭环 |
| `btn-front-text` | 按钮文本 | 效果层：预览按钮文案与设置层读到的值精确一致 |

已知局限：浮层在画布 frame 内，不是主页面弹窗；关闭必须点保存。定位靠同时含「链接网址」与「按钮文本」的唯一 `.editor-box`，候选不是 1 个时直接 fail，不改写。

47748 验证结论：`button-link` 直接复用成立。47748 的按钮文本是 `New Machine`、链接是 `javascript:void(0)`，40838 是 `Please set up the required pop-up form here.` 与 `mailto:service@mail.com`；结构、标签、关闭方式都相同，4 项检查（3 pass + 1 record）全部通过。

### 6.4 product-category-select（产品分类选择）

来源：47748 产品分类区，`phoenix_blocks_gallery`，弹窗标题「设置产品分类」，同类子区域序号 0。40838 没有这个设置项，是 47748 上新提升的能力。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `pcs-state` | 选择方式与分类清单 | record：方式当前值、分类个数与已勾选数。47748 实测 44 个分类，默认方式是“选择所有产品分类”，全部勾选且 disabled |
| `pcs-mode-persist` | 分类选择方式 | 设置层闭环（`radioPersist`）：选择所有 / 选择部分 |
| `pcs-category-persist` | 单个分类勾选 | 设置层闭环：分类在“所有”模式下是 disabled 的，先切到“部分”再翻转单个分类，恢复时先恢复方式再恢复勾选；全程重开回读 |
| `pcs-category-front` | 分类选择前台效果 | 效果层（47748，v1.4 新增）：切“部分”、仅勾 oracle 分类（测试分类）→ 保存页面 → 临时预览，断导航容器 `.pf-cate-wrap` 内仅剩该分类一个链接；点导航后列表为 oracle 的 7 个上架产品；不点导航时列表仍是全量（只记 evidence，不判 fail）。最后恢复方式回“选择所有”并保存页面，恢复写在 finally 里。oracle 夹具在画像里，没有时 skip |
| `pcs-front-note` | 产品分类前台可观察性 | record：只记录预览里分类导航文本，不做效果断言 |

注意：分类 checkbox 的 label 提取会把整棵分类树的文本拼在一起（例如父级标签里带全部子分类名），不要拿 label 全文当分类名断言；翻转时以控件身份（index + tag + type + name + label + value）复核为准。

### 6.5 block-color-scheme（区块配色）

来源：47748 右侧图标栏配色浮层（`.siteblocks-setting-operateColor`），区块级设置，不在子区域弹窗里。Figma 只给一个配色 #1C4587，生效范围为按钮文字、滑块、分页文字、自定义字段选中、产品分类选中（滑块暂不验）。右侧栏操作统一走 `src/capabilities/rail.mjs`（选区块、等图标栏出现、开浮层、Spectrum 取色、宽度读写）。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `bcs-state` | 配色个数与当前值 | record：颜色输入个数与当前值。47748 实测 1 个，#1C4587 |
| `bcs-color-persist` | 配色保存闭环 | 设置层闭环：改替代色（红）→ 保存 → 重开回读 → 恢复原配色 → 保存 → 重开回读。改色走 Spectrum API（对可见浮层里那个确切 input 调用 `spectrum('set')`），颜色比对先用 `normalizeColor` 归一化（API 写回的是 `rgb()` 格式） |
| `bcs-front-effect` | 配色生效范围与写死颜色 | 效果层：改色后开临时预览取快照，比对 4 处跟随项（按钮背景、分页当前页背景、Clear Filters 文字、筛选选项 `accent-color`）与 5 处写死颜色（按钮文字白、筛选未选、分类未选、产品名、分页非当前页）；恢复后快照与基线一致。分类选中态在编辑器预览里无可观察实例、未找到样式规则时只记录 |

注意：设计稿的字面意思与实际实现有出入——按钮是**背景**上色（文字白色不变），分页是**当前页背景**上色，分筛选选中态用 `accent-color` 断。断言口径以实测为准，不要按字面意思硬断。恢复类断言必须用新会话读持久化值，会话内读回不能证明已落库（2026-10-26 教训：第三轮恢复在会话内读回 #1C4587，新会话读到的持久化值仍是红色）。

### 6.6 module-width（模块宽度）

来源：47748 右侧图标栏“模块展开”浮层（`.moduleWidth`），区块级设置。radio 1200px / 1440px / 1600px / 1920px / 全屏 / 自定义（≥1200px），47748 默认以“自定义 1440”的形式存。应用全局 checkbox 不碰。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `mw-state` | 当前宽度与生效宽度 | record：选中项、自定义值、生效宽度（自定义取数值，全屏记 `fullscreen`，其余取标签数字）。47748 实测自定义 1440，生效 1440px |
| `mw-width-persist` | 宽度保存闭环 | 设置层闭环：切 1200px → 保存 → 重开回读 → 恢复原宽度 → 保存 → 重开回读 |
| `mw-front-width` | 宽度效果 | 效果层：改宽后开临时预览，量宽度壳 computed `max-width`（壳在区块 wrap 内，`.hasDefaultWidth.container`；画布只有约 1525px 宽，bounding 宽量不出 1600/1920，所以只断 `max-width` 字符串精确比对，bounding 宽只作 evidence） |

### 6.7 block-style-spec（区块样式，v1.5 新增）

来源：区块的 Figma 设计稿。能力本身是通用的：期望值全部放在画像的 `styleSpec` 里，代码里一个像素值都不写死。每个区块设计稿不同，就各写各的画像；新区块用 `scripts/figma-style-extract.mjs`（给 fileKey + 节点，读 Figma、抽样式）生成草案，人工确认一次映射（设计稿节点 → DOM 选择器）与断言级别，再写进画像。设计稿改了就重新抽一次，对 diff 后更新画像。

| 检查 ID | 设置项 | 方式 |
| --- | --- | --- |
| `bss-button-text` | 按钮文字 | PC 比对：字号/字重/颜色直接比 computed 值；居中用量几何位置（文字在框里是否正中），行高与 text-align 不直接比（flex 实现时直接比会误判） |
| `bss-button-bg` | 按钮背景 | PC 比对：背景色、圆角 |
| `bss-nav-parent` | 分类导航父级 | PC 比对：字号/字重/行高（父级 = 顶层且带子菜单的链接） |
| `bss-nav-leaf` | 分类导航叶子 | PC 比对：字号/字重/行高（叶子 = 无子菜单的链接；检查先点开父级再读可见叶子链接。设计稿里带子级的二级链接行高 40 仅一例，证据太薄，只对叶子断言 44.8） |
| `bss-filter-title` | 筛选组标题 | PC 比对：字号/字重/行高/颜色；letterSpacing -0.15px 亚像素值只记录不判 |
| `bss-filter-option` | 筛选值 | PC 比对：字号/字重/行高 |
| `bss-product-name` | 产品名 | PC 比对：字号/字重/行高/颜色/居中 |
| `bss-product-name-clamp` | 产品名行数限制 | PC 比对：line-clamp 行数（设计稿文字说明“居中 最多2行隐藏”转成的断言） |
| `bss-details-link` | 产品卡 details 链接 | PC 存在性断言：设计稿每张卡下有 details，预览里一个都没有即 fail |
| `bss-pagination-current` | 分页当前页 | PC 比对：字号/颜色/背景色/格子宽高 |
| `bss-pagination-other` | 分页非当前页 | PC 比对：字号/颜色/格子宽高 |
| `bss-breakage-pc` | PC 端样式错乱 | 横向溢出、超框、重叠、截断、图片失真；有任一即 fail |
| `bss-breakage-pad` | Pad 端样式错乱 | 设计稿无 Pad 端画板时只查错乱，不比样式 |
| `bss-breakage-mobile` | 移动端样式错乱 | 设计稿无移动端画板时只查错乱，不比样式 |

实现要点：前台层跑（`runFrontLayer`），用运行器打开的同一个临时预览，通过 `previewPage.setViewportSize` 切三端（PC 1440 / Pad 768 / Mobile 375），跑完恢复 1440；有 fail 就截当前视口的图（`screenshots/style-<BLOCK_ID>-<viewport>.png`）供人工看。画像里没有 `styleSpec` 的区块全部 skip。**映射教训：Figma 图层名来自编辑器 DOM，前台类名可能不同（47748 按钮：图层 `backstage-component-btn`，前台 `blocks-button`），选择器一律以前台实测为准，不要直接照搬图层名。** 登录态过期时（`openEditor` 等“页面:”超时、editSite 跳回官网首页），先重跑 `scripts/explore-login.mjs` 刷新登录态再跑。

## 7. 通用检查（所有区块都跑）

`src/checks.mjs` 的 `runFrontChecks`，共 7 项：

| 检查 ID | 内容 | 口径 |
| --- | --- | --- |
| `block-present` | 预览 frame 中目标区块容器存在 | fail 则后续全部 skip |
| `img-alt` | 图片有 alt | 无 img 时 skip |
| `link-href` | 链接有 href | 无 a 时 skip |
| `cursor-pointer` | 可点击元素指针样式，抽样最多 20 个 | 无有效样本时 skip |
| `css-font-follow` | 区块 CSS 跟随全局字体 | 只 record，不判 fail |
| `css-word-break` | 区块 CSS 换行声明 | 只 record，不判 fail |
| `carousel-arrows` | 有 Slick 才验轮播箭头 | 无轮播时 skip |

## 8. 实跑结果

40838（2026-10-23，报告 `reports/report-40838-2026-10-23T07-11-37-421Z.json`）：28 项检查，20 pass、0 fail、1 skip（无轮播）、7 record。覆盖表见 `docs/SETTINGS_COVERAGE_40838.md`。

47748（2026-10-26，报告 `reports/report-47748-2026-10-26T03-38-04-324Z.json`）：33 项检查，16 pass、0 fail、9 skip、8 record。基线（v0.5 原样能力）是 4 pass、2 fail、8 skip、2 record；修完框架缺口后重跑到 0 fail。覆盖表见 `docs/SETTINGS_COVERAGE_47748.md`。

47748（2026-10-27，样式检查加验后，报告 `reports/report-47748-2026-10-27T01-28-07-440Z.json`）：56 项检查，31 pass、5 fail、10 skip、10 record；5 个 fail 全部是用户已确认的样式偏差（筛选值字号、导航叶子行高、details 链接缺失、分页格子与非当前页颜色），其余检查 0 fail。

47748 配置后重跑（2026-10-26，报告 `reports/report-47748-2026-10-26T04-22-57-061Z.json`）：33 项检查，16 pass、0 fail、9 skip、8 record。后台配置后筛选组与产品列表都渲染出来了；三处待确认全部定性（见第 11 节）。

47748 配色与宽度加验（2026-10-26，报告 `reports/report-47748-2026-10-26T06-34-32-008Z.json`）：39 项检查，**20 pass、0 fail、9 skip、10 record**。新增 `block-color-scheme` 与 `module-width` 两个能力（见第 6.5、6.6 节）；修了 4 处框架缺口（图标栏出现时机、浮层开关幂等、Spectrum 元素定位与颜色格式归一化、分页背景祖先链定位），中间三轮各剩 1 个 fail，第四轮 0 fail。覆盖表见 `docs/SETTINGS_COVERAGE_47748.md`。

40838 回归（2026-10-26，报告 `reports/report-40838-2026-10-26T03-43-15-451Z.json`）：20 pass、0 fail、2 skip、7 record。多出的 1 个 skip 是新增的 `pld-data-source-persist`，40838 没有数据来源组，正确降级。框架改动没有破坏第一个区块。

## 9. 模板怎么用

| 模板 | 用途 |
| --- | --- |
| `profiles/TEMPLATE.json` | 新画像的起点。只填 blockId、名称、类别、数据模式、目标页、capabilities。`capabilities` 里每项至少写 `id` 与 `settingName`；已验证的能力直接复用 id，未验证的先标 `candidate`。同一 type 有多个子区域时，在该能力条目上补 `dialogTitle` 与 `wrapIndex` |
| `docs/templates/SETTINGS_INVENTORY_TEMPLATE.md` | 盘点表。按子区域逐项填，不改值 |
| `docs/templates/SETTINGS_COVERAGE_TEMPLATE.md` | 覆盖表。每项写验证方式：设置层闭环、效果层、还是只记录，并写清依据 |
| `src/capabilities/TEMPLATE.mjs` | 新能力模块骨架。照着它实现 `runSettingsLayer` 与 `runFrontLayer`，复用 `shared.mjs` 的 `widgetSession`、`probeControls`、`persistControl`、`radioPersist` |

新能力命名用 kebab-case，例如 `custom-filter-fields`。检查 ID 用 `<能力缩写>-<动作>`，例如 `cff-radio-persist`、`pld-page-size-persist`、`btn-text-persist`。

## 10. v1.0 结论（47748 验证后）

v0.5 待验证清单的结论：

1. 三个能力跨区块复用：`button-link` 直接成立；`custom-filter-fields` 与 `product-list-display` 是变体命中，字段与展示字段闭环可复用，逻辑 / 触发 / 范围 / 跳转页 / 背景颜色 / 产品对比等子设置项按存在与否降级。决定性因素不是 `data-blockseditor-type`（两个 gallery 撞 type），而是弹窗标题 + 同类序号 + 控件 label。
2. 画像字段：够用，但要补两个可选参数——`dialogTitle` 与 `wrapIndex`。已补进模板用法（第 9 节），没有扩必填字段。
3. 通用检查在 47748 上成立：block-present、img-alt、link-href、cursor-pointer、btn-front-text 均 pass；CSS 两项 skip（未找到样式表）；轮播 skip（无 Slick）。
4. 新设置项归类：产品分类选择是全新能力，已按第 1 节规则提升为 `product-category-select`（先在 47748 上写专属逻辑并跑通）；数据来源选择是 `product-list-display` 的变体，已用 `radioGroupPersist` 补进模块。
5. oracle 数据层：47748 配置前预览里筛选组与产品列表都不渲染，精确集合断言在这个区块上没有前台可观察的基础，继续留在探针脚本里，不固化。
6. 40838 遗留的未命名 radio 组、展示字段重复副本、按钮预览 href 为 `javascript:void(0)`，仍只记录，不定性为缺陷。

v1.0 验收：47748 终版 16 pass / 0 fail，40838 回归 20 pass / 0 fail；手册每条已知局限都有结论；模板没有 47748 用不上的字段，也没有它缺的必填字段。

## 11. v1.1 结论（2026-10-26，用户三处确认后）

v1.0 的三处待确认已全部定性：

1. **列表区那个 20**：含义随分页变——分页=是时为每页产品数量，分页=否时为总数量。`pld-page-size-persist` 按当前分页状态注明含义。
2. **筛选逻辑 / 触发 / 范围**：在 47748 的弹窗里隐藏，取设计稿固定值（交集 / 更改筛选项后自动筛选 / 当前分类产品）。画像用 `fixedSettings` 声明，状态检查报固定值。
3. **47748 预览为空的原因**：是后台还没配置、没选数据，不是区块缺陷。已用 `scripts/probes/configure-47748.mjs` 后台配置（筛选启用测试单选按钮A与测试下拉列表；列表数据来源所有产品、分页改为“是”、数量 20、展示字段勾 6 项），配置后筛选组与产品列表都渲染出来了。以上是 47748 的当前既定状态，后续实跑以它为基线、改完恢复回它。

v1.1 新增的两条泛化：

- 前台筛选组选择器同时兼容两种 DOM 形态（40838 的 `.prodfield-single` / `.prodfield-left-fieldname` 与 47748 的 `.pf-field-group` / `.pf-field-title`）。
- 前台交互先判可交互性：47748 配置后筛选组渲染出来了，但整个筛选表单在编辑器预览里是 `pointer-events:none`（按钮 / 分类 / 列表 / 分页均为 `auto`；40838 的筛选表单是 `auto`），所以 `cff-facet-narrow` 与 `cff-clear-restore` 在该区块上 skip、只验证组渲染。筛选效果的精确断言要到发布后的真实页面上做。

v1.1 验收：47748 配置后重跑 16 pass / 0 fail（报告见第 8 节），三处待确认全部定性、无遗留。

## 12. v1.2 结论（2026-10-26，配色与模块宽度加验后）

1. **配色**：只有配色 1（#1C4587）已验证；生效范围按实测口径定——按钮背景、分页当前页背景、Clear Filters 文字、筛选选项 `accent-color` 跟随配色，5 处写死颜色不变；分类选中态在编辑器预览里无可观察实例、未找到样式规则，只记录；滑块暂不验。`bcs-color-persist` 与 `bcs-front-effect` 均 pass。
2. **模块宽度**：默认 1440px 以“自定义 1440”形式存；切 1200px 保存重开回读、恢复自定义 1440 均闭环；前台宽度壳 `max-width` 跟随设置值。`mw-width-persist` 与 `mw-front-width` 均 pass。
3. **能力库到 6 个**：新增两个区块级能力 `block-color-scheme` 与 `module-width`，共用 `rail.mjs`（右侧图标栏：选区块、等图标栏、开浮层、Spectrum 取色、宽度读写）。区块级设置与子区域弹窗设置走同一套“声明能力即自动组合”的路子，不用另起流程。
4. **三条通用教训**（已进覆盖表第 13–16 条）：右侧图标栏是异步出现的，点完区块要轮询等它出现；浮层图标是开关式，打开前先判是否已开；Spectrum 这类第三方控件，改值要对准确切的元素、读值要先归一化格式；**恢复类断言必须用新会话读持久化值**，会话内读回不能证明已落库。

v1.2 验收：47748 全套件 39 项检查，20 pass / 0 fail（报告见第 8 节）；配色与宽度恢复回既定状态（配色 #1C4587、宽度自定义 1440），经新会话读值确认。

## 13. v1.3 结论（2026-10-26，40838 产品对比前台效果加验）

1. **产品对比前台效果**：`pld-compare-front` 在 40838 上 pass。链路是勾选框 → 底部固定栏（`Compare(2/6)`、两产品名）→ 点 Compare 展开大面板 → 点 Inquire 进询盘表单页（两产品 + Brand 列 + 各自属性值）。询盘页的列不完全由勾选的展示字段决定（只勾 Brand 时仍出现测试下拉列表等自定义字段列），断言只做到产品名 + Brand 列存在，不硬断“仅含勾选字段”。
2. **对比表在预览里是空的**：大面板里的 `<table>` 在编辑器预览里始终 0 行（点开后 10 秒轮询），属性比对不在这张表里，要到询盘页看。只记 evidence、不判 fail；如果以后确认这张表应该有内容，再改成判 fail。
3. **两个检查代码教训**（第一轮 fail 的原因）：弹窗里有多个 radio 组时，恢复读值必须按组过滤（取全局第一个被勾选的 radio 会取到分页的“是”）；跳转后的页面要等 `document.body` 就绪有文字再读，不能落地就读。两处已修进 `product-list-display.mjs`，并记在 40838 覆盖表里。

v1.3 验收：40838 全套件 30 项检查，21 pass / 0 fail（报告 report-40838-2026-10-26T07-22-21-466Z）；跑后对比恢复为关闭、Brand 恢复为未勾选。

## 14. v1.4 结论（2026-10-26，47748 分类 oracle 与两处分类设置加验）

1. **产品分类设置与产品列表设置是两个**（用户纠正）：前者管分类导航里出现哪些分类，后者的数据来源选“选择部分产品分类”管列表的数据范围。各做一个效果层检查，不混在一起。
2. **Oracle 来源**：内容管理后台产品管理上方分类筛选（`a.title_show` 下拉框，不是 select）。测试分类共 11 条；前台只展示上架（CMS 上架列 `shelve`）的 7 个，下架（`offShelve`：3号、80"-30"、4号、2号）不展示。夹具写进画像两个能力的 `oracle` 字段，数据变了同步改画像。
3. **导航设置**（`pcs-category-front` pass）：只选测试分类后导航仅剩该分类；点导航后列表为 7 个上架产品；不点导航时列表仍是全量 20 个（只记 evidence，不判 fail——导航管导航，列表要等点了才过滤）。
4. **列表设置**（`pld-data-source-category-front` pass）：数据来源选部分分类、仅勾测试分类后，列表直接为 7 个上架产品，无需点导航；此时导航仍显示 42 个分类链接（只记 evidence，两个设置相互独立）。
5. **三条检查代码教训**：`categoriesOf` 传参——模块版要控件数组，探针版要结果对象，移植时要改；产品名本身就是 a 标签，不能用 `a.querySelector('.prodlist-pro-name')` 认产品链接，导航改按容器 `.pf-cate-wrap` 取；带临时预览的效果层检查恢复后要等画布 settle（等区块容器重新出现，最多 30 秒）再交棒，否则下一个能力可能打不开弹窗。

v1.4 验收：47748 全套件 42 项检查，22 pass / 0 fail（报告 report-47748-2026-10-26T08-48-36-672Z）；跑后分类方式恢复为“选择所有”、44 个全勾，列表数据来源恢复为“所有产品”。

## 15. v1.5 结论（2026-10-27，47748 样式检查加验）

1. **每个区块设计稿不同，期望值放画像、不放代码。** 新能力 `block-style-spec` 只认“选择器 + 属性名 + 期望值 + 断言方式”的通用结构；各区块的数值全在自己画像的 `styleSpec` 里。新区块用 `scripts/figma-style-extract.mjs` 从设计稿抽草案，人工确认一次映射与断言级别后写进画像。设计稿改了就重新抽、对 diff、更新画像。
2. **PC 比对以设计稿为准**（47748：Page 3 pc 端画板，节点 1281:2960）。通过的：按钮（18px Bold 白字、背景 #1C4587、圆角 3px、居中）、导航父级（Bold 16px 行高 45）、筛选组标题（14px Semibold 行高 21 #232323）、产品名（16px 行高 20 居中 + 2 行截断，文字说明“居中 最多2行隐藏”已验证）、分页当前页（白字 #1C4587 背景）。
3. **5 个 fail 全部是用户已确认的样式偏差**：筛选值字号 16px（设计 14px）；导航叶子行高 40（设计 44.8）；产品卡无 details 链接（默认与 hover 后均无）；分页当前页格子 30×30（设计 28×28）；分页非当前页颜色 #4d4f53（设计 #898989）+ 格子 30×30。
4. **断言分两种**：直接比 computed 值（字号、颜色），和量几何位置（文字在框里是否居中）。按钮与分页的行高/居中是 flex 实现的，直接比值会误判，改为量位置。
5. **Pad / 移动端设计稿无对应画板时只查错乱**（横向溢出、超框、重叠、截断、图片失真），三端本轮全干净；移动端长分类名换行 4-5 行属正常换行。有 fail 就截图供人工看。
6. **两条教训**：Figma 图层名来自编辑器 DOM，前台类名可能不同（按钮图层 `backstage-component-btn`、前台 `blocks-button`），选择器一律以前台实测为准；登录态会过期（`openEditor` 等“页面:”超时），先重跑 `scripts/explore-login.mjs` 刷新登录态再跑。

v1.5 验收：47748 全套件 56 项检查，31 pass / 5 fail / 10 skip / 10 record（报告 report-47748-2026-10-27T01-28-07-440Z.json）；5 个 fail 均为上述已确认的样式偏差，其余检查 0 fail。

## 16. v1.6 结论（2026-10-27，分享给其他人用的包 + 页面选择）

1. **形式定为“任何智能体都能拿起来跑的包”**：仓库 + `AGENTS.md` + `SKILL.md` + 脚本 + 模板；Codex、Claude Code、Muse 都认。核心路径不依赖某个智能体独有的功能；`README.md` 是给人看的安装与使用说明。首次设置流程见 `AGENTS.md` 第 1 节。
2. **配置全参数化**：区块、页面、账号、密码、代理、编辑器入口全是环境变量（`.env`）；登录态按账号分开存（`src/fixtures/storageState-<账号>.json`）；新同事照 `.env.example` 填。密码只放自己机器的 `.env`，不打印、不进报告、不提交。
3. **页面选择只有两个选项**（记进画像 `target.page` / `target.pageKind`，第一次问一次）：
   - 新建自定义页面：新建页面 → 网页编辑器 3.0 → 空白模板 → 选取 → 页面设置填名称和 URL → 确定；名字默认 `测试-<区块 ID>`，URL 默认 `/test-<区块 ID>.html`；页面和区块都留着，以后就是这个区块的固定测试页。
   - 系统页名称：从系统页面页签按名称选；本站系统页只有 Products、Product Detail、Product Category 3 个。区块不在上面就加上去，加上去也不移掉；系统页里没有就报错，系统页无法新建。
4. **建页探针教训**：选模板要点“空白 + 添加空白页”那张卡（`li.content-item` 里 `div.add-blank-page`），点左侧列表里的“空白”只是筛选分类，不选中模板；点选取后会弹出页面设置对话框，要填页面名称（`input[name=page.pageTitle]`）和 URL（`input[name=page.pageUrl]`，必须以 `/` 开头），点确定才真正建出来；对话框没关干净时顶栏点不了，关干净再点。2026-10-27 已建测试页 `测试-47748`（`/test-47748.html`）。
5. **报告页面**：`scripts/report-html.mjs` 从报告 JSON 生成 HTML，结论先行（新增 vs 已知问题，与上一次同区块报告按 fail ID 对比），含缺陷单草稿、检查筛选、截图。
6. **运行器改动**：`resolveTargetPage`（画像优先，环境变量覆盖）、`ensureTargetPage`（目标页不存在且是自定义页时自动建页）、`gotoTargetPage` 按 kind 分系统/自定义两个页签找页面（系统页在 `<dl>` 里，自定义页在 `<ul>` 里，两个页签的列表都在 DOM 里，只算可见的）。
7. **新页接入需要一步“按画像基线配置区块”。** 新加到页面的区块是默认配置，与画像的既定基线不一致时，依赖基线的检查会 skip 或误判（本轮 4 项样式检查 skip、`bcs-front-effect` 误判 fail）。首次设置里加一步：区块加上去后，按画像基线把配置一次性设好（47748 即筛选 3 字段——见第 17 节纠正、分页“是”/数量 20、展示 6 项、分类选择所有），以后回归直接跑。基线在画像里表达为 `baseline` 字段，捕获与应用见第 17 节。

## 17. v1.7 结论（2026-10-27，基线捕获与应用）

1. **画像新增 `baseline` 字段**：按 dialog 分步记录，每步 `{title, type, wrapIndex, want: [{label, type, value?, to}]}`，`want` 与 `scripts/probes/configure-47748.mjs` 的结构一致。checkbox/radio 的 `to` 是布尔值，文本/数字/select/textarea 的 `to` 是值字符串；`value` 只在同 dialog 里同 label+type 出现多次时才记录作身份区分（例如展示字段的重复副本）。
2. **捕获**：`node scripts/capture-baseline.mjs <区块 ID>`，只读 dialog、不改站上任何设置。枚举区块的全部子区域（按 type + DOM 顺序的 wrapIndex），逐个打开设置弹窗、快照全部控件（含隐藏的——筛选 dialog 77 个控件只有 19 个可见，列表 dialog 101 个只有 7 个可见，只记可见的会丢掉展示字段），写进画像 `baseline`。v1 范围只覆盖 widget dialog：按钮区画布浮层与右侧配色/宽度栏记跳过、不进基线。
3. **应用**：运行器在 add-block 之后、能力层之前加 `apply-baseline` 阶段。区块刚加上去（`added=true`）且画像有 baseline 时自动应用：只改与目标不同的项、逐 dialog 保存、重开回读验证；单步失败记错继续跑其他步，但整体未验证通过时 fail-fast，直接停、不浪费一轮跑错的状态。`APPLY_BASELINE=1` 可强制重配一次（已在页上的区块也按基线重配）。画像无 baseline 时什么都不做。应用结果记进报告 `report.baseline`。
4. **47748 基线纠正（重要）**：捕获第一次全量实读 products，发现筛选实际开了 **3 个字段**（测试单选按钮A、测试下拉列表、**Series-xiala**），之前文档写的 2 字段是错的——2026-10-26 的配置脚本只负责打开 2 个 oracle 字段，从没检查过其他字段是否开着。用户已定留着，基线就是 3 个字段。47748 基线现为：分类“选择所有产品分类”；筛选 3 字段；列表数据来源所有产品、分页“是”、数量 20、展示 6 项。
5. **已知缺口**：列表 dialog 的数量输入没有可机读的 label，没进基线（新区块默认值也是 20，47748 不受影响）；修 label 启发式会动 `shared.mjs` 的控件快照、影响全部检查，v1 没动。

v1.7 验收：47748 在新测试页 `测试-47748` 上强制应用基线（`APPLY_BASELINE=1`）后全套件 56 项，**31 pass / 5 fail / 10 skip / 10 record**（报告 report-47748-2026-10-27T03-50-10-885Z.json），与 products 完全一致；基线 4 步全部验证通过（分类 1/1、筛选 61/61、列表 83/83，按钮区按设计跳过）；5 个 fail 全是已确认的样式偏差。至此 `测试-47748` 已是 47748 的合格测试页（与 products 同构）。products 回归 31 pass / 5 fail / 10 skip / 10 record（报告 report-47748-2026-10-27T03-56-35-315Z.json），与 v1.5 一致，运行器改动无回归；该轮基线未应用（区块已在页上，`report.baseline.reason` 为 `block already on page`）。

v1.6 验收：47748 在新测试页 `测试-47748` 上的全套件实跑（报告 report-47748-2026-10-27T02-37-51-070Z.json）：56 项，29 pass / 3 fail / 14 skip / 10 record。导航到自定义页、加区块（online 搜索找到）、全套件跑通、报告出齐，页面选择流程本身已验证。3 个 fail 里 2 个是已确认的样式偏差（导航叶子行高、details 缺失）；另 1 个是 `bcs-front-effect` 在新页默认配置下量不到分页/筛选元素（分页默认关闭、筛选字段未启用）而误判 fail，已修为“量不到的范围只记录不判 fail”（见覆盖表 v1.6 节）。另有发现：新页上的区块是默认配置，与 products 页的既定基线（筛选 2 字段、分页“是”、展示 6 项）不一致，导致 4 项样式检查 skip；新页接入需要一步“按画像基线配置区块”（待做，见第 7 条）。

## 18. v1.8 结论（2026-10-27，报告版式与状态口径）

1. 每项检查的报告 JSON 增加纯文字 `description`、`expected`、`actual`、`evidenceText`；结构化 `evidence` 仍保留排错。HTML 用文字字段展示检查卡片、表格和缺陷单草稿，不把结构化对象序列化成代码串。
2. HTML 在“全部检查”前列出失败、跳过、无此设置项卡片及相应截图；表格提供名称/描述、结果、预期、实际、文字证据与截图入口。旧版 JSON 缺少新字段时回退到名称和详情。
3. `na` 表示该区块根本没有对应设置项；`skip` 只表示探查或其他前置条件不足。失败、跳过和无此设置项检查在设置页或预览页即时截屏，截图失败记入 `artifactErrors` 并继续执行。
4. 打开预览后尝试从预览页二维码面板读取分享链接；读取失败记 `null`，不影响运行。成功时报告展示有效期 7 天和到期日期；不读剪贴板。

v1.8 验收：47748 在 products 页实跑新版报告（报告 `reports/report-47748-2026-10-27T07-04-24-396Z.json`，报告页面同名 `.html`）：全套件 56 项，**31 pass / 5 fail / 5 skip / 5 na / 10 record**。5 个 fail 均为用户已确认的样式偏差；结论“共 5 个失败，全部是上次就有的已知问题，没有新增”。转为 `na` 的是筛选逻辑/触发/范围组、筛选后跳转页、筛选背景颜色、产品对比持久化和产品对比前台项；CSS 未读取、无 Slick 轮播、筛选预览不可交互仍为 `skip`。报告顶部有可点预览分享链接（有效期 7 天，约至 2026-11-03）。文字已逐项核对：56 项都有具体预期（例如筛选值“字号应为 14px、字重应为 400、行高应为 21px”）、实际与文字证据，无通用模板套话、无代码味字段。注：本轮之前一次实跑（报告 `report-47748-2026-10-27T06-21-30-417Z.json`，30 pass / 6 fail）多出 1 个 `pcs-category-front` fail，点导航后列表前后 20 个完全一致、筛选未生效，重跑即通过，属偶发抖动，非新版代码问题（该检查逻辑本轮未动）。

## 19. v1.9 结论（2026-10-27，站点列表入口、登录健壮性与浏览器可配）

1. **登录后自动发现备选入口**：`scripts/explore-login.mjs` 按账号保存 storageState，随后打开控制台 hash 路由页。控制台没有可用的 `<a href>` 导航，旧 `LINKS` 探测已移除；改为在 `goto` 之前注册 `page.waitForResponse`（URL 含 `/menu/navigation4`，超时 60 秒），截获 SPA 自带鉴权头的请求响应。不得另用 `page.evaluate` 内的 fetch 代替（会返回 401）。运行时验证 `data.headerNavigation.webSite.webSiteList` 是数组，列出全部站名、comId 与各语种 name/url/siteSettingId/lanCode/editSiteUrl。
2. **SITE_DOMAIN 是测试站的语种地址**，例如 `http://en-site40083596.ldyjz.com`，不是领动平台域名。先精确匹配语种 url（去掉末尾 `/`）；未命中时按 host 唯一匹配站点，再选英语 `lanCode=0`。备选入口格式为 `https://www.leadong.com/phoenix/admin/user/editSite?s=<siteSettingId>&c=<comId>&d=&l=<lanCode>`；`EDIT_SITE_URL` 不再必填，仅站点列表选择器失效、完全找不到卡片时回退使用。唯一命中才写 `.env` 的 `EDIT_SITE_URL` 一行，没有该行则追加，其他行（含密码）原样保留。空 `SITE_DOMAIN` 只打印清单与填写模板，不写文件；账号没有该站时以“账号下没有 SITE_DOMAIN 对应的站点，请换有该站访问权限的账号”报错退出；多重匹配或缺少英语语种也报错停止，不能拿其他站跑。
3. **浏览器可配**：登录脚本与 `launchSession` 共用选项解析，支持 `BROWSER=firefox|chromium`，默认 Chrome（chromium，`channel: "chrome"`，要求安装系统 Chrome）；代理受限的机器改设 `BROWSER=firefox`（miumiu 的机器没有系统 Chrome，本机验证用 Firefox 跑，Chrome 默认路径需在用户 Mac 上验证）。`HEADLESS=true|false` 可覆盖默认：CI 为 true；非 CI 下 Firefox 为 true、Chromium 为 false。`SLOW_MO` 是非负整数毫秒，默认 0。Firefox 不传 channel。代理、ignoreHTTPSErrors 与会话参数沿用原逻辑。登录脚本不调用要求 BLOCK_ID 的 `loadConfig`。
4. **站点列表入口**：`openEditor` 始终先打开 `https://www.leadong.com/website.html`，最多等 30 秒出现 `.mySiteBox`。登录页重定向提示重跑登录脚本。逐张检查所有已挂载卡片（包括视口外）的公共 HTTP(S) 地址，按 `SITE_DOMAIN` 的 host+端口唯一匹配；可选 `SITE_NAME` 仅在域名无匹配时精确回退。匹配卡片滚入视口后选语言并点编辑网站，仍拒绝复用旧编辑器；列表结构缺失时才使用备选 `EDIT_SITE_URL`。进入后尽力核对站点身份，不匹配时报错，无法识别则 warning。语言优先取 `EDIT_SITE_URL` 的 l 参数，再取站点 host 语言前缀，最后英语；缺少语言项时 warning 后继续。
5. **只接收本次编辑器**：点击卡片 `.userEditSite` 前记录所有页面、监听主 frame 导航；点击后最多等 60 秒，只认 live pagebuilder 页面，优先新页面、其次当前页、再其次本次发生导航的其他页。点击前已在 pagebuilder 的旧页一律排除，推广页也不算。超时报当前地址并提示检查站名、语言与站点权限。仅站点列表完全没有 `.mySiteBox` 时才回退备选 `EDIT_SITE_URL`；未配备选则提示结构变化、重新探查选择器。返回 `{ page }`，运行器更新 `session.page`，包括 `capture-baseline` 在内的全部脚本调用点也接收返回页，后续目标页与预览操作继续使用该页。
6. **登录健壮性**：优先复用账号对应或 `STORAGE_STATE` 指定的 storageState；打开控制台未跳登录页即打印 `LOGIN: reused-storage-state`，否则打印 `LOGIN: form` 并表单登录。`--force-login` 强制表单登录。输入框先按 placeholder 找，再按 #loginName/#password 找，保留 frame 回退；账号密码逐字输入（delay 50ms），只点 `#loginSubmit`，等待成功 URL 最多 30 秒。首次加一次重试；页面出现密码错误提示立即停止，错误信息脱敏账号密码。登录后最多用 5 秒 best-effort 关闭含 video 的 dialog/modal，再 hover `.wrap-login-container/.wrap-login-dropdown`，有“返回领动云平台”链接则点击。storageState 写完设为 0600。navigation4 未匹配站点时回退 `www.leadong.com/website.html` 按 host 检查，只报告 `MATCHED_SITE`，不写 `EDIT_SITE_URL`。
7. **范围**：第一轮清理的临时控制台/导航探针和全量响应继续保持删除。第二轮未改检查断言、画像、基线或套件测试行为，只改编辑器入口与调用页传递、登录及启动选项；登录脚本只登录和读取站点清单，不改站上设置。按用户要求不提交。

v1.9 第一轮离线验收：已用删除前的完整响应验证 67 个站、176 个语种都能生成编辑器入口；40083596 英语精确匹配（含末尾 `/`）与 host 回退均生成原有入口（`s=miKfUASmzrZj&c=cWUAKfNCbSMO&d=&l=0`）。无权限、多重匹配、缺少英语语种、错误响应路径均会报错；临时 `.env` 验证通过 LF/CRLF、只改目标行、缺行追加、重复配置拒绝与原值无须重写。两浏览器和默认 Firefox 的会话选项验证通过，脚本语法检查通过。

v1.9 第一轮流程模拟验收：默认 Firefox、显式 Firefox 与 Chromium 均走完原登录步骤、保存 storageState、先注册响应监听再导航控制台、打印全部站点并只写目标配置行。空 SITE_DOMAIN 只打印填写模板；无权限、HTTP 401 与导航失败均不写文件，并关闭浏览器。此处为隔离模拟，不代表真实联网登录已通过。

v1.9 第一轮联网验收（受沙箱网络限制，未完成）：

- `node scripts/explore-login.mjs` 退出码 1，在打开 `https://www.leadong.com/login.html` 时原始报错 `page.goto: NS_ERROR_SOCKET_CREATE_FAILED`；未到站点列表响应解析、storageState 保存或自动写回步骤。已有 `.env` 的 EDIT_SITE_URL 仍为上述 40083596 英语入口；整份 `.env` 的 SHA-256 与运行前一致，密码行未动。
- 网络诊断原始输出：`Direct TCP: EPERM / connect / 1.1.1.1:443`；`DNS lookup: EAI_AGAIN / getaddrinfo / www.leadong.com`。说明当前沙箱连直接建连和域名解析都受阻，不能将本轮浏览器网络错误归为入口发现逻辑错误。
- `BLOCK_ID=47748 npm run test:block` 已尝试，退出码 1，在 `open-editor` 阶段同样报 `page.goto: NS_ERROR_SOCKET_CREATE_FAILED`，检查项尚未执行。实际输出 `[block] failed：pass=0 fail=0 skip=0 na=0 record=0`；这不是全套件通过，也不是区块出现 0 个问题。排错报告 `reports/report-47748-2026-10-27T08-47-12-733Z.json`，HTML 同名。未修改站上设置。
- 待可联网环境重验：登录应列全量站点、保存账号登录态并确认/写入原有 40083596 英语入口；47748 应对照 v1.8 的 **31 pass / 5 fail / 5 skip / 5 na / 10 record**，5 个 fail 均为已确认样式偏差。本轮不能声称已确认回归一致。


v1.9 第二轮验收（2026-10-27）：

- **站点列表实站入口未完成**：先备份 `.env`，仅清空 EDIT_SITE_URL，确认配置读取为空、SITE_DOMAIN 指向 40083596，再启动 Firefox 调用 `openEditor`。打开固定地址即报 `page.goto: NS_ERROR_SOCKET_CREATE_FAILED`，尚未到站点卡片或“页面:”校验；不能声称实站入口已通过。原始错误与恢复结果见 `reports/validation-round2-entry.json`。finally 已恢复 EDIT_SITE_URL 为 `https://www.leadong.com/phoenix/admin/user/editSite?s=miKfUASmzrZj&c=cWUAKfNCbSMO&d=&l=0`，并确认整份 `.env` 与验证前逐字一致，密码行未变，临时备份已移除。
- **网络排查**：直接 TCP 到 1.1.1.1:443 原始输出 `PermissionError: [Errno 1] Operation not permitted`；www.leadong.com 与 website.leadong.com 的 DNS 原始输出 `gaierror: [Errno -3] Temporary failure in name resolution`。当前沙箱的网络权限与解析受阻；此轮网络失败不能归为站点入口代码错误。真实 Firefox 即便拦截请求提供离线 HTML，也在初始 goto 报同一错误，故下列离线验证采用隔离模拟而非真实页面联调。
- **47748 全套件已尝试，未执行检查项**：`BLOCK_ID=47748 npm run test:block` 退出码 1，停在 `open-editor`，原始错误同为 `page.goto: NS_ERROR_SOCKET_CREATE_FAILED`；实际输出 `[block] failed：pass=0 fail=0 skip=0 na=0 record=0`。排错报告 `reports/report-47748-2026-10-27T08-53-25-089Z.json`，HTML 同名。未到任何设置修改步骤，不能据此确认无新增问题；可联网环境仍需对照 v1.8 的 **31 pass / 5 fail / 5 skip / 5 na / 10 record**（5 个 fail 均为已确认样式偏差）。
- **隔离模拟 25 项通过**：覆盖固定入口直达、卡片匹配忽略协议与末尾斜杠、语言已选不重复点/未选才点/缺项警告、精确站名回退、多重匹配与权限失败不得用旧入口、新页/当前页/已导航页面、推广页与关闭页过滤、旧编辑器排除（包括再次导航的旧页）、60 秒超时信息与监听器清理、仅无卡片时回退、公共 origin 提取。登录覆盖 placeholder、frame 内 ID 回退、Enter 后按钮回退、失败重试 2 次及耗尽、视频弹窗关闭/Escape、头像云平台链接、可选操作失败不阻断；另以 stub 启动登录脚本 main，确认共享 Firefox 选项、storageState 权限 0600、navigation4 先监听后导航及空 SITE_DOMAIN 不写配置。证据见 `reports/validation-round2-offline.json`，模拟不能代替实站验收。
- **配置解析通过**：6 组浏览器/CI/显式覆盖默认值、6 个非法配置拒绝、14 个语言优先级案例通过。Chromium launch 选项断言为 `{ headless: false, slowMo: 0, channel: "chrome" }`，Firefox 不传 channel，未真实启动 Chromium。结果见 `reports/validation-round2-options.json`。所有 122 个相关模块语法检查通过，`git diff --check` 通过；全部 openEditor 调用点已接收返回页，无遗留调用方。

v1.9 实站验收（2026-10-27，miumiu 本机可联网环境补验；上面两轮沙箱联网失败作废，以本节为准）：

- **登录脚本实跑通过**：`node scripts/explore-login.mjs` 登进去了，navigation4 截获成功，列出全部站点，匹配到 `【权限】产品全文搜索、图片搜索 / 英语 / http://en-site40083596.ldyjz.com`，`.env` 的 EDIT_SITE_URL 确认还是原值（`s=miKfUASmzrZj&c=cWUAKfNCbSMO&d=&l=0`），整份 `.env` 哈希与验证前一致，密码行未动；登录态文件已刷新，权限 0600。
- **站点列表入口实跑通过**：先备份 `.env` 仅清空 EDIT_SITE_URL（确认配置读取为空、SITE_DOMAIN 指向 40083596），`openEditor` 走固定地址 + 按域名匹配卡片 + 选语言 + 点编辑网站，成功到达 pagebuilder（`https://website.leadong.com/phoenix/pagebuilder/layout`），顶栏“页面:”可见，全程没用 EDIT_SITE_URL；验证后 `.env` 已恢复，哈希与验证前逐字一致，临时备份与探针脚本已删。
- **47748 全套件回归通过**：`BROWSER=firefox BLOCK_ID=47748 npm run test:block`，56 项 **31 pass / 5 fail / 5 skip / 5 na / 10 record**，与 v1.8 完全一致；5 个 fail 全是已确认的样式偏差（`bss-nav-leaf`、`bss-filter-option`、`bss-details-link`、`bss-pagination-current`、`bss-pagination-other`）。报告 `reports/report-47748-2026-10-27T09-02-40-238Z.json`，报告页面同名 `.html`，顶部预览分享链接正常（有效期至 2026-11-03）。
- **默认浏览器改为 Chrome（2026-10-27，用户定）**：`BROWSER` 默认值从 firefox 改为 chromium，chromium 启动固定 `channel: "chrome"`，Firefox 改为备选项（显式 `BROWSER=firefox` 才用）；`loadBrowserConfig` 默认解析为 `{ browser: "chromium", headless: false, slowMo: 0 }`，chromium launch 选项含 `channel: "chrome"`，firefox 不传 channel。注意：本机没有安装系统 Chrome，`channel=chrome` 启动报 `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`，属环境限制；Chrome 默认路径在本机未验证，需在用户 Mac 上验证。本机 `.env` 固定 `BROWSER=firefox`，本地运行不受默认值改动影响。

## 20. 设置项测试与断言明细（v1.10，2026-10-27）

新增[设置项测试与断言明细](SETTINGS_TEST_DETAIL.md)，按按钮、产品分类、自定义筛选字段、产品列表、配色、模块宽度、样式、通用前台检查的顺序，讲清每个设置在哪、哪些区块有、怎么测、测到什么算通过，以及对应的检查 ID。想查某个设置，就先在这份说明里找，再到文末按编号看两个区块最近一次的 pass、fail、na、skip、record；想按测试轮次看结论，仍看各区块覆盖表。

怎么判断以实际检查的做法为准；文字说明和实际检查不一致时，以实际检查为准。样式要求和用于比较的分类产品名单，参照相应区块的测试说明。明细也会写清哪些只记录、哪些暂时测不了、哪些没有安排检查，以及每项到底查到哪一步。只通过了其中一步，不能说其他还没做的效果检查也通过了。

## 21. 三层验证实跑与分段跑（v1.11，2026-10-28）

1. **三层验证已实跑验证**：35 个新检查（回显之外补后台与预览两层）全部跑过，见 `docs/SETTINGS_TEST_DETAIL.md` 文末对照表。47748 合并报告 `reports/report-47748-merged-2026-10-27T19-24-26-038Z.json`，报告页面同名 `.html`：全套件 91 项，**48 pass / 7 fail / 13 skip / 13 na / 10 record**。7 个 fail 全是已知问题，无新增：5 个是用户已确认的样式偏差（`bss-nav-leaf`、`bss-filter-option`、`bss-details-link`、`bss-pagination-current`、`bss-pagination-other`），2 个是全屏最大宽度（`mw-width-front`、`mw-width-backend`，见第 5 条）。
2. **4 处修法全部验证通过**（首跑 2026-10-27 的 91 项是 39 pass / 11 fail / 18 skip / 13 na / 10 record；本轮 48 pass / 7 fail / 13 skip / 13 na / 10 record）：`btn-url-persist` 由 skip 恢复为 pass（链接页签拿不到可靠标记时按 `mailto:` 回落判定类型）；按钮前后端 4 项（`btn-url-front`、`btn-url-backend`、`btn-target-front`、`btn-target-backend`）由 skip 变 pass；分类前后端 4 项（`pcs-mode-front`、`pcs-mode-backend`、`pcs-categories-front`、`pcs-categories-backend`）由 fail 变 pass（期望名单改按“全部”模式实际渲染的干净分类名建参照集；后台导航限定在 `.pf-cate-wrap` 内、排除编辑器“设置/编辑样式”按钮）。展示字段重复副本仍记 skip（未猜生效副本，补了各候选的勾选、可见性与位置证据）。
3. **运行环境重启打断整跑，改分段跑**：96 分钟的整跑连续三次被运行时重启杀掉（分别跑到 8 分 43 秒、18 分 03 秒、1 小时 18 分，无报告），每次都在分类检查翻转中途被杀，站上都留下分类选择方式被翻到“选择部分产品分类”的残留（第三次还带残缺的分类勾选）。每次都是先用只读探针核查基线（探针脚本用完即删）、按画像基线恢复并重读确认，再重跑。教训：长套件不要赌一次跑完；被打断后先核查基线再重跑，不要直接重跑（翻转残留会污染下一轮）。新增 `CAPABILITY_FILTER`（`src/config.mjs` 解析，`src/run.mjs` 按能力 ID 过滤，无匹配时报错；报告记 `capabilityFilter`，启动日志打印过滤列表）：`BROWSER=firefox BLOCK_ID=47748 CAPABILITY_FILTER=button-link,product-category-select,custom-filter-fields npm run test:block`。通用前台检查每段照常跑。分段报告用 `scripts/merge-reports.mjs <报告1> <报告2> [输出]` 合并：检查按 ID 去重（后一段覆盖前一段）、summary 重算、能力取并集、取最晚的完成时间与最新有效预览链接、记 `mergedFrom`；输入缺失、非法 JSON 或 blockId 不一致时报错退出。本轮分两段：上半段 3 个能力 45 项（25 pass / 0 fail / 5 skip / 9 na / 6 record，约 79 分钟），下半段 4 个能力 53 项（27 pass / 7 fail / 11 skip / 4 na / 4 record，约 21 分钟），合并后 91 项。分段是包的正式功能（单测某个能力也用得上），不是临时绕路。
4. **基线核查探针的两个教训**：第一次跑探针没传 `BLOCK_ID`，`.env` 默认是 40838，探针跑到了 40838 上、报出一堆假差异——探针必须显式传 `BLOCK_ID`。按钮“新窗口打开”读值时不要拿 input 的 `value`（checkbox 的 value 恒为 `on`），要用 `probeControls` 读 `checked`。
5. **探查结论（2026-10-28 凌晨，探针 `scripts/probes/probe-47748-fullscreen-42-44.mjs`，结果 `hidden/probe-47748-fullscreen-42-44.json`）**：(a) **全屏宽度是真上限，不是量法问题**：全屏时外层 wrap 的 max-width 是 none（不限），但宽度壳 `.hasDefaultWidth` 的计算 max-width 就是 1440px，渲染宽度 1440px；把预览视口拉到 2560px 宽，壳还是 1440px。对照组 1920 预设同一元素计算 max-width 为 1920px、2560 视口下渲染 1920px。也就是说“全屏”实际被平台卡在 1440px，没做到全屏；检查量的元素没错。算不算缺陷、预期要不要改成 1440px，**需用户定**。(b) **42/44 已查清**：导航 DOM 里一共就 42 个分类链接（34 个可见 + 8 个收起的二级链接），展开前后完全一致；Container Liner Bag 与 Cosmetic Packaging Bag 在导航 DOM 里根本不存在（不是收起的子级——Chemical Bag 的 li 标着 `hasNoUlChild`，没有子列表）。导航的 42 个名字就是完整集合，检查用它当参照集是对的；内容管理里有 44 个分类、导航只渲染 42 个，是产品侧的呈现差异，不影响检查结论。另：`cff-fields-backend`/`cff-fields-front` 只断言了测试单选按钮A与测试下拉列表两个字段组，基线第 3 个字段 Series-xiala 的组未进该检查的预期（检查写于基线纠正为 3 字段之前），属检查覆盖缺口，不影响本轮结论，待补。仍待探查：数据来源完整产品名单夹具仍缺（6 项记 skip）；展示字段哪个可见副本生效仍待实测勾选保存回读（2 项记 skip）。
6. **范围**：本轮未改任何检查断言口径；只加了分段过滤与合并脚本（`src/config.mjs`、`src/run.mjs`、`scripts/merge-reports.mjs`），`node --check` 与 `git diff --check` 通过。40838 本轮未重跑，其新检查在明细对照表里仍写待实跑验证。
7. **登录态过期与登录脚本抖动（2026-10-28 凌晨）**：探针首次跑时 `openEditor` 落到领动首页、报登录态失效；`scripts/explore-login.mjs` 连续 3 次报“登录后仍停留在登录页”后，第 4 次不改代码直接重跑即通过（登录态已刷新，权限 0600；站点 67 个，EDIT_SITE_URL 确认未变）。同时间段单测诊断（填账号密码后按 Enter、等 3 秒）一次就登进去了，且登录接口本身返回 success、无验证码。结论：账号密码没问题，是登录过程偶发抖动（Enter 提交后重定向慢，脚本只等 800ms 就判定仍在登录页、再点提交，形成二次提交竞态）。脚本本身未改；若以后频繁出现，再把 Enter 后的等待改成轮询 URL 变化（最多等 15 秒）后再决定是否点提交。

## 22. 自定义筛选夹具准备流程（v1.12，2026-10-28）

目的：不管一个站有没有自定义字段，都能跑筛选测试。流程自给自足：缺字段就建，缺产品就建，再跑交并集 oracle。40838 的手工夹具（3 件产品、两字段真值表）是本流程的原型，新站照同一套规则自动生成。

1. **前置判定（跑之前定，不开弹窗）**：区块支不支持自定义筛选、支持哪几种类型，在测试前确定：问用户，或者看需求文档、设计稿。记进画像（首次设置输入之一），运行器以画像为准。打开筛选设置弹窗看支不支持不是判定方法——弹窗是验证用的，不是定标准的。画像说支持、弹窗里却没有对应的设置组时，检查记 fail（画像与实际不符，需修正画像），不记 na。
2. **判定分支**：区块本身不支持筛选，那项记“无此设置项”，流程到此为止，不建任何东西；区块支持、但站上缺字段或缺产品，进第 3 步；什么都不缺，直接进第 4 步。
3. **建夹具（只建缺的）**：每种支持的类型选一个字段（支持单选、多选、下拉就选 3 个字段）；缺哪个类型就去 CMS 建哪个，名字加 `AUTOTEST-` 前缀、状态开启（新增表单：字段名 + 开启/关闭 + 7 种类型，枚举型选后出“选择项”区，每行一个文本框、最多 999 个，见探查 `hidden/probe-cms-custom-fields-79106751.json` 与 `hidden/probe-cms-field-options-79106751.json`）；再建夹具产品，按真值表设值（产品编辑页设值，保存有确认弹窗、保存后有同步延迟、不能立即回读，见 §17）；最后在区块里勾上这 N 个字段，否则前台没有筛选组。建完回读验证（字段在表里、产品值读回一致），报告里记清建了什么。注意：内容管理后台改完字段后，编辑器后台刷新一下就能看到新字段（不用发布）；建完夹具后要先刷新编辑器，再开筛选设置弹窗勾字段。
4. **真值表（N 个字段 → N+1 件产品）**：1 件取各字段的第一值；其余 N 件每件只把其中一个字段换成第二值。单字段第一值集 = 除翻转件外的全部产品；全部交集 = 只有全第一值那件；全部并集 = 全部产品；两两交集同样可区分。示例（3 类型 4 件产品）：P1=(单选a1, 多选b1, 下拉c1)、P2=(a1, b2, c1)、P3=(a2, b1, c1)、P4=(a1, b1, c2)。多选字段在主真值表里每件产品只挂一个值（与单选/下拉同一套表）；“一件产品挂多个值”的情况另做一项检查（该产品应同时出现在两个值的集合里）。
5. **跑 oracle**：单字段、两两交集、全部交集、全部并集，四种结果集精确比对。验的位置：在能点筛选的前台——编辑器预览能点就在预览验，点不了走已发布真前台。注意：建字段、建产品、设值是内容管理后台操作，立即生效，不用发布；需要发布的是编辑器里的区块设置（勾上筛选字段），发布后线上才有筛选组。发布步骤待定，见第 7 条。
6. **收尾**：只恢复区块设置（已有规则）；自定义字段与夹具产品不恢复、不删除，常驻。清理靠手动删除（字段列表每行有删除），流程不自动删。
7. **待定**：oracle 走已发布真前台时，发布由谁做、什么时候做。发布只涉及编辑器里的区块设置（勾上筛选字段后推上线，跑完恢复后再发布一次把线上还原）；建字段、建产品、设值是内容管理后台操作，立即生效，不用发布。多选“一件产品多个值”的那项检查尚未写进能力模块。

## 23. 自定义筛选夹具准备代码接线（v1.13，2026-10-28）

本节实现 §22 的准备流程；本轮只完成代码与静态验证，尚未进行浏览器实跑，不代表新增 CMS 路径已验证。

- `src/cms.mjs`：同一浏览器 context 经编辑器 SSO 后打开产品管理；列出/新建字段、核对既有字段类型与完整选项，精确查找/新建产品，按字段名发现控件，设值并经保存确认及延迟回读核对。字段类型码来自探查，无数字类型；仅创建 `AUTOTEST-` 新实体，既有字段有冲突直接报错。新增产品保守地只填唯一可定位的必填产品名，若出现上架控件则设为上架，其余保持默认。
- `src/fixture.mjs`：读取 `profile.fixture` 的前置结论和规格，写入前校验 N 字段/N+1 产品真值表；按需创建和设值，已有值一致时不重写。画像里每个字段的 `options` 是夹具需要的两个值（真值表第一值/第二值），不是字段的完整选项清单——复用既有字段时只要求这两个值都在 CMS 选项里，CMS 有更多选项不算冲突、不改字段（2026-10-28 实跑：测试单选按钮A 画像 2 个选项、CMS 10 个选项，按子集核对通过）。CMS 页在 finally 关闭；调用 `src/editor.mjs` 的 `reloadEditor` 刷新编辑器并核对/切回目标页，再勾上夹具字段、保存弹窗与页面。刷新前先保存，避免刚添加的区块丢失。保存页面改 DOM 点击：残留的隐藏弹窗遮罩（`.backstage-dialog-overlay.hide`）会挡住保存按钮的鼠标点击（实测 30 秒超时），按钮本身可见可用。
- `src/run.mjs`：`apply-baseline` 后、`capability-settings` 前增加 `fixture-prep`。只有画像含 `fixture` 时自动运行；设置 `CAPABILITY_FILTER` 时还须包含 `custom-filter-fields`，否则报告记录跳过原因。准备失败记 fail 并继续其他能力，依赖夹具的 oracle skip。外层 finally 在截图前恢复全部字段原勾选状态；部分准备失败也尽力恢复，恢复失败独立记 fail 和错误，不覆盖原运行失败。恢复后使用携带内存登录态的新浏览器 context 重开编辑器，回读持久化勾选清单。
- `src/capabilities/custom-filter-fields.mjs`：导出纯函数 `buildFixtureTruthTable(fixture)`，从画像产品值计算单字段、两两交集、全部交集和全部并集精确集合，允许翻转产品的排列顺序不同。每个 oracle 独立走 `effectCheck` 的设置/保存/手动搜索/预览断言/finally 恢复事务。有 fixture 时旧 logic/trigger/scope/jump 四项明确 skip（已被 N 字段 oracle 取代）；无 fixture 时保留原路径及两字段回退。预览不可交互时 skip，不强制点击。
- `profiles/40838.json` 新增三字段、四产品 fixture（单选、下拉复用，多选与第 4 件产品按缺失新建）；前置依据为 2026-10-28 用户确认，目标仍由既有站点配置决定。并集预期保持正确的 4 件产品，已知缺陷说明附在检查 detail。`profiles/TEMPLATE.json` 提供两字段占位示例，采用时替换占位符，不支持筛选时移除 fixture 段。

运行示例（在有权限且完成首次配置的测试环境执行）：

```bash
BLOCK_ID=40838 CAPABILITY_FILTER=custom-filter-fields npm run test:block
```

不设过滤时，画像有 fixture 段也会自动准备。前置类型以画像为准，不从弹窗猜支持情况；缺失设置组按画像与实际不符记 fail。

报告新增 `report.fixture`：`applied`、`created.fields/products`、`reused.fields/products`、`restored` 与 `restoreErrors`，失败/过滤时补 `reason`。准备过程检查为 `fixture-prep-fields`、`fixture-prep-products`、`fixture-prep-enable-fields`；阶段异常为 `fixture-prep`，收尾异常为 `fixture-restore`。数据效果检查为 `cff-oracle-single-<i>`、`cff-oracle-intersect-<i>-<j>`、`cff-oracle-intersect-all`、`cff-oracle-union-all`；均有中文名称、纯文字描述/预期/实际/证据。`cff-oracle-multivalue` 仅定义为 skip，尚未实现“一件产品挂两个值”。

首次实跑必须核查的点：

1. **CMS 新增产品表单结构**：产品名的语义标签、其他必填项、上架控件及保存入口未经新增表单探查；不唯一或缺失即报错，不猜字段 ID。产品搜索优先定位语义搜索框和“查询/搜索”；搜索不可用时只能扫描第一页，已存在且不在第一页的产品可能误判不存在，须先核实搜索路径。既有夹具名不带 `AUTOTEST-`，查不到时会停止该准备阶段，避免误建。

实跑修过的两处 CMS 定位问题（2026-10-28）：(1) `hasText` 不能用锚定正则——链接文字的 textContent 带前导换行/制表符，`/^管理自定义字段$/` 匹配不到（实测 0 个），改纯文字子串后为 1 个；`clickAction` 内已转纯文字，搜索按钮同步去锚定。(2) 侧栏入口点击会丢——Playwright 鼠标点击有时不触发 SPA 跳转（实测约半数停在产品列表页），改 DOM 点击；字段表经 XHR 后到，`waitForStable` 会把空表当稳定（实测 1.8 秒读到 0 个字段），`listCustomFields` 改走 `settleCmsNavigation` 等数据落定；点击仍丢时按“字段名称”是否出现判断、最多重试 3 次。修后 `listCustomFields` 连续 4 次实测均为 23 个字段。
2. **产品编辑页按字段名定位控件**：从精确字段标题寻找最小且唯一的 radio/select/checkbox 容器，没有写死旧 `option_826554`；实际容器层级、标题文本和组选项标签均须首次核对。
3. **多选字段设值形态**：当前按同组 checkbox 只勾一个目标、取消其他值实现，须核查实际页面确实采用该控件形态。字段选择项输入框与隐藏 JSON（`field.fieldOptionJson`）的联动、保存“重复确认”弹窗结构与时序也需实跑确认。已确认（2026-10-28 探针）：隐藏 JSON 在填表时始终为空，填+失焦、真实按键、手动派发 input/change/keyup 事件都写不进去——它是在提交时才序列化的；所以新建字段保存前只核对可见选项文本框的值，保存后再重开字段回读选项作最终验证，**不要**在保存前核对隐藏 JSON。**产品保存的“重复确认”弹窗已定因（2026-10-28 探针 v6/v7）**：点保存后先 GET `/prod/doUpdate/verify`（回 `{}`），再 POST `/prod/similarityJudge`（发 prodName/seoTitle/seoDesc/prodId；回 `{"code":200,"data":null,"message":"Title、Description"}`），然后弹出平台自定义层 `#popupLayer_sysConfirmPop` > `#popWin`，正文“Title、Description和已有产品相同不利于搜索引擎优化，确认提交？”，确定按钮 `#confirmYes`；点它才发真正的保存 POST `/prod/new/doUpdate`（请求体含 `option_911698=1`，回 200），值随即落库。**弹窗出现很慢**：v7 实测保存后 8.1 秒才出现（verify + similarityJudge 往返耗时），旧 `saveCms` 只轮询 5 秒，每次都错过、保存从未发出——这是四轮实跑里夹具设值不落库的根因（不是 checkbox 形态、不是 DOM 点击、不是服务端不存）。已修：`saveCms` 先按稳定 id `#popupLayer_sysConfirmPop #confirmYes` 点确认（通用文字匹配作回退），轮询窗口 5 秒 → 30 秒，点中且弹窗关闭后即返回。v7 全流程验证：测试产品A 的 AUTOTEST-多选 = 多选4-10 已落库，重读 checked=true。注意：凡是不改 Title/Description 的产品编辑保存都会弹这个窗；新建产品是否弹、弹的时机，视 similarityJudge 返回而定，`saveCms` 两种情况都覆盖（没弹窗则等满 30 秒后返回）。**第二个根因——保存点击时序抖动（2026-10-28 探针 v8–v11）**：修完 30 秒轮询后整轮仍失败（小何1 的设值回读超时），但直接调 runner 的 `setProductFieldValues` 给小何1 设值一次成功（doUpdate 含 `option_911698=1`，重读落库）；同法给小何2 设值却失败，全程没发 similarityJudge——保存点击根本没触发流程；而 v10/v11 用同样的 DOM 点击（v11 逐字复刻 runner 的 evaluate）又都触发了 verify → similarityJudge → 弹窗。定因是时序竞态：表单值是服务端渲染、很早就稳定，`waitProductFields` 的稳定判定不能证明页面 JS 已绑好保存处理函数，`openProduct` 只等 `domcontentloaded` 时点击可能落在处理函数绑定之前。已修：`openProduct` 改等 `load`（等页面脚本跑完）；`setProductFieldValues` 在保存前核对 evaluate 返回的页面内值，未勾选直接报错，不再烧掉 30 秒轮询 + 90 秒回读才暴露。v8/v9/v10/v11 探针脚本与结果见 `scripts/probes/probe-40838-multiselect-save8/9/10/11.mjs` 与 `hidden/` 下同名 JSON。**第三个根因——保存链概率性卡住（2026-10-28 探针 v12–v16）**：修完 `load` 等待后整轮仍失败，v12 只读重读站上真实状态：A 与小何1 三字段全对，小何2 的多选仍是空、**产品4 根本没建出来**——失败点仍是小何2 的设值，不是产品4，报告里产品在复用名单只表示“处理到了它”，不代表设值成功。v13（时间线轮询 + 全流量）：checkbox 页面内确实勾上、保存点击触发了 verify（GET 回 `{}`），但随后 30 秒内既无 POST `/prod/similarityJudge` 也无弹窗，流程在 verify 回包之后就断了。v14（每秒快照页面状态）：114 个点全程无任何弹窗层、无行内校验报错、敏感词数组全为 0、保存窗口内无页面报错——排除敏感词弹窗、排除已知的 SKU/批发校验、排除 JS 异常杀链。读页面源码（`prod_config.js`，451KB）确认链路：verify 回 `{}` → `SMT.func(config.saveProdContent)` → 敏感词数组非空则弹提示窗、否则 `prodSubmit()` → SKU/名称/批发等大段校验（任一失败都静默 return，只留行内报错）→ `getFieldSetting()`（把 `#fieldContent` 内已勾 checkbox 等收进 `#submitFieldJson`）→ `SMT.ajax(similarityJudge)` → message 为空直接保存、否则弹“重复确认”。v15（手动流程 + 包装器）再次成功，链路完整 logged；**v16（runner 同法 + addInitScript 包装器）这次成功了**：verify → similarityJudge → 弹窗 → 点确定 → doUpdate 200，小何2 的多选落库。结论：runner 的保存不是系统性坏，是**概率性卡住**（runner 实测 2/7 成功，手动 3/3；另有一组时序数据点：成功的保存点击多在页面加载后 2–4 秒，失败的在 5–6 秒，但机制未证实）。已修：`saveCms` 加**保存点击重试，仅产品保存**（`saveProduct` 传 `{ retryClicks: 2 }`）：点保存后 5 秒内无保存链请求、或 verify 回包后 3 秒内无 similarityJudge/doUpdate/弹窗，即重找保存按钮再点一次，最多 2 次；成功时 similarityJudge 总在 verify 后约 1 秒内到，3 秒是宽裕阈值；弹窗已打开时不重试；字段保存不走重试（接口不同、重复提交是真风险）。v12–v16 探针脚本与结果见 `scripts/probes/probe-40838-fixture-read.mjs`、`scripts/probes/probe-40838-multiselect-save13/14/15/16.mjs` 与 `hidden/` 下同名 JSON。
4. **40838 四产品真值表**：须在旧站配置（40083596）实核三字段类型、既有字段完整选项、产品上架和区块数据范围、4 件产品的全部值与前台精确集合；现有两个字段完整选项与画像不一致会明确报冲突，不自动修改或弱化判定。单选集/下拉集分别按产品实际声明值计算，不按产品数组位置假定谁翻了哪个字段。并集已知缺陷仍按 4 件断言。

本实现不发布、不删除字段或产品。CMS 变更立即生效，刷新编辑器用于读取新增字段；收尾只恢复区块字段勾选，CMS 字段和产品常驻。预览不可交互时记 skip，已发布真前台的执行及发布职责仍待确定。

## 24. HTTP 预览升级与发布控件（v1.14，2026-10-29）

- 本机网络代理拦截明文 HTTP（返回 500），导致编辑器“预览”打开 `http://website.leadong.com/phoenix/pagebuilder/preview` 后，内容 frame 落到 `*.preview.leadong.com` 时无法加载；对应服务主机可用 HTTPS。默认开启 `HTTPS_UPGRADE=1`，context 级 route 将 `website.leadong.com`、`www.leadong.com`、`*.preview.leadong.com`、`*.leadongcdn.com` 的 HTTP 请求用 HTTPS 获取，支持 iframe 与 popup/新标签页；`HTTPS_UPGRADE_HOSTS` 非空时用逗号分隔规则整体覆盖默认值，支持精确主机和 `*.suffix`。设为 `0`、`false`、`off` 可关闭。前台 `*.ldwebsite.com`、`*.ldyjz.com`、`*.ldmfyh.com` 没有 HTTPS，显式黑名单保证无论自定义规则如何设置，都不改写这些前台域。代理响应的匹配 `Location` HTTP 地址改为 HTTPS；检测到重定向回原 HTTP 地址时以 `HTTPS_UPGRADE_DOWNGRADE_LOOP` 打印 warning 并中止该请求（不让进程崩溃）。
- **实测结论（2026-10-29，box）**：HTTPS 升级**救不了预览**。带编辑器登录态请求 `https://website.leadong.com/phoenix/pagebuilder/preview` 时，服务端 302 回 `http://website.leadong.com/phoenix/pagebuilder/preview`（补 https Referer 也一样），即预览入口被服务端强制为 HTTP；在明文 HTTP 被拦截的机器上预览与前台都不可用，`*-front` 检查只能在能直连 HTTP 的机器（如用户本机）上跑。升级开关仍默认开启，仅对其它能走 HTTPS 的领动资源有效。
- 发布控件：顶栏“发布▾”按钮为 `.backstage-topToolbar-publish`。hover 后菜单 `.currentPagePublish` 表示当前页面发布，点击后不弹确认窗，约 10 秒出现 toast“恭喜您，页面发布成功！ 网址：…/products.html”；`.allPagePublish` 表示整站发布。直接点击顶栏“发布”会打开“发布前请先确认以下设置项”检查单弹窗，需勾选“我已确认”再点发布。
- 基于发布的前台验证模式只适用于能直接访问明文 HTTP 前台的机器。本机 box 的出网代理拦截前台 HTTP，且这些站点域没有 HTTPS，因此当前机器不能用发布前台做验证；此模式不能靠 HTTPS 升级绕过前台域黑名单。

## 25. 开跑前基线守卫（v1.15）

- 画像有 `baseline` 时，运行器在能力修改前只读打开各设置并取消，比较持久化值；任何 `AUTOTEST-` 字符串都按残留处理。发现差异即按画像恢复，另开新浏览器 context（复用 storageState）重读；恢复或新会话复验失败时终止本轮。结果写入 `report.baselineGuard`，控制台和 HTML 报告显示差异、恢复与复验状态。画像无基线则记录 `no baseline in profile`。
- 按钮区基线用 `{ type: "phoenix_blocks_button", wrapIndex, title: null, kind: "button-popover", want }`，覆盖按钮文本、链接网址、新窗口打开；捕获只读，应用后保存并回读。40838 的基线值按画像保存，不以运行时观察值覆盖。
- 能力事务恢复时优先使用画像中该控件的值；画像没有时才恢复开跑快照。快照为 `AUTOTEST-` 按钮文本时回退至默认按钮文案，证据记录恢复目标来源。残留演练可用 `node scripts/set-button-text.mjs <TEXT>`，仅在测试站执行。

### 探查新区块设置项（probe-settings）

探查仅在接入、换站或区块改版时运行，结果保存复用。已有目标页和区块、登录态可用时运行 `node scripts/probe-settings.mjs <区块ID>`；目标页按画像及 `TARGET_PAGE` / `TARGET_PAGE_KIND` 解析，必须已存在。草稿写入 `drafts/<siteHost>/<blockId>.json`，可用 `PROBE_OUT` 覆盖路径。区块不在目标页时列出当前页已有区块并停止，不添加区块。

画像 `requirements.capabilities` 声明设置项 ID（见 `src/capabilities/signatures.mjs`），可用 `params.dialogTitle` 和 `params.wrapIndex` 限制位置。探查按规则逐项输出已定位或缺失（问题）、位置与控件证据；数量依赖分页时记录当前分页值及生效含义。未被需求认领的控件、弹窗和右侧图标列为需求外设置，不推断能力。另对比画像能力模块的弹窗标题和区域序号。没有画像或需求时仍盘点，全部列为需求外设置并提示人工补充需求。盘点范围有限，隐藏或无法读取的设置需要人工核实。

`requirements.displayFieldTypes` 提供需要核对的类型。只在标题为“设置产品列表”的显示字段复选框里查找 `fixture.displayFields.fields` 中对应类型的唯一 `AUTOTEST-` 字段：可勾选为 ok；字段存在但禁用为问题；画像缺该类型夹具字段、复选框未找到字段或弹窗不可读为 unknown，并提示先准备夹具或人工确认。没有类型需求时提示“需求未提供，需人工补充”。这一步不读取 CMS，找不到字段不能证明区块不支持该类型。

探查只导航到已有页面，打开设置读取后取消或关闭，不创建页面或区块，不保存页面或发布。按钮浮层无取消按钮，读取后先按 Esc 或点空白关闭，仍不关时点浮层内“保存”（值未改动，不触发页面保存/发布）。配色与模块宽度只读盘点右侧面板，其他图标列入需求外设置；读取失败保留原因，不进入基线。

### 固定值需求（fixed-front）

`requirements.capabilities` 条目可写 `{ "id": "cff-logic", "mode": "fixed-front", "fixedValue": "交集" }`，表示编辑器里没有该设置（隐藏），取需求给定的固定值，在前台按此值验证。探查结果状态为 `fixed`，报告固定值，不算缺失；若编辑器里反而找到该设置，提示人工确认。前台检查通过 `fixedRequirementValues(profile)` 读取固定值。显示字段类型核对使用 `pld-display-fields` 需求的 `params.dialogTitle`/`wrapIndex` 定位弹窗（默认“设置产品列表”）。

### AUTOTEST 夹具与离线验证

字段类型按展示字段需求与筛选字段类型取并集，展示需求缺省才回退旧 `supportedTypes` 并警告。夹具实体按名称核验，身份记录放在 `fixtures-state/`，按站点 host 与区块隔离。精确集合只比较 AUTOTEST 产品；数量检查只要求数量足够，所有分类要求夹具产品存在。固定当前分类时先选择夹具分类并验证筛选；固定交集时并集记为 na，可切换并集的区块仍断言正确的并集。

CMS 分类入口、分类 ID、产品分类控件、字段 ID 及字段类型修改路径尚待测试站验证，定位不唯一时准备终止。离线 CI 设置 `FIXTURE_OFFLINE=1`，避免加载本地 `.env`。

### 可选批量保存模式

默认仍按原来的逐项事务运行。设置 `BATCH_SAVE=1` 时，运行器优先调用能力模块提供的批量入口；能力元数据按通用设置 key 声明依赖/干扰关系，规划器只把互不干扰的设置放入同一批。批次先应用全部值、保存一次，再逐项回读并执行该批次的检查；发生失败时先恢复该批，再将失败项单独重跑，并在报告里同时保留批次与单项结果。后续批次若依赖某设置的基线值，规划器会在该批前只恢复对应依赖。所有已改设置在结束时统一恢复并保存，运行器随后做一次站点基线检查。运行报告记录 `saveMode`、总耗时、批次/save/check/恢复耗时及最终基线检查结果。该路径目前由产品列表设置持久化检查接入，须在测试站完成 G12 的旧路径与批量模式计时对照后再评估是否扩大使用范围。

## 26. 通用 fresh-block、onboarding 与前台结果交接（v1.17）

- `scripts/fresh-block.mjs` 面向显式页面与区块：只替换目标区块号的实例，记录生命周期 ID；设置按 `freshSettings` 单元和批次计划运行，报告保留每个检查结果、当前值、失败证据、发布状态及已声明控件的发布后回读。设置单元契约见 `docs/setting-units.md`。
- 新区块使用 `node scripts/onboard-block.mjs --block <id> --page-kind system --page-id <id> --page-url <path>`（自定义页使用 `--page-kind custom --page-name <name>`）。自动发现只把唯一通用签名映射到草稿画像；未识别控件列 `unmapped`，不会猜测断言。被测区块不在模块库时报告 `environment-unavailable / TARGET_BLOCK_NOT_IN_MODULE_LIBRARY`，不是 assertion fail。`npm run list:modules -- --block <id> ...` 是只读模块库盘点，在线目录仅能按目标编号搜索，并非完整列表。
- 环境超时重试由 `ENV_TIMEOUT_RETRIES` 控制（0–2，默认 1），只用于导航、编辑器加载、模块库加载的 timeout；断言阶段、设置变更和发布不会自动重试。
- Mac/front-only JSON 可用 `npm run merge:fresh-front -- <box.json> <front.json> [out.json]` 合并。按检查 ID 对齐，保留两侧原始来源；只有盒端 `deferred` 行会选用前台 verdict，其余同 ID verdict 仍选盒端，前台独有行追加。输出 JSON 与 `-zh.md`。
- 前台验证可使用编辑器预览，或使用已确认保存并发布后的公开前台。公开页采用 HTTP 域名；只有编辑器明确确认保存与发布成功后才加 `?t=<timestamp>` 做缓存绕过。Mac 检查由用户设备流程负责，盒端不操作 Mac。
- 当前交接事项：Mac PR #9 曾报告发布后的 47748 未出现在公开 `/products.html`；另一次 G29 onboarding 在该站 review/develop/online 三种可搜索模块库均未找到 47498。G30 的只读盘点在编辑器加载超时前未打开模块库，因此没有更新 47498 或其他区块的目录结论。
- G31 起模块库查询遵守目标隐私：只按显式目标区块号搜索 review/develop/online 模式，等待懒加载并滚动结果；结果只记录目标 found/not-found 和截图路径，不枚举或保存其它区块号。新增 fresh-flow 发布报告仅在编辑器成功信号且带 `?t=` 的 HTTP 前台出现目标 block number 与新 settingId 时标记已确认发布。
