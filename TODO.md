# TODO

本仓库的活跃待办。已处理的条目移入 [TODO-archive.md](TODO-archive.md)；超低频备忘放 [MEMO.md](MEMO.md)。

## 🟡 黄色（不影响正确性的优化、覆盖缺口）

- [ ] **T1** cmux 的面板内 source 切换补齐 last-turn 后，去掉 README「已知边界」里的绕过说明（记录：2026-11-06 16:53）
  **背景**：cmux 的 diff sidecar（`Native/DiffSidecar/src/protocol.rs`）的 `DiffSource` 只有 patch / unstaged / staged / branch 四种，`CLI/CMUXCLI+DiffSidecar.swift` 的 `diffSessionSourcePayload` 对 `.lastTurn` 返回 nil。结果是面板里点「Last turn」只会重读当前 patch：标签不变、内容不变、页面一直转圈。本扩展在「打开面板时」指定 source，不经过这条路径，因此不受影响。
  **要做什么**：在自己维护的 cmux 分叉里补齐 sidecar 的 last-turn 支持；修好后，可考虑让 `/open-diff` 支持在已有面板里切 source（现在是每次重开一个面板）。

## 🟢 绿色（计划类新功能）

- [ ] **T2** 透传分支基线：`/open-diff branch --base <ref>`（记录：2026-11-05 22:40）
  **背景**：`cmux diff --base <ref>` 能覆盖 branch 来源的基线分支（默认由 cmux 自己挑），本扩展目前没有把这个参数暴露出来。
