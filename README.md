<div align="center">
  <img src="assets/logo.svg" alt="diff-bridge" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-0.1.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-VSCode%20Extension-0078D4)](#)

  [简体中文](README_cn.md)
</div>

# diff-bridge

> The VS Code companion for pi's "change visualizer": close pi-opened diff tabs **silently** with a single pi command.

Works together with the global pi extension [`diff-view`](../../../.pi/agent/extensions/diff-view.ts) (formerly `ai-edit-diff`): type `/close-diff` in pi (or ask the agent to call the `close_diff` tool) and the diff views pi opened in VS Code are closed silently.

## Why this exists

VS Code offers **no official way to close tabs from outside**:

- the `code` CLI has no editor-closing subcommand;
- AppleScript cannot query VS Code windows (tested: `-1728 Can't get name of every window`);
- UI scripting (synthetic key presses / clicks) steals screen focus and is fragile.

So the two sides speak a **request-file + ack-file** protocol instead: pi only writes a request; the actual closing is performed *inside* VS Code by this extension — no focus stealing, no interruption.

## How it works

- The pi side (`diff-view` extension, formerly `ai-edit-diff`) writes requests under `~/.pi/agent/state/ai-edit-diff/`:
  - `close-requests/<id>.json`: `{id, ts, paths}`; an empty `paths` array means "close every pi-opened diff", otherwise only those files;
  - it then waits for acks in `close-acks/<id>-*.json` (one per VS Code window, carrying the closed count) for up to 2 seconds and reports the summary to the user.
- This extension polls the request directory **inside every VS Code window** once per second: it only handles requests written within the last 30 seconds (so stale requests can't close tabs that were opened later), writes an ack when done, and garbage-collects expired requests and acks.
- **It only closes diff tabs whose left side is a pi "before" snapshot** (a file under `state/ai-edit-diff/snapshots/`) — diffs you opened yourself and normal editors are never touched; closing uses `preserveFocus`, so focus is not stolen.

## Install

Build and install locally (not yet published to the Marketplace):

```bash
vsce package --allow-missing-repository
code --install-extension diff-bridge-0.1.0.vsix
```

After installing or updating, **reload the VS Code window** (Command Palette → `Developer: Reload Window`, or just reopen it later) for the extension to activate.

## Usage

- In pi, type `/close-diff` to close every pi-opened diff; `/close-diff <path>` closes only that file's diff.
- In VS Code, search `Diff Bridge` in the Command Palette to run "close all pi-opened diff tabs" manually.
- Troubleshooting: Command Palette → `Output: Focus on Output View`, pick the `diff-bridge` channel for logs.

## Uninstall

```bash
code --uninstall-extension xhqing.diff-bridge
```

(Without the extension, pi's `/close-diff` will honestly report "no window responded"; nothing else breaks.)

## Development

- Pure logic (path checks / request parsing) lives in `lib/util.js`;
- throwaway verification scripts live in `tmp/` (not committed); the project's real test cases are authored by the Test Agent (Hopper);
- self-check: `npm run check` (syntax check for every JS file).

## License & Attribution

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).

Attribution: if you use or reference this project, please keep the copyright notice and credit the source: [diff-bridge](https://github.com/xhqing/diff-bridge).
