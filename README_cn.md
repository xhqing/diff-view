<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.2.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20%2B%20VS%20Code-6E56CF)](#)

  [English](README.md)
</div>

# diff-view

> 独立于 git 的文件 diff 查看器，横跨 pi 与 VS Code —— 两个扩展、一个功能。

**diff-view 由两个扩展组成，两个都安装才是完整功能：**

| 组件 | 安装位置 | 职责 |
|---|---|---|
| `diff-view-pie` | pi（全局扩展：`~/.pi/agent/extensions/`） | 在 pi 里注册 diff 工具与命令：`open_diff` / `close_diff`、`/open-diff` / `/close-diff`，以及跨会话变更通知。 |
| `diff-view-vsce` | VS Code（VSIX） | 承担 VS Code 侧的实际动作：静默关闭由 pi 打开的 diff 标签（VS Code 没有从外部关标签的官方接口）。 |

为什么要拆成两半：pi 能「打开」diff 视图、也想按需「关闭」它，但 VS Code 没有从编辑器外部关闭标签的官方途径（CLI 无此子命令、AppleScript 查不了窗口、UI 脚本会抢焦点）。于是两侧通过一套「请求文件 + 确认文件」的小协议协作——见「工作原理」。

只装一半会怎样：

- 只装 pi 侧 → `/open-diff` 可用，但 `/close-diff` 会如实报告「没有窗口响应」（没人能关标签）；
- 只装 VS Code 侧 → 没有东西驱动它，无 diff 可关。

## 安装

```bash
./install.sh
```

脚本一次装好两个组件；装完：

- pi 侧：新会话自动生效（正在跑的会话里执行 `/reload` 亦可）；
- VS Code 侧：**重载 VS Code 窗口**（命令面板 → `Developer: Reload Window`），新扩展才会启用。

手动安装：

1. **pi 侧** —— 把 `diff-view-pie/diff-view.ts` 拷进 `~/.pi/agent/extensions/`；
2. **VS Code 侧** —— 跑 `./build.sh`，解压 `dist/diff-view-<version>.zip`，然后 `code --install-extension diff-view-vsce-<version>.vsix --force`（若还装着旧身份 `xhqing.diff-bridge`，先卸载）。

想直接用已发布的构建？从[最新 Release](https://github.com/xhqing/diff-view/releases) 下载 `diff-view-<version>.zip`，按同样的两步安装它的两个组件。

## 构建与发布产物

```bash
./build.sh
```

产出**唯一**发布产物到 `dist/`，版本号取自项目版本（`VERSION` 是唯一权威——两个组件共用同一个版本号）：

- `dist/diff-view-<version>.zip`，内含：
  - `diff-view-vsce-<version>.vsix` —— VS Code 侧（用 `code --install-extension <vsix> --force` 安装）；
  - `diff-view.ts` —— pi 侧（拷进 `~/.pi/agent/extensions/`）。

从产物安装同样是「两个都要装」的两步。已发布的构建见 [GitHub Releases](https://github.com/xhqing/diff-view/releases)。

## 使用

- pi 里：
  - `/open-diff`（或 `open_diff` 工具）—— 打开 diff 视图（左：改动前快照、右：当前内容）；
  - `/close-diff` 关闭全部由 pi 打开的 diff；`/close-diff <文件路径>` 只关该文件的（也可用 `close_diff` 工具）。
- VS Code 里：命令面板 → `diff-view-vsce: 关闭全部由 pi 打开的 diff 标签`（手动兜底）；日志见 `diff-view-vsce` 输出渠道。

## 工作原理

- pi 侧为被跟踪文件登记「改动前快照」，并可按需打开 diff 视图；
- 关闭时，pi 侧把请求文件写到 `~/.pi/agent/state/ai-edit-diff/close-requests/`；
- `diff-view-vsce` 在**每个 VS Code 窗口内**每秒轮询该目录，只关闭**左侧为 pi 快照**的 diff 标签——你自己开的对比视图与普通编辑器一概不动；关闭用 `preserveFocus`，不抢焦点；
- 每个窗口回写确认（`close-acks/`），pi 侧汇总结果回报给你。

## 安全边界

- 只会关闭「左侧 = pi 改动前快照」的标签；
- 不强行执行：超过 30 秒的陈旧请求直接忽略；请求 / 确认文件定期清理；
- VS Code 侧缺失时，pi 侧会如实报告，不静默失败。

## 开发

- pi 侧源码：`diff-view-pie/diff-view.ts` —— 用 `./install.sh` 部署（部署副本在 `~/.pi/agent/extensions/diff-view.ts`，勿直接改副本）；
- VS Code 侧源码：`diff-view-vsce/` —— `npm run check` 做全部 JS 语法检查；
- 运行时状态（两侧共享的协议目录）：`~/.pi/agent/state/ai-edit-diff/` —— 名字为兼容而保留，它是两个组件之间的协议契约。

## 版权与署名

Copyright (c) 2026 All Contributors。基于 [MIT License](LICENSE.md) 发布。

署名：使用或引用本项目时，请保留版权声明并注明来源：[diff-view](https://github.com/xhqing/diff-view)。
