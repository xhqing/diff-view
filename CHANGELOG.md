# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-10-18

### Changed

- **整合为 diff-view 项目（两个组件、一次安装）**：2026-10-18 用户决定——pi 侧与 VSCode 侧本是一个功能，应放同一个项目。原 `diff-bridge` 拆为两个组件：
  - `diff-view-pie/`：pi 侧扩展（源 `diff-view.ts`，部署到 `~/.pi/agent/extensions/`）；
  - `diff-view-vsce/`：VS Code 侧扩展（原项目主体代码迁入；扩展身份 `xhqing.diff-bridge` → `xhqing.diff-view-vsce`，名称 / 显示名 / 命令 id / 输出渠道 / 状态栏文案同步更新）。
- 新增 `install.sh`：一次安装两个组件（pi 侧拷贝部署 + VS Code 侧打包安装，含旧 `xhqing.diff-bridge` 卸载）；README 双语重写，说明两个组件各自职责、都必须安装、协作机制与排障。
- logo 更名为 `diff-view`（双窗格 + 跨桥弧线不变）；版本号 0.1.0 → 0.2.0。
- 内部管道不变（有意）：状态目录 `~/.pi/agent/state/ai-edit-diff/` 与环境变量 `AI_EDIT_DIFF_*` 保持原名——两个组件与旧版本会话都指向它们，改名会打断请求 / 确认协议。

## 2026-10-18

### Changed

- 引用更名：全局 pi 扩展 `ai-edit-diff` → `diff-view`（原名把范围说窄成「AI 编辑产生的 diff」，实际定位是「独立于 git 的文件内容 diff 视图」）。README 双语与 `extension.js` 注释同步更新（双语文案语义对齐）；pi 状态目录 `~/.pi/agent/state/ai-edit-diff/` 不变——已装版本的扩展仍指向它，运行行为零变化。

### Added

- 项目标配补齐（commit skill 第 9 步）：`assets/logo.svg`（项目象征 logo——双窗格 + 跨桥弧线、indigo 渐变，文字全英文）、README 双语顶部 logo + License/Version/Type 徽章块、双语底部「版权与署名」段；配套写入 `.commit-cache.md` 检测缓存。

## [0.1.0] - 2026-10-18

### Added

- **diff-bridge 初版**：pi「改动可视化」的 VSCode 侧助手。每个 VSCode 窗口内每 1 秒轮询 pi 的关闭请求（`~/.pi/agent/state/ai-edit-diff/close-requests/`），把请求落实为「静默关闭由 pi 打开的 diff 标签」（只关左侧为 pi 改动前快照的 diff；`preserveFocus` 不抢焦点），并把关闭数量回写为确认（`close-acks/`），供 pi 的 `/close-diff` 命令与 `close_diff` 工具汇总回报用户。
- 请求有效性：只处理 30 秒内写入的请求，过期请求与确认文件自动清理（多窗口各自轮询、互不影响）。
- 命令面板命令：「Diff Bridge: 关闭全部由 pi 打开的 diff 标签」（手动兜底）。
- 输出渠道 `diff-bridge`：记录处理过的请求与关闭数量，便于排障。

### Why

- pi 侧 2026-10-18 新增 `/open-diff`、`/close-diff` 命令（用户需求：diff 的打开 / 关闭做成可直接键入的命令）。VSCode 没有「从外部关闭标签页」的官方接口——`code` CLI 无子命令、AppleScript 查不了 VSCode 窗口（实测 `-1728`）、UI 脚本抢焦点——因此把「关闭」这一步放进 VSCode 内部执行：由本扩展消费 pi 写下的请求文件。

### Project

- 初始项目骨架：`extension.js`（轮询与关闭逻辑）、`lib/util.js`（纯逻辑，便于测试）、README 双语、CHANGELOG、VERSION、LICENSE。
