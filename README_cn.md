<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-1.1.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-cmux-000000)](#)

  [English](README.md)
</div>

# diff-view

> 两种互不依赖的看改动方式：cmux 面板（`/open-diff`、`/close-diff`），或者直接汇报在 pi 会话里（`/diff-report`，纯 git、不依赖任何外部软件）。

这是 pi 的一个扩展。它自己**不渲染 diff**——cmux（基于 Ghostty 的终端应用）自带 diff viewer，`cmux diff` 能把 git 改动直接渲染成面板，`cmux close-surface` 能把面板关掉。本扩展只负责把它们包成顺手的两条命令，并记住「哪些面板是自己开的」，好让关闭动作精确、不误伤。

## 为什么需要它

- **面板模式**（`/open-diff`）：光标停在 pi 会话里时，想快速看一眼「AI 刚才改了什么」，敲它就行，不用切窗口、不用记 `cmux diff` 的参数；
- **会话内汇报**（`/diff-report`）：每轮结束时在会话末尾追加一张卡片，列出这一轮改了哪些文件、加减多少行。纯 git，不需要 cmux，也不进 LLM 上下文、不耗 token。
- AI 也能调用 `open_diff` / `close_diff` 两个工具，在需要给你看改动时自己开、看完自己关；
- 关闭只针对本扩展登记过的面板，用户自己开的 diff、普通终端、其它面板一律不碰。

## 安装

```bash
./install.sh
```

脚本把 `diff-view.ts` 拷到 `~/.pi/agent/extensions/diff-view.ts`。新会话自动生效；已经打开的 pi 会话执行 `/reload`。

要求：macOS + cmux 正在运行（面板由 cmux 渲染，扩展只是命令层）。卸载删掉那个文件即可。

不在 cmux 里启动的 pi 会话（比如在 Ghostty 里跑）也能用：扩展会到 `/Applications` 与 `~/Applications` 下的 `cmux*.app` 里找 app 内置的 CLI，再遍历 `~/Library/Application Support/cmux/*-last-socket-path` 找正在监听的 socket。唯一还需要你配合的是 cmux 那边的一档设置——`automation.socketControlMode` 默认 `cmuxOnly`，只接受「cmux 自己启动的进程」；要在外部终端里驱动 cmux，把它设成 `automation`（同一 macOS 用户的本地进程都能连，等于本机任何同用户进程都能控制 cmux，个人机可接受、共用机器就别开）。

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

/diff-report                立刻汇报本轮改动
/diff-report off            关掉「每轮结束自动汇报」
/diff-report on             再打开（默认就是开）
```

四个来源的差别：

| 来源 | 看的是什么 | 何时可用 |
|---|---|---|
| `last-turn` | 这一轮 agent 提示词提交之前的基线（`git stash create` + untracked 快照）到现在 | cmux 的 pi hook 记录过当前会话的基线 |
| `unstaged` | 工作区相对 HEAD 的全部改动 | 始终可用（默认后备） |
| `staged` | 暂存区相对 HEAD 的改动 | 始终可用 |
| `branch` | 当前分支相对基线分支的改动 | 始终可用（基线由 cmux 自己挑） |

两种口径：**自动卡片**报「本轮增量」（基线 = 你提交提示词那一刻）；**手敲 `/diff-report`** 报「工作区相对 HEAD 的全部未提交改动」，本轮正在进行时才退回本轮增量——标题会写明是哪一种，空结果也区分「不是 git 仓库」与「工作区是干净的」。

会话内汇报是一张自定义 session entry：写进会话文件、在对话里渲染，永远不发给模型。它按文件列状态字母（A / M / D / R）与 `+/-` 行数，默认最多 8 个文件、展开看全部；本轮没有任何文件变化时不打印任何东西。`/diff-report off` 可关掉自动汇报（开关存在 `~/.pi/agent/state/cmux-diff/settings.json`）。

AI 侧对应两个工具：`open_diff`（参数 `source` / `path`，**不抢焦点**）和 `close_diff`（参数 `path` / `all`）。你手敲斜杠命令时会切到面板，AI 调工具时不会——抢不抢焦点按「谁发起的」区分。

## 工作原理

1. `/open-diff` 解析出仓库根和来源；
2. 调 `cmux diff --<source> --cwd <仓库>`（AI 调用时加 `--no-focus`）；
3. 从输出里取面板引用（`OK surface=surface:... pane=...`），记进 `~/.pi/agent/state/cmux-diff/opened.json`；
4. `/close-diff` 读这份登记，逐个 `cmux close-surface --surface <ref>`；面板若已被你手动关掉（`Surface ref not found`）按已关闭处理，顺便清理登记。

cmux 的 socket 路径偶有变化（app 重启后环境变量可能过期）：扩展先用默认解析，失败再拿 `CMUX_SOCKET` / `CMUX_SOCKET_PATH` 和 `~/Library/Application Support/cmux/*-last-socket-path` 里的候选路径重试。

## 已知边界

- **面板必须靠 cmux，会话内汇报不需要**：`/open-diff` / `/close-diff` 只在 cmux 在跑时可用。从不是 cmux 启动的终端里用时，还得 cmux 那边放行——自动化 socket 默认 `cmuxOnly`，外部进程会被拒（`Access denied`）；把 `automation.socketControlMode` 设成 `automation` 即可，扩展在报错里会写明这个原因和改法。
- **面板内切 source 是 cmux 上游的坑**：cmux 的 diff 面板里有个 source 切换器，点「Last turn」不会真正重算（其 sidecar 不支持 last-turn 作为可切换来源），只会停在原内容并一直转圈。要看 last-turn，请用 `/open-diff last-turn` 重新开一个面板，不要在旧面板里切。
- **last-turn 依赖基线**：基线按「仓库 + workspace + surface + 会话」四条匹配，任何一条对不上就拿不到内容。这时 `/open-diff` 会自动退回 `unstaged` 并告诉你原因。
- **窗口路由冲突**：根因已在自己维护的 cmux CLI 源码里修好（不再把环境变量注入面板路由），装上含该修复的 cmux 后，`/open-diff` 的 `last-turn` 直接可用。对尚未更新的旧版 app，扩展保留一段极简兼容：命中 `Conflicting Dock routing selectors`（或同类 socket 断连）时去掉两个环境变量重试，`last-turn` 暂时退到 `unstaged` 并在提示里写明。扩展不读写任何临时目录。重试时面板落在 cmux 的默认窗口，开了多个窗口时可能不是发起命令的那个窗口。
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
