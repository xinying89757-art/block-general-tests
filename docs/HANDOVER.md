# 通用区块测试工作流交接

区块 ID、页面、站点和 CMS 数据都由 CLI、`profiles/` 或 `sites/<host>/` 数据提供。代码只实现通用定位、setting-unit 生命周期、断言组合和报告，不从样例区块推断字段、产品或分类。

## 日常测试与 fresh scene

已有测试页按画像运行 `BLOCK_ID=<id> npm run test:block`；分段可用 `CAPABILITY_FILTER` 与 `CHECK_GROUP`。新的干净现场通过 `scripts/fresh-block.mjs`，必须显式传入页面类型/ID/URL。它仅处理页面上区块号等于目标的实例，添加一个默认实例，然后由 `freshSettings` 单元及 batch planner 执行；默认配置、替代值和 oracle 沿用画像与已有断言。单元、依赖、持久控件和 lifecycle 详见 `docs/setting-units.md`。报告的失败留在现场时要记录冲突设置与证据。

## Onboarding 与模块库

新区块可用 `scripts/onboard-block.mjs --block <id> --page-kind system --page-id <id> --page-url <path>` 接入。先从 `profiles/TEMPLATE.json` 生成未审核草稿，唯一通用签名可自动映射；歧义会停止，未知项保留为 `unmapped`。人工补齐夹具和 expected/oracle 后才作为常规画像使用。未找到目标模块时会生成结构化环境结果，不会把它记成 assertion fail。

只读目录工具：`scripts/list-module-library.mjs --block <id> --page-kind system --page-id <id> --page-url <path>`。它打开并关闭添加模块面板，不添加模块、不保存、不发布。review/develop 可见项会列出；online 为搜索式，只能精确查询目标编号，不能代表完整目录。

## 前台验证与报告合并

前台检查可走编辑器预览，或已发布公开前台。采用公开页时，先确认编辑器保存成功且页面发布成功，再访问 HTTP 页面，并用 `?t=<timestamp>` 避免缓存。前台不可用时保留 `deferred`，不当作通过。Mac/front-only 报告回来后运行：

```sh
npm run merge:fresh-front -- reports/box.json reports/front.json reports/merged.json
```

合并器以检查 ID 对齐，保留盒端与前台来源；只允许前台结果替代盒端 `deferred`，其他状态保留盒端 verdict。它输出 merged JSON 和中文摘要。Mac 运行器与设备不在本工作流中修改或操作。

## 环境重试与安全

`ENV_TIMEOUT_RETRIES`（0–2，默认 1）只控制明确环境等待阶段的 timeout 重试：导航、编辑器 ready 和模块库加载。断言失败不会重试；设置保存、添加/删除和发布这类有副作用动作不由该机制重放。所有真实站点操作需显式指定 host 与 page，不能用样例值替代用户目标。

## 已知开放事项

- Mac PR #9 报告：发布后的样例区块 47748 未出现在公开 HTTP `/products.html`。这是待现场查明的可见性问题，不据此调整 assertion。
- G29 在 review、develop、online 搜索三种模式均未找到样例 47498。G30 只读盘点在编辑器加载超时前停止，未重新打开模块库，故没有新增目录证据。
- 未映射设置、缺少 fixture oracle、未适配 lifecycle 与 deferred front checks 都必须在报告中显式保留；不得静默通过或从样例区块外推。
