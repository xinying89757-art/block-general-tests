# 区块设置项自动化测试

测领动（Leadong）页面构建器里的普通区块：每个设置项是不是真的生效。
跑测试的是智能体（Codex、Claude Code、Muse 或其他），不是人敲命令，也不是网页服务。
你对智能体说一句话，它问你要的东西、跑测试、出报告。

## 它测什么

- 设置层：设置项存在、选项与默认值对不对、改了保存后还在不在。
- 效果层：保存后前台是不是真的变了（筛选、分类、配色、宽度、产品对比、样式）。
- 数据层：前台列表和内容管理后台算出来的结果对不对得上（oracle）。
- 样式：按 Figma 设计稿逐项比对（字号、颜色、行高、圆角），Pad 和移动端只查有没有错乱。
- 通用检查：区块存在、图片 alt、链接、指针样式、字体跟随、轮播。

能力是按设置项复用的：一个区块声明自己有哪些能力，套件就自动组合跑。
新区块多数时候只写画像，不写代码；只有全新的设置项类型才写新能力模块。

## 并发运行

同一测试站的运行器会使用 `.run-lock/` 下的文件锁；可用 `RUN_LOCK_DIR` 指定锁目录。
锁记录主机、进程、开始时间和模式，超过两小时或同主机进程已退出时视为过期。
盒子与 Mac 不共享文件锁，因此盒子端 live run 与 Mac 前台 run 必须人工确保不重叠；运行开始时会打印此提示。

## 安装（新同事第一次）

```sh
git clone <本仓库地址>
cd block-general-tests
npm install
npx -y playwright@1.56.1 install firefox
cp .env.example .env
```

默认用 Chrome（`BROWSER=chromium`，固定使用 `channel: "chrome"`，要求安装系统 Chrome，仅安装 Playwright Chromium 不满足此要求）。代理受限的机器（比如 miumiu 这台，Playwright Chromium 经出口代理访问外站失败）改设 `BROWSER=firefox`。`HEADLESS` 可设 true/false，默认 CI 为 true，非 CI 下 Firefox 为 true、Chromium 为 false；`SLOW_MO` 为非负整数毫秒，默认 0。

HTTP 预览兼容：默认 `HTTPS_UPGRADE=1`，浏览器 context 会把指定的领动服务域名 HTTP 请求升级到 HTTPS，覆盖预览 iframe 和弹出新标签页。默认规则为 `website.leadong.com`、`www.leadong.com`、`*.preview.leadong.com`、`*.leadongcdn.com`；可用 `HTTPS_UPGRADE_HOSTS`（逗号分隔，支持 `*.example.com`）整体覆盖。设为 `0`、`false` 或 `off` 可关闭。`ldwebsite.com`、`ldyjz.com`、`ldmfyh.com` 前台域始终排除，因为这些站点没有 HTTPS。

然后对你的智能体说：“帮我测区块 47748”，它会带你走首次设置：

1. 测试站点：把要测的站点语种地址填入 `SITE_DOMAIN`；编辑器优先从固定 pagebuilder 地址进入，落到站点列表时按域名唯一匹配卡片、选语言、点“编辑网站”（可选 `SITE_NAME` 为站名回退）。登录脚本仍列出站点并写入备选 `EDIT_SITE_URL`，它只在列表结构变化、找不到卡片时使用，不再必填。账号下没有该站就停止并提示换账号。
2. 账号密码：你的领动账号。密码只放你自己机器的 `.env` 里，智能体只告诉你放哪，
   不让你贴进聊天里，也不打印、不提交、不进报告。
3. 区块 ID：要测的区块（编辑器里的 data-appid）。
4. 页面选择（二选一）：新建一个自定义页面来测（名字默认“测试-区块 ID”，页面和区块都留着，
   以后就是这个区块的固定测试页）；或者选一个系统页，按名称选（Products 等）。
   区块不在那个页面上，智能体会加上去，加上去也不移掉。
5. 设计稿链接（可选）：Figma 链接，样式检查要用。没有 Figma token 或连接器时，
   样式检查会跳过并说清楚。
6. 代理（可选）：测试环境要走 HTTP 代理才填，没有就直连。

每给一样，智能体当场验一样：登录不上、站点打不开、区块找不到、设计稿解析不了，
立刻就告诉你，不会等跑起来才报错。

## 日常使用

首次设置完，以后就是一句话：

```
测 47748
```

智能体跑完先说结论：有没有新问题，还是上次那几个已知问题。
细节在报告里：`reports/<runId>.html`（能点开看、能筛选、能发给同事），
原始数据在 `reports/<runId>.json`，截图在 `screenshots/`。

判断点只在必须你拍板的地方停，比如“这几个样式差异算不算问题”，
智能体把证据、截图、建议和每个选项的后果打包一次给你，你点一下就行。
你判过的东西写回画像和手册，同一个问题不问第二遍。

## 离线检查 / CI

运行 `npm run ci` 可在本机或 GitHub Actions 执行离线检查：校验 `src/`、`scripts/`、`tests/` 下的 `.mjs` 语法、相对导入、区块画像结构与夹具，再运行 `tests/` 中的 Node 测试。GitHub CI 只做这些离线检查，不访问站点、不安装浏览器；实站回归仍在本机通过 `npm run test:block` 运行。

## 外部前台核验

盒子运行器会分别核验目标前台页面和站点根路径。如果目标页不可读且根路径也返回 5xx、空响应或网络错误，报告会标记 `front-unreachable-from-runner`；这代表运行器的网络路径无法确认前台，不代表编辑器发布失败。报告会把编辑器的“发布成功”信号记在 `editorPublishSucceeded`，而 `publishedConfirmed` 仍为 `false`。

在可访问前台的外部机器上完成核验后，可将外部检查结果写回同一份报告。结果 JSON 结构如下：

```json
{
  "url": "http://example.test/products.html?t=123",
  "httpStatus": 200,
  "blockFound": true,
  "settingIdFound": true,
  "checkedAt": "2026-11-01T00:00:00.000Z"
}
```

运行：

```sh
node scripts/ingest-external-front-verification.mjs reports/fresh-block-<id>-<run>.json /path/to/external-check.json
```

脚本会追加 `externalFrontVerification`。只有 HTTP 2xx 且 `blockFound` 与 `settingIdFound` 都为 `true` 时，才将 `published` 和 `publishedConfirmed` 设为 `true`，来源记为 `external-front-check`。外部检查器应确认目标报告中的区块号和本次新 `settingId`；脚本会移除 URL 中的凭证、非缓存查询参数和片段，避免把令牌写进报告。

也可直接附加 `scripts/front-style-only.mjs` 产生的前台样式报告：

```sh
node scripts/ingest-external-front-verification.mjs reports/fresh-block-<id>-<run>.json /path/to/front-style-<id>-<run>.json
```

当输入 `flow` 为 `front-style-only` 时，脚本校验区块号与 settingId，并在盒子报告中增加 `externalFrontStyleReport`（输入文件名、pass/fail/na/other 数量、settingId、检查时间）。该汇总附件不会单独确认发布；发布确认仍需使用上面的前台实例核验结果。

### 前台样式失败原因

`scripts/front-style-only.mjs` 的 JSON 报告在每条非 `pass` 检查上附 `reason`：`stage` 是 `locate`、`read` 或 `compare`；`locator` 和 `matchedElementCount` 说明实例内定位及命中数；`property`、`expected`、`actual` 用规范化样式值描述比较项；`viewport` 记录视口。颜色等受区块设置控制的期望值可用 `--run-report reports/fresh-block-<id>-<run>.json` 从本轮的 `block.currentValues` 解析；只有本轮确实写入时才作为本轮期望。默认色检查遇到本轮不同颜色会记为 `na`（机器原因 `palette-default-overridden-this-run`），本轮写入色由独立的写入色检查验证。失败原因中的 `expectedSource` 会注明来源。`skip`/`na`/`deferred` 还带 `applicability`，异常会带已脱敏的 `error.class` / `error.message`。有失败截图时，`reason.screenshot` 指向对应视口截图；移动端超框还会列出 offending element 的 CSS 路径。原因里不保存页面正文、Cookie 或带令牌的 URL。外层浏览器/导航错误会作为 `status: "error"` 的逐项 harness 记录，不改写断言结果。

设计清单中的 typography 仅检查该条规范明确提供的 `fontSize`、`fontWeight`、`lineHeight`；不把颜色、盒子尺寸或能力画像的其他属性混入。分页颜色范围按画像映射到当前页；非当前页颜色继续按它自己的设计条目判定。候选选择器在画像候选未命中时，样式检查可在唯一实例根节点内按链接/列表层级推导候选；没有结构证据时保留 `na`，不猜测。

`block-style-spec` 画像中若只有 `recordOnly` 库存项，会按 `record` 输出这些待人工建立前台映射的能力，并继续执行通用视口布局检查。不要把设置库存标签当作前台 DOM 选择器。

## 安全和恢复的底线

- `.env` 里有你的账号密码，永远不提交、不分享、不打印。仓库里只有 `.env.example`。
- 跑的过程中改过的设置，跑完必须恢复原状，恢复完换个新会话读一遍确认。
  页面和区块不删，删的只有测试过程中临时改的设置值。
- 跑之前确认测的是测试站，不是正式站。

## 目录

- `src/run.mjs`：运行器（`npm run test:block`）。
- `src/capabilities/`：能力库，每个设置项类型一个模块。
- `src/editor.mjs`：编辑器操作（打开编辑器、选页、建页、加区块、保存、预览）。
- `profiles/`：画像，每个区块一个，声明能力、oracle、样式期望、目标页。
- `docs/REUSE_MANUAL.md`：复用手册，全部的规则和教训都在这里。
- `scripts/`：探针与工具（含登录、Figma 抽取、报告页面生成）。
- `AGENTS.md`：智能体操作指令；`SKILL.md`：skill 入口。
