# 普通区块通用自动化设计

## 目标与当前范围

输入一个 `BLOCK_ID`，使用已有登录态进入指定 Leadong 编辑器和系统页，按需添加区块、保存、打开预览内容 frame，执行七项前台通用检查，输出 JSON 与编辑器/预览截图。入口为 `npm run test:block`（`node src/run.mjs`）。

本阶段复用 POC 已验证的选择器。自动登录/刷新登录态、响应式多宽度检查、文本修改、宽度拉伸、复制、RTL 和删除清理留待后续。当前不执行删除；本次新增区块保留在页面上供复核。

## 运行参数

参数通过仓库根目录 `.env` 和 `process.env` 提供。`process.env` 优先于 `.env`；两者都未提供时使用表中默认值。账号/密码没有代码默认凭据，需由运行环境注入。敏感值不得写入报告或日志。

| 参数 | 默认值 | 来源与说明 |
| --- | --- | --- |
| `BLOCK_ID` | 无（必填） | `.env` / `process.env`；区块应用 ID。为空或缺失时配置加载应立即抛出可读错误。 |
| `PROFILE` | `profiles/<BLOCK_ID>.json` | 可覆盖画像路径，相对路径以仓库根目录为基准；文件不存在时按原通用套件运行。 |
| `TARGET_PAGE` | `products` | `.env` / `process.env`；编辑器中的系统页标识或可识别名称，默认首个目标页。 |
| `SITE_DOMAIN` | `https://www.leadong.com` | `.env` / `process.env`；站点/控制台域名，用于构造登录和站点入口。 |
| `ACCOUNT` | 空字符串 | 优先 `ACCOUNT`，兼容参考实现的 `PLAYWRIGHT_ACCOUNT`、`PLAYWRIGHT_USERNAME`；用于选择账号登录态/站点配置。 |
| `PASSWORD` | 空字符串 | 优先 `PASSWORD`，兼容 `PLAYWRIGHT_PASSWORD`；保留给后续登录流程；当前使用已有登录态，不写入报告。 |
| `MODULE_TYPE` | `review` | `.env` / `process.env`；有效值 `develop`、`review`、`online`。参考测试默认 `review`，添加 helper 自身默认 `develop`，本方案显式采用测试入口的默认值。 |
| `BROWSER` | `firefox` | `.env` / `process.env`；与已跑通的探索脚本一致。 |
| `IGNORE_HTTPS_ERRORS` | `true` | `.env` / `process.env`；与探索脚本一致，解析为布尔值。 |
| `HTTPS_PROXY` | 空（不使用代理） | `.env` / `process.env`；兼容小写 `https_proxy`；设置时传给浏览器启动参数。 |
| `EDIT_SITE_URL` | 空 | `.env` / `process.env`；当前运行必填的编辑器入口，不固化任何探索 URL/token。兼容 `PLAYWRIGHT_EDIT_SITE_URL`。 |
| `STORAGE_STATE` | 空 | `.env` / `process.env`；可选的 Playwright 登录态文件路径。未指定时读取 `src/fixtures/storageState-<account>.json`；缺失时失败，不自动登录。 |
| `REPORT_DIR` | `reports` | `.env` / `process.env`；JSON 结果输出目录。 |
| `SCREENSHOT_DIR` | `screenshots` | `.env` / `process.env`；截图输出目录。 |

推荐 `.env` 键名与运行参数相同，例如 `BLOCK_ID=40838`、`TARGET_PAGE=products`、`ACCOUNT`、`PASSWORD`。不要提交包含真实凭据的 `.env`。

## 执行阶段

1. **浏览器与登录态**：`loadConfig()` 后启动 `playwright-core` 的 Firefox。解析代理 URL 的服务器和可选认证信息，应用 `ignoreHTTPSErrors`，视口为 1600×1000。显式登录态及报告/截图的相对路径均以仓库根目录为基准。仅支持 Firefox，登录态文件必须已存在。
2. **打开编辑器**：打开 `EDIT_SITE_URL`，等待 `networkidle`，关闭可见的“我知道了”提示。
3. **切换系统页**：点击“页面:”→“系统页面”→目标标签。`products` 映射为 `Products`，其他值作为精确标签使用。标签不唯一时失败。等待 `iframe.backstage-pc-proview` 的 body 挂载，返回 FrameLocator。
4. **按需添加**：已有 `.siteblocks-setting-wrap[data-appid="BLOCK_ID"]` 时返回 `added: false`。否则从第一个模块的添加按钮打开面板，按 `[MODULE_TYPE, develop, review, online]` 去重后的顺序尝试；默认为 review→develop→online。develop/review 分别点击 value=-1/-2 的模块列表；online 搜索 ID 并按 Enter。通过 `page.evaluate` 点击隐藏的 `.btn.add[appid]`。点击后等待画布容器出现，不继续尝试其他来源，以免重复添加；关闭面板并记录来源、尝试列表和前后容器数。容器数用于诊断，本阶段存在检查不要求唯一实例。
5. **保存**：点击 `#saveLayout`，等待网络空闲及保存控件可用，观察 URL 含 save 的写请求 HTTP 错误。目前尚无经验证的业务成功提示选择器，因此这些信号不能单独证明业务保存成功；预览容器存在检查提供后续验证。
6. **打开预览**：点击 `.clickToPreview` 并等待新页；检查已有 frame 和后续 frame 导航，定位主机名以 `.preview.leadong.com` 结尾的内容 frame，等待 body 与 load。预览外壳包含多个 frame，不能直接在外壳 Page 上检查区块。找不到内容 frame 时给出明确错误。
7. **检查和证据**：执行下表七项检查，正常结束或异常时尽力采集编辑器/预览各一张完整页面截图。截图位于 `SCREENSHOT_DIR`，文件名为 `editor-<BLOCK_ID>-<timestamp>.png`、`preview-<BLOCK_ID>-<timestamp>.png`。
8. **报告与退出**：关闭浏览器，将 JSON 写入 `REPORT_DIR/report-<BLOCK_ID>-<timestamp>.json`。`summary.fail`、主流程异常或截图失败均使退出码为 1；`record` 只计数留证，不导致失败。配置无法加载、输出目录不可创建/报告不可写时只能输出终端错误。

### 前台检查口径

每项返回 `{ id, name, status, detail }`，状态包括 `pass`、`fail`、`skip` 和仅供留证的 `record`。检查范围为预览内容 frame 中第一个目标区块实例。

| ID | 断言 | 跳过条件 |
| --- | --- | --- |
| `block-present` | 目标容器存在，记录容器数。缺失则 fail，其他六项全部 skip。 | 不跳过。 |
| `img-alt` | 所有 img 均有 alt 属性，空值允许。 | 无 img。 |
| `link-href` | 所有 a 均有 href 属性，空值允许。 | 无 a。 |
| `cursor-pointer` | 抽样最多 20 个可见、可响应指针且带非空 href 的元素，computed cursor 为 pointer。排除 `javascript:;`、`javascript:void(0)`（包括尾部分号，忽略空白/大小写）。 | 无有效样本。 |
| `css-font-follow` | Evidence-only：读取成功时记录 font-family 声明命中次数及最多 5 个去重声明值，不参与 fail 判定；状态为 `record`。 | 无关联 CSS、CSS 全部获取失败或读取异常时为 `skip`。 |
| `css-word-break` | Evidence-only：读取成功时记录 `word-break: break-word` 命中次数，不参与 fail 判定；状态为 `record`。 | 无关联 CSS、CSS 全部获取失败或读取异常时为 `skip`。 |
| `carousel-arrows` | 读取每个 Slick 实例的有效 options 和 slideCount；DOM 回退时排除 cloned slides。数量≤slidesToShow 时箭头应隐藏（可不存在）；数量更多且启用 arrows 时至少两个箭头可见；arrows=false 时箭头应隐藏。已有但未初始化、无有效 slide 或配置无效的轮播判 fail。 | 无 Slick 轮播。 |

CSS 关联沿用参考实现的 `data-encodeappid`→stylesheet 链接匹配方式。遇到 `concat/<version>/<file1>,<file2>` 时仅提取匹配区块的 CSS 文件，避免其他区块声明造成误报。通过会话 APIRequestContext 获取，避免浏览器 fetch 的 CORS 限制。两项 CSS 检查只取证、不判 fail：成功读取至少一份 CSS 时返回 `record`，依据成功读取的内容记录声明和命中次数；部分文件读取失败时继续用成功内容取证，并在明细和 evidence 中注明未纳入的文件；全部失败、无关联 CSS 或读取异常时返回 `skip`。这两项结果均不参与总体 fail 判定。检查脚本/DOM 异常记 fail，不伪装成 skip。

轮播检查读取现有 computed style、祖先显隐和尺寸，不注入箭头样式。检查不修改文案或布局。截图仅为证据，不作为视觉质量通过的依据。

## 失败处理

导航、元素出现、区块挂载、新页/frame 事件均有超时。模块按钮在等待窗口内未出现时回退下一来源，不吞掉非超时异常。添加按钮一旦点击便不重试其他列表，避免慢渲染引起重复添加。主流程异常记录 `failure.stage` 和错误摘要，尽力截图，关闭浏览器并写报告。单项检查异常记 fail，继续其他检查。

当前不自动重试导航、刷新登录态或删除区块，不读取 `CLEANUP` 执行删除。新增信息保留在 `added`，后续可据此设计只清理本次实例的方案。

## 报告与敏感信息

JSON 包含 `runId`、`startedAt`、`finishedAt`、`status`（passed/failed）、`config` 摘要、`profile` 摘要（`blockId`、`capabilities` 的 ID 列表，无画像时为 null）、`added`、`checks`、`summary: {pass, fail, skip, record}`、`screenshots: {editor, preview}`、`artifactErrors` 和 `failure`。CSS 取证项附带 `evidence` 字段。

`config` 使用白名单：blockId、targetPage、siteDomain、moduleType、browser、ignoreHTTPSErrors，以及 accountConfigured/storageStateConfigured/proxyConfigured 布尔值。已有区块的 `added` 为 `{added: false, countBefore, countAfter}`；本次添加时还包含 `addedVia` 和 `attempts`。

`summary` 只统计检查项；基础设施异常独立记录并使总体状态 failed。报告不保存账号原文、密码、storage state 内容、代理认证或编辑器入口/token。错误摘要写入前屏蔽已知秘密，并去掉 HTTP(S) URL 的用户信息、查询参数和 fragment。不要提交真实 `.env`、登录态、截图或报告。

## 当前文件结构

```text
src/
├── config.mjs       # 已有：环境配置加载和校验
├── browser.mjs      # Firefox、代理、TLS、登录态、视口
├── editor.mjs       # 编辑器、系统页、按需添加、保存、预览 frame
├── checks.mjs       # 七项检查及专属 CSS 读取
├── run.mjs          # CLI 编排、截图、JSON、退出码
└── fixtures/        # storageState-<account>.json（已 gitignore）
reports/             # JSON（已 gitignore）
screenshots/         # 截图（已 gitignore）
```

`package.json` 提供 `test:block`，dependencies 精确固定 `playwright-core` 和 `dotenv`，并同步 lockfile。浏览器可执行文件需预先安装。本阶段不引入 `@playwright/test` runner。

## 提测扩展模型

当前七项检查是第一阶段的通用基线。后续按 [BLOCK_TESTING_MODEL.md](./BLOCK_TESTING_MODEL.md) 扩展为“通用套件 + 类别/数据套件 + 区块专属套件”：每个提测区块先建立 `profiles/<BLOCK_ID>.json` 画像，标明类别、`static`/`dynamic`/`hybrid` 数据模式、内容管理数据来源、交互、测试数据和 Figma 节点；运行器再据此组合检查。动态区块重点验证数据来源、字段映射、筛选/搜索、排序、分页、状态恢复和空状态；专属检查从 Figma 与业务规则提炼，只有预期明确且已确认的候选才升级为硬断言。

### 能力注册表与 40838 设置覆盖

规格以 [SETTINGS_COVERAGE_40838.md](./SETTINGS_COVERAGE_40838.md) 为准，定位依据见 [SETTINGS_INVENTORY_40838.md](./SETTINGS_INVENTORY_40838.md)。`src/run.mjs` 注册三个 ESM 模块：`custom-filter-fields`、`product-list-display`、`button-link`。运行器按画像 `capabilities` 的顺序逐个调用；没有对应模块或没有该层导出时跳过该层。无画像时继续运行通用检查。

设置层统一为 `runSettingsLayer({page, canvas, context, config})`，在按需添加之后执行；canvas 保持 `gotoTargetPage` 返回的 FrameLocator。前台层统一为 `runFrontLayer({frame, config})`，在页面保存、打开预览并执行七项通用检查之后执行。每层异常隔离成一条 `<capability>-settings-error` / `<capability>-front-error`（fail），继续后续能力。报告结构与 `summary` 四种状态统计保持原样；结果均带 `suite: capability:<id>`。

`shared.mjs` 集中子区域设置入口、主页面 widget 弹窗生命周期、控件快照与轮询、radio 和通用持久化闭环。闭环记录原值、翻转、保存、重开回读，在 finally 中重新打开并恢复原值、保存、重开断言、退出，再调用 `savePage` 保存恢复后的页面。回读失败也会独立尝试退出与页面保存；恢复或页面保存失败必须报告 fail，不能宣称恢复成功。控件按序号、类型、name 与标签核对身份，避免重开后误改其他设置。探查时不存在、归属不唯一或不可切换的控件 skip；开始改写后发生的错误 fail，并写明阶段。

| ID | 检查内容与判定 |
| --- | --- |
| `cff-settings-fields` | record：可选自定义字段与勾选状态，排除全选；保持 v1 口径。 |
| `cff-settings-state` | pass/fail：三组 radio 的唯一当前值，detail 保持 v1 口径；evidence 另含全部 radio 组、选项及 checked label，包含未知的“不开启”和无选中值的组。 |
| `cff-settings-persist` | 优先选未勾选字段做保存回读与恢复，保持 v1 ID/口径；无可切换字段 skip。 |
| `cff-field-front-group` | 在 persist 恢复后复用同一字段，翻转、保存弹窗及页面、打开临时预览，按字段名断言组标题出现；如果所有字段均已启用，则翻转禁用时断言标题消失。finally 关闭临时预览、恢复字段并保存页面；不能确认 persist 已恢复或无字段时 skip。 |
| `cff-radio-persist` | 按已验证标签前缀依次验证逻辑、触发、范围；三组均通过才 pass，detail 逐组报告。产品范围切换后额外采集预览组和值清单（record evidence），不要求数据发生变化；取证不可用注明 skip。并集与自动触发只做设置持久化。 |
| `cff-select-persist` | 筛选后跳转页选择另一个可用 option，保存回读并恢复；无唯一 select 或可替换 option 时 skip，不触发真实搜索跳转。 |
| `cff-color-persist` | 背景颜色输入（type=color，或背景颜色上下文内的文本输入）改色、保存回读、恢复；定位不唯一 skip。 |
| `cff-groups-baseline` | record：各组标题和值基线，排除 All/Reset 等；保持 v1 口径。 |
| `cff-facet-narrow` | 选择首组首值，轮询值集合变化与已选标签，并断言其他组值为基线子集；保持 v1 口径。 |
| `cff-clear-restore` | Clear Filters 后轮询组和值恢复；保持 v1 口径。 |
| `pld-fields` | record：产品列表系统属性、自定义字段清单与勾选状态，排除全选。 |
| `pld-page-size-persist` | 数量切到 10（原为 10 时切到 20），保存回读并恢复。兼容盘点中的 text 输入，上限 100。 |
| `pld-pagination-persist` | 分页展示“是/否”保存回读并恢复。 |
| `pld-compare-persist` | 产品对比“关闭/开启”保存回读并恢复。 |
| `pld-display-field-persist` | 任选一个可切换展示字段 checkbox，保存回读并恢复。 |
| `pld-front-note` | record：在首个 `.LA<id>` 内采集产品条目/名称选择器计数。无条目时说明列表类设置只验证设置层；检测到候选条目或探查不可用时如实说明，均不伪装效果通过。空列表壳本身不算产品条目。 |
| `btn-state` | record：链接网址、按钮文本、新窗口状态及浮层实际探查容器结构。 |
| `btn-text-persist` | 文案切到 AUTOTEST-BTN，保存回读并恢复；原值相同时使用 AUTOTEST-BTN-ALT。 |
| `btn-url-persist` | 补充覆盖表中的“链接网址可改时验证”：改为 example.com 测试地址，只保存链接，不执行跳转，回读后恢复。 |
| `btn-target-persist` | 新窗口 checkbox 翻转、保存回读并恢复。 |
| `btn-front-text` | pass/fail：预览首个目标区块内存在与设置层读到的按钮文本精确相等的元素；未读到时用盘点默认值并在 detail 注明来源。 |

筛选/列表入口分别限定首个目标区块的 `phoenix_blocks_filterStyle` / `phoenix_blocks_gallery` 子区域；弹窗在主页面 `.backstage-dialog.backstage-dialog-widgetsettinsframe`，footer 为保存/取消。按钮入口限定 `phoenix_blocks_button`，浮层通过主页面“链接网址”叶文本向上寻找最小可见容器，要求包含文本输入、新窗口 checkbox 和唯一保存控件，每次重开重新探查并核对。在线 DOM 探针在本次环境被网络限制挡住，因此代码不固化未经确认的 class；真实结构随 `btn-state.evidence` 留证。浮层打不开、控件不唯一或无法稳定关闭重开时，设置项 skip，避免改写未知区域。

前台限于预览内容 frame 首个 `LA<BLOCK_ID>`。临时效果预览与最终通用预览分开，临时标签在 finally 关闭（包含 openPreview 创建标签后抛错的情形）。字段启用效果失败会写明保存/预览/断言阶段；设置恢复与页面保存失败同样 fail。当前使用动态数据，范围取证不硬断言值清单必然变化，产品结果集仍需固定夹具与业务 Oracle。通用七项检查口径不变。
