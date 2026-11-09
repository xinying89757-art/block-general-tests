# 47948 fresh-block 设置覆盖（2026-11-09）

测试站 Products 系统页；画像仍为 `draft-unreviewed`。完整需求→检查对照见
`/workspace/47948/codex/artifacts/47948-coverage-audit.md`。

## 已澄清的缺口
- `pld-fields` 曾因空 `displayFieldTypes` 被 skip；设计稿 1–4/5–10/11+ 是**卡片布局分带**，不是 CMS 字段类型。筛选「下拉/单选/多选/文本」不得写入 `displayFieldTypes`。
- 4:3 vs 3:4 比例冲突保持 human-review。
- 前台 Pingora HTTP 500 → deferred，不是产品失败。

## 上一轮实站（修复前）
实例 `AyUlfCmMGzrn`：pass 7 / fail 0 / na 1 / human-review 0 / deferred 2；`pld-fields` skip。该 `human-review=0` **不表示**无设计疑问。
