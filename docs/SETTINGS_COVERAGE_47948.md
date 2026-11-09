# 47948 fresh-block 设置覆盖（2026-11-09）

测试站 Products 系统页；画像仍为 `draft-unreviewed`。完整需求→检查对照见
`/workspace/47948/codex/artifacts/47948-coverage-audit.md`。

## 已澄清的缺口
- `pld-fields` 曾因空 `displayFieldTypes` 被 skip；设计稿 1–4/5–10/11+ 是**卡片布局分带**，不是 CMS 字段类型。筛选「下拉/单选/多选/文本」不得写入 `displayFieldTypes`。
- 4:3 vs 3:4 比例冲突保持 human-review。
- 前台 Pingora HTTP 500 → deferred，不是产品失败。

## 上一轮实站（修复前）
实例 `AyUlfCmMGzrn`：pass 7 / fail 0 / na 1 / human-review 0 / deferred 2；`pld-fields` skip。该 `human-review=0` **不表示**无设计疑问。

## 本轮覆盖感知全量复测（2026-11-09）
- 实例 `wiKlpCRWyerd`；三批设置检查完成：pass 8、fail 0、na 1、human-review 2、record 4、deferred 2，另有 2 项 not-applicable。
- `pld-fields` 为 record，盘点到 28 个展示字段；`pld-display-field-types-requirement` 为 human-review。画像 `displayFieldTypes` 仍为空，未用布局分带或筛选类型填充。
- `designRequirementCoverage` 保留布局分带、筛选类型和 4:3 / 3:4 比例冲突等待人工判断项；产品名称截断的前台检查未执行。
- 编辑器发布成功信号已出现；目标页与站点根路径均返回 Pingora HTTP 500，公开发布确认和前台检查 deferred。发布后重载的 12 个已声明持久控件一致。
- 画像仍为 `draft-unreviewed`；本轮未运行 line-height 检查或全局交互扫描。详情见 `reports/fresh-block-47948-1794194676048.json`。
