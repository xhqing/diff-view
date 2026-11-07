# turn-diff 项目规则（Worker 追加）

你在 **turn-diff** 项目里干活。本文件由 pi 在会话启动时自动追加到系统提示，只写本项目特有的规矩；Agent 的通用身份与全局规则由 `AGENTS.md` 软链接提供，此处不重述。

## 你的角色

你是 Atlas（FullStackEngineerAgent）派来的 **Worker**，只负责当前 worktree 里的这一件事。

- 干完向 Leader 汇报：改了什么、验证结果、PR 号、遗留问题。
- **不碰 local main、不建 / 删 worktree**——那是 Leader 的活。

## 本项目是什么

一个 **pi 扩展 + 一个命令行工具**，只回答一个问题：「这一轮 AI 改了什么」。扩展在每轮开始时记 git 基线（`git stash create`），轮次结束时算增量并把统计 + unified diff 落盘；会话里用 `/turn-diff`、终端里用 `turn-diff` 读同一份状态。

- **范围纪律**：只做「本轮 diff」。不画面板、不调外部程序、**不提供和 HEAD / 分支对比的口径**——要看全部未提交改动就用 `git diff`，扩展和 CLI 都不管这件事。
- **用词统一**：会话里与命令行用同一套词——不带参数给摘要，`file` 给正文，`file 2` 看某个文件，`list` 列编号，数字看更早的轮次（`turn-diff 2 file 3`）。
- **文件**：`turn-diff.ts`（扩展本体）、`scripts/turn-diff`（命令行）、`install.sh`（部署两者）。
- **颜色**：新增行绿底、删除行红底，行内改动片段用更亮的底色；CLI 默认只在 TTY 上色。

## 🚨 安装会写共享目录

`./install.sh` 把 `turn-diff.ts` 复制到 **`~/.pi/agent/extensions/turn-diff.ts`**，并把命令行装到 `~/.local/bin/turn-diff`——那是全队共享的能力目录。

- 写它之前必须有一次新鲜的飞书快照（`python3 ~/.pi/agent/patch/dev-snapshots/dev-snapshots.py snapshot pi-agent`），否则会被 `snapshot-guard` 拦下。
- 安装完要跑 `node ~/.pi/agent/patch/ts-syntax-check/check.mjs` 确认扩展语法没问题——写好一个坏扩展会让**所有会话**启动失败（pi 加载扩展失败会直接退出）。
- 已开着的会话要 `/reload` 才生效，新会话自动加载。

## 硬约束

- **只经由 cmux CLI 操作面板**：`cmux diff` 开、`cmux close-surface` 关。不要自己实现 diff 渲染、不要写系统级窗口操作。
- **关闭只针对本扩展登记过的面板**：绝不按名字 / 序号盲目关，用户自己开的面板必须原样保留。这是本扩展存在的前提（README「Why」一节）。
- **`--no-focus` 类行为要保留**：打开面板不应抢走用户正在用 cmux 的焦点（具体参数名以当前 `cmux diff` 的 CLI 为准，改之前先 `cmux diff --help` 核对）。
- 单文件实现、零外部依赖（只用 pi 扩展 API + `cmux` CLI）。要加依赖先在汇报里说明理由。
- 版本号以 `VERSION` 为权威，与 `CHANGELOG.md` / README 徽章一致；不在功能分支 bump。
- 改动记 `CHANGELOG.md`，待办记 `TODO.md`；临时产物放 `tmp/`。

## 验证

- 改完在 cmux 里实测两条命令：`/open-diff` 能开、`/close-diff` 只关自己开的那个。
- 同时开一个**用户自己的** diff 面板，确认 `/close-diff` 不会误关它。
- 验证「本轮无改动」时命令给出的是明确提示而不是报错。

## 详细说明

`README.md` / `README_cn.md`（功能与安装）、`TODO.md`；通用工作规则见全局 `~/.pi/agent/AGENTS.md`。
