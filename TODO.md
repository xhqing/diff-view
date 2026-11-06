# TODO

本仓库的活跃待办。已处理的条目移入 [TODO-archive.md](TODO-archive.md)；超低频备忘放 [MEMO.md](MEMO.md)。

## 🟡 黄色（不影响正确性的优化、覆盖缺口）

- [ ] **T1** 上游 cmux 修好面板内 source 切换后，去掉 README「已知边界」里的绕过说明（记录：2026-11-05 22:40）
  **背景**：cmux 的 diff sidecar（`Native/DiffSidecar/src/protocol.rs`）的 `DiffSource` 只有 patch / unstaged / staged / branch 四种，`CLI/CMUXCLI+DiffSidecar.swift` 的 `diffSessionSourcePayload` 对 `.lastTurn` 返回 nil。结果是面板里点「Last turn」只会重读当前 patch：标签不变、内容不变、页面一直转圈。本扩展在「打开面板时」指定 source，不经过这条路径，因此不受影响。
  **要做什么**：与上游对齐（提 issue 或跟进修复）；上游修好后，可考虑让 `/open-diff` 支持在已有面板里切 source（现在是每次重开一个面板）。

- [ ] **T3** 上游 cmux 修好 Dock 路由冲突后，去掉 `/open-diff` 的降级重试（记录：2026-11-06 15:55）
  **背景**：`CLI/cmux_open.swift` 的 `runDiffCommand` 把 `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` 同时作为 `workspace_id` / `surface_id` 传给 `browser.open_split`；服务端的 `v2DockBrowserSelectorsConflict`（`Sources/TerminalController+WindowDockBrowserRouting.swift`）在两者指向不同 Dock 归属时直接回 `invalid_params`，`last-turn` 因此完全打不开面板。本扩展现用「去掉选择器 + 退到 unstaged」绕过，代价是多窗口时面板可能开错窗口、且看不了 last-turn。
  **要做什么**：在 cmux CLI 侧把「diff 内容来源的 workspace / surface 上下文」与「面板打开的路由选择器」解耦（优先用 surface_id 这类更具体的选择器，不要同时注入 workspace_id）；修好后删掉扩展里的降级分支，同步更新 README「已知边界」与 CHANGELOG。

## 🟢 绿色（计划类新功能）

- [ ] **T2** 透传分支基线：`/open-diff branch --base <ref>`（记录：2026-11-05 22:40）
  **背景**：`cmux diff --base <ref>` 能覆盖 branch 来源的基线分支（默认由 cmux 自己挑），本扩展目前没有把这个参数暴露出来。
