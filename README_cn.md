<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-1.0.2-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-cmux-000000)](#)

  [English](README.md)
</div>

# diff-view

> 在 cmux 里用两条斜杠命令看 diff：`/open-diff` 打开，`/close-diff` 关闭。

这是 pi 的一个扩展。它自己**不渲染 diff**——cmux（基于 Ghostty 的终端应用）自带 diff viewer，`cmux diff` 能把 git 改动直接渲染成面板，`cmux close-surface` 能把面板关掉。本扩展只负责把它们包成顺手的两条命令，并记住「哪些面板是自己开的」，好让关闭动作精确、不误伤。

## 为什么需要它

- 光标停在 pi 会话里时，想快速看一眼「AI 刚才改了什么」，敲 `/open-diff` 就行，不用切窗口、不用记 `cmux diff` 的参数；
- AI 也能调用 `open_diff` / `close_diff` 两个工具，在需要给你看改动时自己开、看完自己关；
- 关闭只针对本扩展登记过的面板，用户自己开的 diff、普通终端、其它面板一律不碰。

## 安装

```bash
./install.sh
```

脚本把 `diff-view.ts` 拷到 `~/.pi/agent/extensions/diff-view.ts`。新会话自动生效；已经打开的 pi 会话执行 `/reload`。

要求：macOS + cmux 正在运行（面板由 cmux 渲染，扩展只是命令层）。卸载删掉那个文件即可。

## 用法

```
/open-diff                  打开当前仓库的 diff（有 last-turn 基线就用 last turn，否则 unstaged）
/open-diff last-turn        只看这一轮 AI 改动
/open-diff unstaged         工作区相对 HEAD 的全部改动
/open-diff staged           暂存区相对 HEAD 的改动
/open-diff branch           当前分支相对基线的改动
/open-diff ~/Developer/x    打开指定仓库的 diff

/close-diff                 关闭本会话打开的面板
/close-diff --all           关闭所有会话打开的面板
/close-diff ~/Developer/x   只关该仓库的面板
```

四个来源的差别：

| 来源 | 看的是什么 | 何时可用 |
|---|---|---|
| `last-turn` | 这一轮 agent 提示词提交之前的基线（`git stash create` + untracked 快照）到现在 | cmux 的 pi hook 记录过当前会话的基线 |
| `unstaged` | 工作区相对 HEAD 的全部改动 | 始终可用（默认后备） |
| `staged` | 暂存区相对 HEAD 的改动 | 始终可用 |
| `branch` | 当前分支相对基线分支的改动 | 始终可用（基线由 cmux 自己挑） |

AI 侧对应两个工具：`open_diff`（参数 `source` / `path`，**不抢焦点**）和 `close_diff`（参数 `path` / `all`）。你手敲斜杠命令时会切到面板，AI 调工具时不会——抢不抢焦点按「谁发起的」区分。

## 工作原理

1. `/open-diff` 解析出仓库根和来源；
2. 调 `cmux diff --<source> --cwd <仓库>`（AI 调用时加 `--no-focus`）；
3. 从输出里取面板引用（`OK surface=surface:... pane=...`），记进 `~/.pi/agent/state/cmux-diff/opened.json`；
4. `/close-diff` 读这份登记，逐个 `cmux close-surface --surface <ref>`；面板若已被你手动关掉（`Surface ref not found`）按已关闭处理，顺便清理登记。

cmux 的 socket 路径偶有变化（app 重启后环境变量可能过期）：扩展先用默认解析，失败再拿 `CMUX_SOCKET` / `CMUX_SOCKET_PATH` 和 `~/Library/Application Support/cmux/*-last-socket-path` 里的候选路径重试。

## 已知边界

- **只服务 cmux**：不在 cmux 里跑（app 没开、或终端不是从 cmux 启动）时会直接报错，不会假装成功。
- **面板内切 source 是 cmux 上游的坑**：cmux 的 diff 面板里有个 source 切换器，点「Last turn」不会真正重算（其 sidecar 不支持 last-turn 作为可切换来源），只会停在原内容并一直转圈。要看 last-turn，请用 `/open-diff last-turn` 重新开一个面板，不要在旧面板里切。
- **last-turn 依赖基线**：基线按「仓库 + workspace + surface + 会话」四条匹配，任何一条对不上就拿不到内容。这时 `/open-diff` 会自动退回 `unstaged` 并告诉你原因。
- **窗口路由冲突会自动重开，不改来源**：`cmux diff` 会同时用 `CMUX_WORKSPACE_ID`、`CMUX_SURFACE_ID` 定位面板；当终端在 Dock 里、或这两个值与当前窗口对不上时，cmux 会报 `Conflicting Dock routing selectors` 并拒绝打开面板（有时还会直接断开 socket）。但 cmux 在拒绝之前已经把本轮 patch 算好并落盘，扩展会捡回这个 patch、去掉两个选择器重新打开，来源和内容都不变；只有拿不到 patch 时才退到 `unstaged` 并在提示里写明。重开时面板落在 cmux 的默认窗口，开了多个窗口时可能不是发起命令的那个窗口。
- **不记录历史快照**：原 VSCode 版会给每次文件编辑留「改动前快照」，可以逐步回放，代价是状态目录涨到约 925 MB。cmux 版直接复用 git 的 diff 能力，不落任何快照。

## 项目沿革

- 2026-10-11：作为「AI 改动可视化 + 跨会话变更通知」扩展建立（原名 `ai-edit-diff`）。
- 2026-10-18：整合为 `diff-view`（pi 侧 `diff-view-pie` + VS Code 侧 `diff-view-vsce`）。
- 2026-10-31：注销——改用 `add-mode` / `commit-mode` 暂停自动提交后直接 `git diff`，快照目录约 925 MB 也成了负担。
- 2026-11-05：改建为 cmux 版（1.0.0）——去掉快照与通知机制，只保留 `/open-diff` / `/close-diff` 的顺手体验，diff 内容交给 cmux 渲染。

## 开发

- 源文件：`diff-view.ts`（唯一实现，部署副本由 `install.sh` 拷贝，勿直接改副本）；
- 状态目录：`~/.pi/agent/state/cmux-diff/`（面板登记，删掉不影响功能，只是丢失关闭记录）；
- 语法自检：`node --experimental-strip-types --check` 与 pi 加载器口径一致，扩展写坏会让 pi 起不来。

## License

Copyright (c) 2026 All Contributors. 以 [MIT License](LICENSE.md) 发布。
