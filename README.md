<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.2.1-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20%2B%20VS%20Code-6E56CF)](#)

  [简体中文](README_cn.md)
</div>

# diff-view

> A git-independent file diff viewer spanning pi and VS Code — two extensions, one feature.

**diff-view consists of two extensions. Both must be installed for the complete feature:**

| Extension | Installs into | What it does |
|---|---|---|
| `diff-view-pie` | pi (global extension: `~/.pi/agent/extensions/`) | Registers the diff tools and commands inside pi: `open_diff` / `close_diff`, `/open-diff` / `/close-diff`, plus cross-session change notifications. |
| `diff-view-vsce` | VS Code (VSIX) | Does the VS Code-side work: silently closes the diff tabs pi opened (VS Code offers no official way to close tabs from outside). |

Why two halves: pi can *open* diff views and wants to *close* them on demand, but VS Code provides no official way to close a tab from outside the editor (no CLI subcommand, AppleScript cannot query windows, UI scripting would steal focus). So the two sides talk over a small request-file / ack-file protocol — see [How it works](#how-it-works).

With only one half installed:

- pi side only → `/open-diff` works, but `/close-diff` honestly reports "no window responded" (nothing can close the tabs);
- VS Code side only → nothing drives it; there are no diffs to close.

## Install

```bash
./install.sh
```

The script installs both halves; then:

- pi side: takes effect in new sessions (or run `/reload` in a running session);
- VS Code side: **reload your VS Code windows** (Command Palette → `Developer: Reload Window`) so the new extension activates.

Manual install:

1. **pi side** — copy `diff-view-pie/diff-view.ts` into `~/.pi/agent/extensions/`;
2. **VS Code side** — run `./build.sh`, unzip `dist/diff-view-<version>.zip`, then `code --install-extension diff-view-vsce-<version>.vsix --force` (uninstall the legacy `xhqing.diff-bridge` first if you still have it).

Prefer a released build? Download `diff-view-<version>.zip` from the [latest release](https://github.com/xhqing/diff-view/releases) and install its two halves the same way.

## Build & release artifacts

```bash
./build.sh
```

produces the single release artifact in `dist/`, versioned with the project version (`VERSION` is the single source of truth — both halves share it):

- `dist/diff-view-<version>.zip`, containing:
  - `diff-view-vsce-<version>.vsix` — the VS Code side (install with `code --install-extension <vsix> --force`);
  - `diff-view.ts` — the pi side (copy into `~/.pi/agent/extensions/`).

Installing from the artifact is the same two-step requirement: install both halves. Released builds are attached to [GitHub Releases](https://github.com/xhqing/diff-view/releases).

## Usage

- In pi:
  - `/open-diff` (or the `open_diff` tool) — open a diff view (left: the "before" snapshot, right: current content);
  - `/close-diff` closes every pi-opened diff; `/close-diff <path>` closes only that file's (or use the `close_diff` tool).
- In VS Code: Command Palette → `diff-view-vsce: 关闭全部由 pi 打开的 diff 标签` (manual fallback); logs are in the `diff-view-vsce` output channel.

## How it works

- the pi side registers a "before" snapshot whenever a tracked file changes, and can open a diff view on demand;
- to close views, the pi side writes a request file under `~/.pi/agent/state/ai-edit-diff/close-requests/`;
- `diff-view-vsce` polls that directory inside every VS Code window (once per second) and closes only diff tabs **whose left side is a pi snapshot** — your own diff views and normal editors are never touched; closing uses `preserveFocus`, so your focus is not stolen;
- every window writes an ack back (`close-acks/`); the pi side summarizes the result for you.

## Safety boundaries

- only tabs whose left side is a pi "before" snapshot are ever closed;
- nothing is forced: stale requests (older than 30 s) are ignored, and request / ack files are garbage-collected;
- if the VS Code side is missing, the pi side says so honestly instead of failing silently.

## Development

- pi side source: `diff-view-pie/diff-view.ts` — deploy with `./install.sh` (the deployed copy lives at `~/.pi/agent/extensions/diff-view.ts`; do not edit that copy);
- VS Code side source: `diff-view-vsce/` — `npm run check` syntax-checks every JS file;
- runtime state (shared protocol directory): `~/.pi/agent/state/ai-edit-diff/` — the name is kept for compatibility; it is the protocol contract between the two halves.

## License & Attribution

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).

Attribution: if you use or reference this project, please keep the copyright notice and credit the source: [diff-view](https://github.com/xhqing/diff-view).
