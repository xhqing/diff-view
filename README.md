<div align="center">
  <img src="assets/logo.svg" alt="diff-view" width="640">

  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE.md)
  [![Version](https://img.shields.io/badge/Version-1.3.0-blue)](CHANGELOG.md)
  [![Type](https://img.shields.io/badge/Type-pi%20extension-6E56CF)](#)
  [![Platform](https://img.shields.io/badge/Platform-cmux-000000)](#)

  [简体中文](README_cn.md)
</div>

# diff-view

> Two independent ways to see what the agent changed: a cmux diff panel (`/open-diff` / `/close-diff`), or a diff report appended to the pi session itself (`/diff-report`, pure git, no external app).

This is a pi extension. It does **not** render diffs itself — cmux (a Ghostty-based terminal) already ships a diff viewer: `cmux diff` turns a git diff into a panel, and `cmux close-surface` closes it. This extension just wraps those into two convenient commands and remembers which panels it opened, so closing is precise and never touches anything else.

## Why

- **Panel mode** (`/open-diff`): with the cursor in a pi session, typing it is the fastest way to see what the agent just changed — no window switching, no remembering `cmux diff` flags.
- **Inline report** (`/diff-report`): a card appended to the session after every turn with the files and line counts this turn touched. Pure git, no cmux, no external app, and it stays out of the LLM context so it costs no tokens.
- The agent can call the `open_diff` / `close_diff` tools to show you its changes and clean up afterwards.
- Closing only ever targets panels this extension registered. Your own diff panels, terminals, and everything else are left alone.

## Install

```bash
./install.sh
```

The script copies `diff-view.ts` to `~/.pi/agent/extensions/diff-view.ts`. New sessions pick it up automatically; run `/reload` in sessions that are already open.

Requires macOS and a running cmux (panels are rendered by cmux; the extension is only the command layer). To uninstall, delete that file.

Pi sessions that were not started inside cmux (Ghostty, for example) work too: the extension looks for the CLI bundled in `cmux*.app` under `/Applications` and `~/Applications`, then walks the socket markers in `~/Library/Application Support/cmux/*-last-socket-path` to find the listener. One setting still has to be on your side -- cmux defaults `automation.socketControlMode` to `cmuxOnly`, which only accepts processes cmux started. Set it to `automation` (any local process of the same macOS user may connect) to drive cmux from another terminal; on a shared machine keep it at `cmuxOnly` and run pi inside cmux.

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

/diff-report                paste the previous turn's changes (turn diff) into the session
/diff-report head           show everything uncommitted vs HEAD instead
/diff-report patch          paste the turn's unified diff
/diff-report on             also paste it automatically at the end of every turn (default: off)
/diff-report off            stop that
```

### Command line (no pi involved)

```bash
diff-report                 the previous turn's changes for the repo you are in
diff-report --repo ~/x      same for another repo
diff-report --all           one line per repo that has a turn report
diff-report --patch         also print that turn's unified diff
diff-report --turn 2        one turn further back (1 = the latest)
diff-report --json          machine-readable output
diff-report --since         recompute "turn baseline -> now" (when files changed after the turn)
```

Each repo keeps its last 20 turns together with each turn's unified diff (capped at 80 KB per turn), so looking at an older one with `--turn` works too, and a turn that changed nothing no longer wipes the previous report.

`install.sh` copies the CLI to `~/.local/bin/diff-report`. It only reads the report the extension persisted, so it never starts a pi session, never touches a turn, and works in any terminal.

The four sources:

| Source | What it shows | When available |
|---|---|---|
| `last-turn` | Changes since the baseline cmux recorded at prompt submit (`git stash create` + untracked snapshots) | When cmux's pi hook recorded a baseline for this session |
| `unstaged` | Everything in the working tree vs HEAD | Always (default fallback) |
| `staged` | Staged changes vs HEAD | Always |
| `branch` | Current branch vs its base branch | Always (cmux picks the base) |

The report is always **turn diff**: baseline taken when your prompt was submitted, compared with the state when the turn ended. Nothing is pasted by default; ask for it with `/diff-report` or the `diff-report` CLI. `/diff-report head` is the only cumulative view (everything uncommitted vs HEAD). The extension persists each turn's baseline and result under `~/.pi/agent/state/cmux-diff/`, which is what the CLI reads.

The inline report is a custom session entry: it is written to the session file and rendered in the transcript, never sent to the model. It shows per-file status letters (A / M / D / R) and `+/-` counts, capped at 8 files until you expand it; a turn with no file changes prints nothing. Turn it off with `/diff-report off`, which persists in `~/.pi/agent/state/cmux-diff/settings.json`.

On the agent side there are two matching tools: `open_diff` (`source` / `path`, **does not steal focus**) and `close_diff` (`path` / `all`). Typing a slash command focuses the panel because you asked for it; tool calls do not, because the agent did.

## How it works

1. `/open-diff` resolves the repository root and the diff source.
2. It runs `cmux diff --<source> --cwd <repo>` (adding `--no-focus` for tool calls).
3. It reads the panel reference from the output (`OK surface=surface:... pane=...`) and records it in `~/.pi/agent/state/cmux-diff/opened.json`.
4. `/close-diff` walks that record and runs `cmux close-surface --surface <ref>` for each panel. Panels you already closed by hand (`Surface ref not found`) count as closed and get pruned.

cmux's socket path can move around (environment variables go stale after an app restart): the extension resolves it normally first, then retries with candidates from `CMUX_SOCKET` / `CMUX_SOCKET_PATH` and `~/Library/Application Support/cmux/*-last-socket-path`.

## Known limits

- **The panel needs cmux; the inline report does not**: `/open-diff` / `/close-diff` only work while cmux is running. From a terminal that was not launched by cmux, cmux has to allow it first: the automation socket defaults to `cmuxOnly` and rejects outside processes with `Access denied`. Set `automation.socketControlMode` to `automation`, and the extension names that remedy in the error when the denial happens.
- **Switching sources inside the panel is a cmux upstream bug**: the in-panel source switcher does not really recompute on "Last turn" (its sidecar does not support last-turn as a switchable source); it keeps the old content and spins forever. To view last-turn changes, open a fresh panel with `/open-diff last-turn`.
- **last-turn needs a baseline**: cmux matches baselines on repository + workspace + surface + session. When any of those miss, `/open-diff` falls back to `unstaged` and says so.
- **Window routing conflicts**: the root cause is fixed in the cmux CLI source we maintain (caller environment is no longer injected into panel routing). With a cmux build that contains the fix, `/open-diff` can use `last-turn` directly. For an older app that has not been updated yet, the extension keeps a minimal compatibility path: on `Conflicting Dock routing selectors` (or a related socket drop) it retries without the two environment variables and temporarily falls back from `last-turn` to `unstaged`, which it says in the prompt. The extension does not read or write any temporary directory. On retry the panel opens in cmux's default window, which with several windows open may not be the window the command came from.
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
