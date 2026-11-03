# 新人一页纸

这个项目用于乐动页面编辑器里定制区块的设置项自动化测试。

## 第一天怎么做

1. 先读 [AGENTS.md](../AGENTS.md)，了解智能体操作指令。
2. 确认要测的区块，在 `profiles/<区块ID>.json` 查看能力的 `reviewStatus`，只跑已批准的能力；不清楚就问负责人。
3. 在已准备好的测试环境跑一个已批准的小能力，把 `xxx` 换成区块 ID，并确认目标页是 Products：

   ```bash
   BLOCK_ID=xxx TARGET_PAGE=Products TARGET_PAGE_KIND=system CAPABILITY=module-width npm run test:block
   ```

4. 需要发布时，只用「当前页面发布」，绝不用整站发布。
5. 需要前台检查时，先停止 VM 上的站点操作，再用 `node scripts/handoff.mjs --from VM --to Mac` 交接；交接完成后由 Mac 继续。
6. 看 `reports/` 下该区块的最新报告，先看结论，再看失败、跳过和截图；需要报告页面时用下方命令生成。

## 核心铁律

- 不碰页面其他区块。
- 两台电脑不同时操作测试站。
- 只用「当前页面发布」。

## 常用命令速查

在项目目录运行；先确认区块和目标页已经配置正确。

| 命令 | 什么时候用 |
| --- | --- |
| `npm run test:block` | 日常回归。 |
| `node scripts/capture-baseline.mjs <区块ID>` | 只读捕获基线，不改站上设置。 |
| `node scripts/handoff.mjs --from VM --to Mac` | 需要前台检查时交接给 Mac。 |
| `node scripts/report-html.mjs reports/<runId>.json` | 从 JSON 报告生成报告页面。 |
| `node scripts/missing-data-impact.mjs [--block <id>]` | 汇总缺数据影响；省略区块时取全局文件名降序最新报告。 |
| `node scripts/merge-reports.mjs <报告1> <报告2> [输出]` | 将分段运行的报告合并。 |

## 遇到问题先看

[AGENTS.md](../AGENTS.md) → [docs/REUSE_MANUAL.md](REUSE_MANUAL.md) → 问负责人。
