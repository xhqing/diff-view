<div align="center">
  <img src="assets/logo.svg" alt="diff-bridge" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.1.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](#)

  [English](README.md)
</div>

# diff-bridge

> pi「改动可视化」的 VSCode 侧助手：让 pi 里一条命令就能**静默关闭由 pi 打开的 diff 标签**。

配合全局 pi 扩展 [`diff-view`](../../../.pi/agent/extensions/diff-view.ts)（原名 ai-edit-diff，改动可视化）使用：在 pi 里键入 `/close-diff`（或让我调用 `close_diff` 工具），VSCode 里由 pi 打开的 diff 视图就会静默关闭。

## 为什么需要它

VSCode 没有提供「从外部关闭标签页」的官方接口：

- `code` CLI 没有关闭编辑器的子命令；
- AppleScript 不支持查询 VSCode 窗口（实测报 `-1728 Can't get name of every window`）；
- UI 脚本（模拟按键 / 点击）会抢走屏幕焦点，且脆弱。

所以采用「**请求文件 + 确认文件**」协议：pi 只负责写请求，真正的关闭动作由本扩展在 VSCode **内部**执行——不抢焦点、不打断用户。

## 工作原理

- pi 侧（`diff-view` 扩展）在 `~/.pi/agent/state/ai-edit-diff/` 下写请求：
  - `close-requests/<id>.json`：`{id, ts, paths}`；`paths` 为空数组 = 关闭全部由 pi 打开的 diff，否则只关这些文件；
  - 然后等待 `close-acks/<id>-*.json` 确认（每个 VSCode 窗口写一份、含关闭数量），最多等 2 秒后汇总回报用户。
- 本扩展在**每个 VSCode 窗口内**每 1 秒轮询一次请求目录：只处理 30 秒内写入的请求（防陈旧请求误关后来新开的标签），处理完回写确认；过期请求与确认文件会自动清理。
- **只关闭「左侧 = pi 改动前快照」（`state/ai-edit-diff/snapshots/` 下的文件）的 diff 标签**——用户自己开的对比视图、普通编辑器一概不动；关闭时 `preserveFocus`，不会抢焦点。

## 安装

本地构建安装（尚未发布到 Marketplace）：

```bash
vsce package --allow-missing-repository
code --install-extension diff-bridge-0.1.0.vsix
```

安装 / 更新后需要在 VSCode 中**重载窗口**（命令面板 → `Developer: Reload Window`，或等下次自然重开）才会生效。

## 使用

- 在 pi 中键入 `/close-diff` 关闭全部由 pi 打开的 diff；`/close-diff <文件路径>` 只关该文件。
- VSCode 命令面板搜索 `Diff Bridge`，可手动执行「关闭全部由 pi 打开的 diff 标签」。
- 排障：命令面板 → `Output: Focus on Output View`，选择 `diff-bridge` 渠道查看处理日志。

## 卸载

```bash
code --uninstall-extension xhqing.diff-bridge
```

（卸载后 pi 侧的 `/close-diff` 会如实报告「没有窗口响应」，不影响其它功能。）

## 开发

- 纯逻辑（路径判断 / 请求解析）在 `lib/util.js`；
- 交付前的临时验证脚本示例见 `tmp/`（不提交）；项目正式测试用例由测试 Agent（Hopper）出题；
- 自检：`npm run check`（全部 JS 语法检查）。

## 版权与署名

Copyright (c) 2026 All Contributors。基于 [MIT License](LICENSE.md) 发布。

署名：使用或引用本项目时，请保留版权声明并注明来源：[diff-bridge](https://github.com/xhqing/diff-bridge)。
