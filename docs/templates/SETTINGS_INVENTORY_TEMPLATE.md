# <BLOCK_ID> 设置项盘点（模板）

区块：<名称>；目标页：<页>；语言：<语言>；盘点日期：<YYYY-MM-DD>

盘点时不改值。只记录看到的东西，归属不确定的先写“未捕获”，不猜。

## 入口机制

- 子区域个数、每个子区域的 `data-blockseditor-type`：
- 设置入口：每个子区域第一个 `a.backstage-widgettool-btns` 是设置，第二个是编辑样式。settingId 与 uuid 会变，不写死。
- 设置弹窗位置：主页面 `.backstage-dialog.backstage-dialog-widgetsettinsframe`，还是画布 frame 内的 `.editor-box`，还是其他，先写实测结果。
- 右侧 `.siteblocks-setting-operateTools` 是容器级操作，不记入组件功能设置。

## 子区域 1：<名称>（<data-blockseditor-type>）

弹窗标题「<标题>」：

| 设置项 | 控件 | 当前值 / 默认 | 备注 |
| --- | --- | --- | --- |
| <设置项> | <多选 / radio / select / 输入 / 取色器> | <当前值> | <选项、取值范围、归属是否确认> |

## 子区域 2：<名称>（<data-blockseditor-type>）

同上，按实际子区域个数复制。

## 与能力模块的映射（盘点后填）

- 子区域 1 → 能力 `<id>`（命中 / 变体 / 全新）：
- 子区域 2 → 能力 `<id>`（命中 / 变体 / 全新）：

## 待确认

1. <归属标签未捕获、含义不明的设置项，只记录不翻转>
2. <Figma 或业务规则没确认的断言，先标 candidate>
