# Changelog

All notable changes to this project will be documented in this file.

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
