# TODO 归档

本文件收录已处理的待办条目（已完成 / 已更新 / 已放弃 / 已转移）。活跃待办见 [TODO.md](TODO.md)。


## 已放弃

- [ ] **T1** cmux 的面板内 source 切换补齐 last-turn 后，去掉 README「已知边界」里的绕过说明（记录：2026-11-06 16:53）

  ✅**已放弃**（2026-11-07）
  **理由**：项目范围收敛为「只做本轮 diff」，cmux 面板能力整块移除（仓库更名为 turn-diff），这条待办失去对象。

- [ ] **T2** 透传分支基线：`/open-diff branch --base <ref>`（记录：2026-11-05 22:40）

  ✅**已放弃**（2026-11-07）
  **理由**：同上——面板与 branch 来源已随范围收敛移除。

## 已完成

- [ ] **T3** 上游 cmux 修好 Dock 路由冲突后，去掉 `/open-diff` 的降级重试（记录：2026-11-06 15:55）
  **背景**：`CLI/cmux_open.swift` 的 `runDiffCommand` 把 `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 同时作为 `workspace_id` / `surface_id` 传给 `browser.open_split`；服务端的 `v2DockBrowserSelectorsConflict`（`Sources/TerminalController+WindowDockBrowserRouting.swift`）在两者指向不同 Dock 归属时直接回 `invalid_params`，`last-turn` 因此完全打不开面板。本扩展现用「去掉选择器 + 退到 unstaged」绕过，代价是多窗口时面板可能开错窗口、且看不了 last-turn。
  **要做什么**：在 cmux CLI 侧把「diff 内容来源的 workspace / surface 上下文」与「面板打开的路由选择器」解耦（优先用 surface_id 这类更具体的选择器，不要同时注入 workspace_id）；修好后删掉扩展里的降级分支，同步更新 README「已知边界」与 CHANGELOG。

  ✅**已完成**（完成：2026-11-06 16:53）
  **实际处理**：没有等 cmux 改版（cmux 是我们自己维护的分叉，而且当前运行的 app 也换不了 CLI 二进制）。改为在 diff-view 内自足解决：cmux 在拒绝打开面板之前已经把本轮 patch 算好并落盘，扩展捡回这个 patch、去掉冲突的两个选择器重开面板，`last-turn` 的来源与内容都保留；拿不到 patch 才退到 unstaged 兜底。CHANGELOG 与双语 README 已同步，1.0.1 的降级不再是主路径。

  ✅**已更新**（更新：2026-11-06 17:19）
  **最新决定**：用户指出 `/tmp` 是随时会被清理的临时目录，而且 cmux 是我们自己的项目，不该绕弯写 patch。上一段的 patch 重放方案已整体撤回：根因改在 `xhqing/cmux` 的 `CLI/cmux_open.swift` 里直接修复（PR #20，不再把 caller context 注入面板路由），diff-view 删掉全部临时目录读写，只保留旧版 app 的极简兼容降级。本条仍为已完成，处理方式以本段为准。
