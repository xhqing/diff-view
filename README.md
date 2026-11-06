<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-1.0.1-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-cmux-000000)](#)

  [简体中文](README_cn.md)
</div>

# diff-view

> Look at diffs from inside cmux with two slash commands: `/open-diff` to open, `/close-diff` to close.

This is a pi extension. It does **not** render diffs itself — cmux (a Ghostty-based terminal) already ships a diff viewer: `cmux diff` turns a git diff into a panel, and `cmux close-surface` closes it. This extension just wraps those into two convenient commands and remembers which panels it opened, so closing is precise and never touches anything else.

## Why

- With the cursor in a pi session, typing `/open-diff` is the fastest way to see what the agent just changed — no window switching, no remembering `cmux diff` flags.
- The agent can call the `open_diff` / `close_diff` tools to show you its changes and clean up afterwards.
- Closing only ever targets panels this extension registered. Your own diff panels, terminals, and everything else are left alone.

## Install

```bash
./install.sh
```

The script copies `diff-view.ts` to `~/.pi/agent/extensions/diff-view.ts`. New sessions pick it up automatically; run `/reload` in sessions that are already open.

Requires macOS and a running cmux (panels are rendered by cmux; the extension is only the command layer). To uninstall, delete that file.

## Usage

```
/open-diff                  diff for the current repository (last turn when a baseline exists, otherwise unstaged)
/open-diff last-turn        only what this agent turn changed
/open-diff unstaged        everything in the working tree vs HEAD
/open-diff staged          staged changes vs HEAD
/open-diff branch          current branch vs its base
/open-diff ~/Developer/x   diff for a specific repository

/close-diff                 close panels opened by this session
/close-diff --all           close panels opened by any session
/close-diff ~/Developer/x   close only that repository's panels
```

The four sources:

| Source | What it shows | When available |
|---|---|---|
| `last-turn` | Changes since the baseline cmux recorded at prompt submit (`git stash create` + untracked snapshots) | When cmux's pi hook recorded a baseline for this session |
| `unstaged` | Everything in the working tree vs HEAD | Always (default fallback) |
| `staged` | Staged changes vs HEAD | Always |
| `branch` | Current branch vs its base branch | Always (cmux picks the base) |

On the agent side there are two matching tools: `open_diff` (`source` / `path`, **does not steal focus**) and `close_diff` (`path` / `all`). Typing a slash command focuses the panel because you asked for it; tool calls do not, because the agent did.

## How it works

1. `/open-diff` resolves the repository root and the diff source.
2. It runs `cmux diff --<source> --cwd <repo>` (adding `--no-focus` for tool calls).
3. It reads the panel reference from the output (`OK surface=surface:... pane=...`) and records it in `~/.pi/agent/state/cmux-diff/opened.json`.
4. `/close-diff` walks that record and runs `cmux close-surface --surface <ref>` for each panel. Panels you already closed by hand (`Surface ref not found`) count as closed and get pruned.

cmux's socket path can move around (environment variables go stale after an app restart): the extension resolves it normally first, then retries with candidates from `CMUX_SOCKET` / `CMUX_SOCKET_PATH` and `~/Library/Application Support/cmux/*-last-socket-path`.

## Known limits

- **cmux only**: outside cmux (app not running, or the terminal was not launched from it) the commands fail with a clear error instead of pretending to work.
- **Switching sources inside the panel is a cmux upstream bug**: the in-panel source switcher does not really recompute on "Last turn" (its sidecar does not support last-turn as a switchable source); it keeps the old content and spins forever. To view last-turn changes, open a fresh panel with `/open-diff last-turn`.
- **last-turn needs a baseline**: cmux matches baselines on repository + workspace + surface + session. When any of those miss, `/open-diff` falls back to `unstaged` and says so.
- **Window routing conflicts reopen the panel without changing the source**: `cmux diff` uses both `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` as panel routing selectors. When the terminal lives in a Dock, or those values no longer match the current window, cmux rejects the request with `Conflicting Dock routing selectors` (and sometimes drops the socket outright). cmux has already computed and saved this turn's patch before the rejection, so the extension picks that patch up and reopens the panel without the two selectors — source and content stay the same. Only when no patch can be found does it fall back to `unstaged`, which it says in the prompt. The reopened panel opens in cmux's default window, which with several windows open may not be the window the command came from.
- **No snapshot history**: the old VS Code edition kept a "before" snapshot for every file edit so you could replay step by step, at the cost of a state directory that grew to roughly 925 MB. The cmux edition reuses git's diff machinery and stores no snapshots.

## Project history

- 2026-10-11: started as an "AI edit visualization + cross-session change notification" extension (originally `ai-edit-diff`).
- 2026-10-18: consolidated into `diff-view` (pi side `diff-view-pie` + VS Code side `diff-view-vsce`).
- 2026-10-31: retired — pausing auto-commit with `add-mode` / `commit-mode` and running `git diff` covered the need, and the ~925 MB snapshot directory was a liability.
- 2026-11-05: rebuilt as the cmux edition (1.0.0) — snapshot and notification machinery dropped, only the `/open-diff` / `/close-diff` ergonomics kept, diff rendering delegated to cmux.

## Development

- Source: `diff-view.ts` (the only implementation; `install.sh` deploys a copy, never edit the deployed one).
- State: `~/.pi/agent/state/cmux-diff/` (panel registry; safe to delete, you only lose the close records).
- Syntax self-check: `node --experimental-strip-types --check`, matching pi's loader — a broken extension stops pi from starting.

## License

Copyright (c) 2026 All Contributors. Released under the [MIT License](LICENSE.md).
