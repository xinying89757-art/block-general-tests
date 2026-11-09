# 47948 fresh-block 设置覆盖（2026-11-09）

测试站 Products 系统页，fresh-block 全流程；实例 `AyUlfCmMGzrn`。画像仍为 `draft-unreviewed`，以下不代表设计稿或前台验收。

| 范围 | 结果 |
| --- | --- |
| 宽度、数据来源、展示字段、自定义筛选、每页数量、分页设置持久化 | 6 pass |
| 发布后编辑器重载：12 个已声明持久控件 | pass |
| 产品对比设置 | na |
| 展示字段需求 | skip，需求未提供 |
| 宽度与筛选现状 | 3 record |
| 展开折叠、启用开关 | 2 not-applicable |
| 公开发布确认、前台检查 | 2 deferred；目标页与根路径均返回 Pingora HTTP 500 |

编辑器报告发布成功，但公开实例未能确认。默认值比较的 5 条变化均为旧、新实例 settingId 的隐藏字段变化；不是已确认产品缺陷。报告：`reports/fresh-block-47948-1794193259181.json`。
