# Changelog

All notable changes to this project will be documented in this file.

## [未发布]

### 注销（2026-10-31 用户决定，功能停用）

- **为什么**：用户认为需要看 diff 时，用 `add-mode` / `commit-mode` 暂停自动提交即可（改动保留在工作区，直接 `git diff` / `git diff --cached`），不再需要专门的快照工具。原先每步 AI 编辑都要留快照，状态目录累计约 925MB。
- **做了什么**：卸载两个扩展（`~/.pi/agent/extensions/diff-view.ts` 与 VSCode 扩展 `xhqing.diff-view-vsce`），清理 `~/.pi/agent/state/ai-edit-diff` 快照目录；README 顶部加注销说明（中英双语）。项目代码与 GitHub 仓库保留作存档，不再维护。不涉版本号（不发版）。
- **能力差异**（如实记录）：暂停自动提交后看到的是 `git diff` 的累计改动（相对暂存区或 HEAD）；原工具能逐步回看每次 AI 编辑的前后快照。需要逐步历史时用 `git log -p` 或分段提交。

### 变更（`.pi` 由软链接改为真实目录 + 资源引用：全局规矩 2026-10-30 修订）

- **为什么改**：2026-10-30 用户修订了子项目的智能体专属文件规则。旧形态把 `.pi` 整个挂成指向负责 Agent 的软链接，「共享」与「独占」被压在同一个符号上：子项目要放自己的配置时无处安放，硬写进 `.pi` 等于直接写进 Kit 的 Agent 项目——会瞬间影响全部兄弟子项目、并进 Agent 仓库的 git 历史。新规则分层：身份层（`AGENTS.md`）继续保持软链接一致（pi 的上下文文件没有 include 机制，超集只能靠复制、复制必然漂移）；能力层（`.pi/`）改在子项目里建真实目录，用 `settings.json` 以**路径引用** Agent 项目的资源目录，本地专属内容放自己的目录——行为上是超集，结构上无副本、不漂移。
- **改了什么**：删除 `.pi` 软链接（原指向 `../ExecutiveAssistantAgent/.pi`），改为真实目录加 `.pi/settings.json`：`extensions` / `skills` / `prompts` / `themes` 四组各指向 `~/Developer/ExecutiveAssistantAgent/.pi/` 下对应目录，并附带本地 `./extensions` / `./skills` / `./prompts` / `./themes`（本地目录不存在时自动跳过）。`AGENTS.md` 软链接保持不变。本项仅涉及开发环境配置，**不影响扩展功能与 vsix 产物**，不涉版本号。
- **验证**：据 pi 官方文档（`settings.md`「Resources」、`skills.md` / `extensions.md`）；同批在 `xhqing` 子项目实跑 `pi --approve -p`，技能与项目级扩展均从 Agent 项目加载成功。
- **规则出处**：全局 `~/.pi/agent/docs/agents-registry.md`「智能体专属文件归属与子项目映射（2026-10-30 修订）」节。

## [0.2.1] - 2026-10-20

### Added

- VS Code 扩展图标：`diff-view-vsce/icon.png`（512×512 圆角方形、indigo 渐变、双窗格 + 跨桥弧线——与项目 logo 同一套符号）；`package.json` 的 `icon` 字段指向它，扩展详情页 / 列表不再显示默认占位图。

### Fixed

- CI workflow YAML 语法错误修复：步骤名里的冒号未加引号，导致 GitHub Actions 无法解析、启动即失败（0 秒失败、无任务）；已加本地 YAML 校验并推送后验证 CI 运行。

## [0.2.0] - 2026-10-19

### Changed

- **整合为 diff-view 项目（两个组件、一次安装）**：2026-10-18 用户决定——pi 侧与 VSCode 侧本是一个功能，应放同一个项目。原 `diff-bridge` 拆为两个组件：
  - `diff-view-pie/`：pi 侧扩展（源 `diff-view.ts`，部署到 `~/.pi/agent/extensions/`）；
  - `diff-view-vsce/`：VS Code 侧扩展（原项目主体代码迁入；扩展身份 `xhqing.diff-bridge` → `xhqing.diff-view-vsce`，名称 / 显示名 / 命令 id / 输出渠道 / 状态栏文案同步更新）。
- 新增 `install.sh`：一次安装两个组件（pi 侧拷贝部署 + VS Code 侧打包安装，含旧 `xhqing.diff-bridge` 卸载）；README 双语重写，说明两个组件各自职责、都必须安装、协作机制与排障。
- logo 更名为 `diff-view`（双窗格 + 跨桥弧线不变）；版本号 0.1.0 → 0.2.0。
- 内部管道不变（有意）：状态目录 `~/.pi/agent/state/ai-edit-diff/` 与环境变量 `AI_EDIT_DIFF_*` 保持原名——两个组件与旧版本会话都指向它们，改名会打断请求 / 确认协议。

### Added

- `build.sh`：产出**唯一**发布产物 `dist/diff-view-<version>.zip`——内含 `diff-view-vsce-<version>.vsix`（VS Code 侧）与 `diff-view.ts`（pi 侧），两个组件共用项目 `VERSION` 版本号（构建前校验与 `package.json` 一致）；`install.sh` 改为基于该产物安装 VS Code 侧。
- `.github/workflows/ci.yml`：JS 语法检查、shell 语法检查、版本号一致性（`VERSION` ↔ `package.json` / CHANGELOG / README 徽章）、产物构建冒烟（校验 zip 内含两个组件）。
- 开源到 GitHub：公开仓库 `xhqing/diff-view`（README 与 vsix 元数据里的地址自此生效）；发布 `v0.2.0`，产物为上述 zip。

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
