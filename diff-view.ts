/**
 * diff-view.ts — 在 cmux 里按需打开 / 关闭 diff 面板（pi 扩展，cmux 版）。
 *
 * 这是什么：把「看 AI 改了什么」这件事做成两条斜杠命令——`/open-diff` 开一个 diff 面板，
 * `/close-diff` 把它关掉；另外注册 `open_diff` / `close_diff` 两个工具，让 AI 也能按需调用。
 *
 * 为什么是 cmux 版：cmux（终端应用）自带 diff viewer，`cmux diff` 能直接把 patch 渲染成
 * 面板，`cmux close-surface` 能把面板关掉。所以本扩展不再自己抓「改动前快照」，也不再需要
 * 编辑器那边的半身——它只负责两件事：拼命令、管记录。
 *
 * 历史：本扩展原先是「pi 扩展 + VSCode 扩展」两半的组合，靠快照目录 + 请求/确认文件协议
 * 协作（快照累计约 925MB）。2026-10-31 随 VSCode 工作流退场而注销；2026-11-05 按用户要求
 * 改建为 cmux 版：去掉快照与通知机制，改由 cmux 的 git diff / last-turn 基线出内容。
 *
 * 面板来源（source）：
 *   - last-turn：cmux 在每轮 agent 提示词提交时记的基线（`git stash create` + untracked 快照），
 *                看的是「这一轮 AI 改了什么」。需要 cmux 的 pi hook 记录过当前会话的基线。
 *   - unstaged ：工作区相对 HEAD 的全部改动（默认的安全选择，永远可用）。
 *   - staged   ：暂存区相对 HEAD 的改动。
 *   - branch   ：当前分支相对基线分支的改动（cmux 自己挑基线，可用 --base 覆盖）。
 *
 * 两条独立能力（2026-11-07 起）：
 *   1. 面板模式（依赖 cmux）：`/open-diff`、`/close-diff`，看完整 patch；
 *   2. 会话内汇报（纯 git，不依赖任何外部软件）：每轮开始记基线，轮次结束把
 *      「这一轮改了什么」作为一张卡片追加到会话末尾（不进 LLM 上下文、不耗 token）；
 *      随时可用 `/diff-report` 手动出一次，`/diff-report on|off` 切换自动汇报。
 *      面板要 cmux 在跑、socket 放行、且 last-turn 只对 cmux 里启动的 pi 有效；
 *      会话内汇报没有这些前提，代价是只给统计（文件 + 行数），不给 patch 正文。
 *
 * 部署：本文件是 diff-view 项目的 pi 扩展；安装脚本把副本拷到
 * ~/.pi/agent/extensions/diff-view.ts（勿直接改副本）。新会话自动生效，已开会话用 /reload。
 *
 * 窗口路由冲突：根因已在 cmux CLI 源码修复（不再把 caller context 注入面板路由）。
 * 对尚未更新的旧版 app，openDiff() 仍保留一段极简兼容：命中冲突时去掉两个选择器重试，
 * last-turn 暂时退到 unstaged；不再依赖任何临时 patch 文件
 *（详见 CHANGELOG 与 README「已知边界」）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { Type } from "typebox";
import { Box, Text } from "pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ===== 路径与常量 =====

/** 面板登记目录（跨会话共享，这样任何会话都能关掉自己或全部面板）。 */
const STATE_DIR = path.join(os.homedir(), ".pi/agent/state/cmux-diff");
/** 已打开面板的登记文件。 */
const OPENED_FILE = path.join(STATE_DIR, "opened.json");
/** cmux 的 agent 轮次基线库；用于判断 last-turn 是否真的能出内容。 */
const BASELINE_FILE = path.join(os.homedir(), ".cmuxterm/agent-turn-diff-baselines.json");

const SOURCES = ["last-turn", "unstaged", "staged", "branch"] as const;
type DiffSource = (typeof SOURCES)[number];

const SOURCE_LABELS: Record<DiffSource, string> = {
  "last-turn": "last turn（这一轮 AI 改动）",
  unstaged: "unstaged（未暂存改动）",
  staged: "staged（已暂存改动）",
  branch: "branch（分支改动）",
};

interface OpenedPanel {
  /** cmux 的 surface 引用，形如 surface:1000100014；关闭时用它精确定位。 */
  surface: string;
  /** 面板所在 workspace 的引用，仅用于展示。 */
  workspace?: string;
  /** 打开时的仓库根目录。 */
  cwd: string;
  source: DiffSource;
  /** 打开它的 pi 会话 id；`/close-diff` 默认只关自己开的。 */
  sessionId: string;
  openedAt: number;
}

// ===== 进程与 cmux 通道 =====

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  error?: string;
}

/** 跑一条命令，永不抛错；调用方只看 ok / stderr。env 可覆盖，用于去掉冲突的路由选择器。 */
function run(
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs = 30_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env },
      (error: any, stdout: string, stderr: string) => {
        const code = typeof error?.code === "number" ? error.code : error ? null : 0;
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code,
          error: error ? String(error.message ?? error) : undefined,
        });
      },
    );
  });
}

/**
 * 找出可用的 cmux 命令行。
 *
 * cmux 的 pi wrapper 会把 app 内置 CLI 的路径塞进 `CMUX_BUNDLED_CLI_PATH`；PATH 上的
 * `cmux` 通常指向同一个二进制。两者都试，先内置的（版本一定和宿主 app 一致）。
 */
function cmuxCandidates(): string[] {
  const list: string[] = [];
  const bundled = process.env.CMUX_BUNDLED_CLI_PATH;
  if (bundled && bundled.trim()) list.push(bundled.trim());
  list.push("cmux");
  // 不在 cmux 里启动时（比如在 Ghostty 里跑的 pi 会话），上面两个候选一个都没有：
  // `cmux` 一般不装进 PATH，CLI 只存在于 app 包内。这里扫 /Applications 与
  // ~/Applications 下的 cmux*.app，取 app 内置的 CLI；release / staging 并存时全收，
  // 由 runCmux 配 socket 逐个试，总能找到真在跑的那个实例。
  for (const dir of ["/Applications", path.join(os.homedir(), "Applications")]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!/^cmux.*\.app$/i.test(name)) continue;
        const cli = path.join(dir, name, "Contents/Resources/bin/cmux");
        if (fs.existsSync(cli)) list.push(cli);
      }
    } catch {
      // 目录不存在 / 无权限：跳过，靠其它候选
    }
  }
  return Array.from(new Set(list));
}

/** 收集可能可用的 socket 路径（cmux 重启后环境变量可能过期，这里只作重试用）。 */
function socketCandidates(): string[] {
  const list: string[] = [];
  for (const key of ["CMUX_SOCKET", "CMUX_SOCKET_PATH"]) {
    const value = process.env[key];
    if (value && value.trim()) list.push(value.trim());
  }
  try {
    const dir = path.join(os.homedir(), "Library/Application Support/cmux");
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith("-last-socket-path")) continue;
      try {
        const socketPath = fs.readFileSync(path.join(dir, name), "utf8").trim();
        if (socketPath) list.push(socketPath);
      } catch {
        // 读不到就跳过，不影响主流程
      }
    }
  } catch {
    // 目录不存在：说明这台机器没跑过 cmux，直接返回已收集的
  }
  return Array.from(new Set(list));
}

/**
 * 执行一条 cmux 子命令。
 *
 * 先用默认 socket 解析（cmux 会自己找最新的 marker 文件）；失败再拿候选 socket 逐个重试——
 * 覆盖「环境变量里的 socket 已随 app 重启失效」这种情况。
 */
async function runCmux(
  args: string[],
  cwd?: string,
  timeoutMs = 60_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  const sockets: (string | null)[] = [null, ...socketCandidates()];
  let last: RunResult | null = null;
  for (const command of cmuxCandidates()) {
    // 每条候选命令先按默认 socket 解析试一次（CLI 自己找最新的 marker 文件），
    // 不行再显式带上每个候选 socket 重试——外部终端里 app 内置的 CLI 与 marker
    // 文件不一定对得上，多组候选才能找到那个真在跑的实例。
    for (const socketPath of sockets) {
      const argv = socketPath ? ["--socket", socketPath, ...args] : args;
      const result = await run(command, argv, cwd, timeoutMs, env);
      if (result.ok) return result;
      last = result;
      // 命令本身不存在（ENOENT）：换下一个候选命令，不必再换 socket 重试
      if (result.code === null && /ENOENT/.test(result.error ?? "")) break;
    }
  }
  return last ?? { ok: false, stdout: "", stderr: "cmux 命令不可用", code: null };
}

/**
 * 这次失败该不该去掉路由选择器重试。
 *
 * cmux diff 会把 CMUX_WORKSPACE_ID 与 CMUX_SURFACE_ID 一起当成面板路由选择器交给
 * browser.open_split。当终端本身在 Dock 里、或这两个环境变量与当前窗口对不上时，服务端
 * 认为「两个选择器互相矛盾」，直接回 invalid_params，面板一个也开不出来；同一类异常请求
 * 有时也会把 socket 直接掐断（Broken pipe / Socket closed before reply），一并重试。
 * cmux CLI 源码修好后这段只会在旧版 app 上命中。
 */
function shouldRetryWithoutRouting(result: RunResult): boolean {
  const text = `${result.stderr}\n${result.error ?? ""}`;
  return (
    /Conflicting Dock routing selectors/i.test(text) ||
    /Broken pipe|Socket closed before reply|Failed to write to socket/i.test(text)
  );
}

/** 去掉会让 cmux Dock 路由判定互相矛盾的两个选择器。 */
function cleanRoutingEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CMUX_WORKSPACE_ID;
  delete env.CMUX_SURFACE_ID;
  return env;
}

/** cmux 是否在线：能列出窗口就说明 app 在跑、socket 通。 */
async function cmuxReachable(): Promise<{ ok: boolean; message: string }> {
  const result = await runCmux(["list-windows"], undefined, 15_000);
  if (result.ok) return { ok: true, message: "" };
  const detail = (result.stderr || result.error || "").trim().split("\n")[0];
  const denied = /Access denied|only processes started inside cmux/i.test(
    `${result.stderr}\n${result.error ?? ""}`,
  );
  return {
    ok: false,
    message:
      "连不上 cmux（app 没运行，或当前终端不被 cmux 接受）。\n" +
      `命令输出：${detail || "（无输出）"}` +
      (denied
        ? "\n原因：cmux 的自动化 socket 默认只允许 cmux 自己启动的进程连接（automation.socketControlMode = cmuxOnly）。" +
          "在外部终端（如 Ghostty）里用时，把 cmux 设置里的 automation.socketControlMode 改成 automation，" +
          "或者在 cmux 里启动 pi。"
        : ""),
  };
}

// ===== 仓库与 source 解析 =====

/** 解析符号链接；失败就返回原路径（不阻断主流程）。 */
function canonicalPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/** 把用户给的路径解析成绝对路径；不存在则返回 null。 */
function resolveExistingPath(raw: string | undefined, base: string): string | null {
  if (!raw || !raw.trim()) return base;
  const expanded = raw.trim().startsWith("~")
    ? path.join(os.homedir(), raw.trim().slice(1))
    : raw.trim();
  const absolute = path.resolve(base, expanded);
  try {
    return canonicalPath(fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute));
  } catch {
    return null;
  }
}

/** 找到 git 仓库根；不是仓库时返回 null（cmux diff 需要仓库）。 */
async function gitRoot(dir: string): Promise<string | null> {
  const result = await run("git", ["-C", dir, "rev-parse", "--show-toplevel"], dir, 10_000);
  if (!result.ok) return null;
  const root = result.stdout.trim().split("\n")[0];
  // macOS 上 /tmp 是 /private/tmp 的符号链接：统一成真实路径，关闭时才能按路径对上
  return root ? canonicalPath(root) : null;
}

/**
 * 当前会话是否真有 last-turn 基线。
 *
 * cmux 的基线按「仓库 + workspace + surface + 会话」四条一起匹配；任何一条对不上都拿不到
 * 内容（面板会显示 No last-turn changes to diff.）。这里先看一眼，避免用户敲了命令却开到
 * 一个空面板上。
 */
function hasLastTurnBaseline(sessionId: string): boolean {
  const workspaceId = (process.env.CMUX_WORKSPACE_ID ?? "").trim().toLowerCase();
  const surfaceId = (process.env.CMUX_SURFACE_ID ?? process.env.CMUX_PANEL_ID ?? "").trim().toLowerCase();
  const session = (sessionId ?? "").trim().toLowerCase();
  if (!workspaceId || !surfaceId || !session) return false;
  let records: any[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    records = Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {
    return false;
  }
  const nowSeconds = Date.now() / 1000;
  return records.some((record) => {
    if (!record || typeof record !== "object") return false;
    if (String(record.workspaceId ?? "").toLowerCase() !== workspaceId) return false;
    if (String(record.surfaceId ?? "").toLowerCase() !== surfaceId) return false;
    if (String(record.sessionId ?? "").toLowerCase() !== session) return false;
    // 基线超过 7 天会被 cmux 自己清掉，这里跟着保持一致
    return typeof record.capturedAt === "number" && nowSeconds - record.capturedAt < 7 * 86_400;
  });
}

/** 解析 source 参数；不认识的写法返回 null，让调用方提示可用值。 */
function parseSource(raw: string | undefined): DiffSource | null | "unknown" {
  if (!raw || !raw.trim()) return null;
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, DiffSource> = {
    unstaged: "unstaged",
    working: "unstaged",
    staged: "staged",
    cached: "staged",
    branch: "branch",
    "last-turn": "last-turn",
    last: "last-turn",
    turn: "last-turn",
  };
  return aliases[normalized] ?? "unknown";
}

function normalizeSource(value: unknown): DiffSource | null {
  if (typeof value !== "string") return null;
  const parsed = parseSource(value);
  return parsed && parsed !== "unknown" ? parsed : null;
}

// ===== 面板登记 =====

function loadPanels(): OpenedPanel[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(OPENED_FILE, "utf8"));
    const panels = Array.isArray(parsed?.panels) ? parsed.panels : [];
    return panels.filter(
      (panel: any) => panel && typeof panel.surface === "string" && typeof panel.cwd === "string",
    ) as OpenedPanel[];
  } catch {
    return [];
  }
}

function savePanels(panels: OpenedPanel[]): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(OPENED_FILE, JSON.stringify({ panels }, null, 2) + "\n", "utf8");
  } catch {
    // 登记失败不影响面板本身可用，只是没法用 /close-diff 关它
  }
}

// ===== 打开 / 关闭 =====

interface OpenOptions {
  source?: DiffSource | null;
  pathArg?: string;
  sessionId: string;
  sessionCwd: string;
  /** 用户手动敲命令时切过去看；AI 调工具时不抢焦点。 */
  focus: boolean;
}

interface OpenResult {
  ok: boolean;
  message: string;
}

async function openDiff(options: OpenOptions): Promise<OpenResult> {
  const reachable = await cmuxReachable();
  if (!reachable.ok) return { ok: false, message: reachable.message };

  const baseDir = resolveExistingPath(options.pathArg, options.sessionCwd);
  if (!baseDir) {
    return { ok: false, message: `路径不存在：${options.pathArg}` };
  }
  const root = await gitRoot(baseDir);
  if (!root) {
    return {
      ok: false,
      message: `这个目录不是 git 仓库，cmux 的 diff 出不了内容：${baseDir}\n（可以先 git init，或换成仓库内的路径）`,
    };
  }

  // source 选择：用户显式指定优先；否则有 last-turn 基线就用它，没有就退到 unstaged。
  let source: DiffSource;
  let autoNote = "";
  if (options.source) {
    source = options.source;
    if (source === "last-turn" && !hasLastTurnBaseline(options.sessionId)) {
      autoNote = "（注意：没查到这一轮的 last-turn 基线，面板可能显示空状态）";
    }
  } else if (hasLastTurnBaseline(options.sessionId)) {
    source = "last-turn";
    autoNote = "（自动选中 last turn）";
  } else {
    source = "unstaged";
    autoNote = "（没有本轮的 last-turn 基线，自动用 unstaged）";
  }

  const buildArgs = (chosen: DiffSource): string[] => {
    const list = ["diff", `--${chosen}`, "--cwd", root];
    if (!options.focus) list.push("--no-focus");
    return list;
  };

  let result = await runCmux(buildArgs(source), root);
  let retriedAfterConflict = false;
  if (!result.ok && shouldRetryWithoutRouting(result)) {
    // 根因已在 cmux CLI 源码修复（不再把 caller context 注进面板路由）。这段只服务于
    // 尚未更新的旧版 app：去掉两个冲突的环境变量重试，让 cmux 走默认窗口路由；
    // last-turn 依赖它们定位基线，因此旧 CLI 下暂时退到 unstaged。
    const retrySource: DiffSource = source === "last-turn" ? "unstaged" : source;
    const retry = await runCmux(buildArgs(retrySource), root, 60_000, cleanRoutingEnv());
    retriedAfterConflict = true;
    if (retry.ok) {
      const downgraded = retrySource !== source;
      result = retry;
      source = retrySource;
      autoNote = downgraded
        ? "（旧版 cmux CLI 的窗口路由冲突，暂时退到 unstaged）"
        : "（旧版 cmux CLI 的窗口路由冲突，已改用默认窗口路由重新打开）";
    }
  }
  if (!result.ok) {
    const detail = (result.stderr || result.error || "").trim();
    const retryNote = retriedAfterConflict ? "\n（已尝试去掉 workspace / surface 选择器重试，仍然失败）" : "";
    return {
      ok: false,
      message:
        `cmux diff 失败（source=${source}）。\n` +
        `${detail || "（无输出）"}${retryNote}\n` +
        "如果提示 socket 相关错误，确认 cmux app 正在运行。",
    };
  }

  const match = result.stdout.match(/surface=(\S+)/);
  if (!match) {
    return {
      ok: false,
      message: `cmux diff 没有返回面板引用，无法登记。\n输出：${result.stdout.trim() || "（空）"}`,
    };
  }
  const surface = match[1];
  const workspace = result.stdout.match(/workspace=(\S+)/)?.[1];

  const panels = loadPanels().filter((panel) => panel.surface !== surface);
  panels.push({
    surface,
    workspace,
    cwd: root,
    source,
    sessionId: options.sessionId,
    openedAt: Date.now(),
  });
  savePanels(panels);

  return {
    ok: true,
    message: `已打开 diff 面板 ${surface}${autoNote}\n来源：${SOURCE_LABELS[source]}\n仓库：${root}\n关闭：/close-diff`,
  };
}

interface CloseOptions {
  /** 只关这个路径（仓库根）下的面板。 */
  pathArg?: string;
  /** 关掉所有会话打开的面板（默认只关本会话的）。 */
  all?: boolean;
  sessionId: string;
  sessionCwd: string;
}

async function closeDiff(options: CloseOptions): Promise<OpenResult> {
  const reachable = await cmuxReachable();
  if (!reachable.ok) return { ok: false, message: reachable.message };

  const all = loadPanels();
  if (all.length === 0) return { ok: true, message: "没有登记过由本扩展打开的 diff 面板。" };

  let targetRoot: string | null = null;
  if (options.pathArg) {
    const baseDir = resolveExistingPath(options.pathArg, options.sessionCwd);
    targetRoot = baseDir ? await gitRoot(baseDir) : null;
    if (!targetRoot) return { ok: false, message: `路径不存在或不是 git 仓库：${options.pathArg}` };
  }

  const targets = all.filter((panel) => {
    if (!options.all && panel.sessionId !== options.sessionId) return false;
    if (targetRoot && panel.cwd !== targetRoot) return false;
    return true;
  });

  if (targets.length === 0) {
    const scopeText = options.all ? "任何会话" : "本会话";
    const pathText = targetRoot ? `（仓库 ${targetRoot}）` : "";
    return { ok: true, message: `没有需要关闭的面板：${scopeText}打开的面板里没有匹配项${pathText}。` };
  }

  const closed: string[] = [];
  const failed: string[] = [];
  for (const panel of targets) {
    const result = await closePanel(panel);
    // "Surface ref not found" 说明面板已经被用户手动关掉了——按已关闭处理，清掉登记
    if (result.ok || /not found|unknown surface/i.test(result.stderr)) {
      closed.push(panel.surface);
    } else {
      failed.push(`${panel.surface}：${(result.stderr || result.error || "").trim().split("\n")[0]}`);
    }
  }

  const remaining = all.filter((panel) => !closed.includes(panel.surface));
  savePanels(remaining);

  const lines: string[] = [];
  if (closed.length) lines.push(`已关闭 ${closed.length} 个 diff 面板。`);
  if (failed.length) lines.push(`有 ${failed.length} 个没关掉：\n${failed.map((item) => `  - ${item}`).join("\n")}`);
  return { ok: failed.length === 0, message: lines.join("\n") || "没有变化。" };
}

/**
 * 找出某个 surface 所在的窗口句柄。
 *
 * `cmux close-surface --surface <ref>` 只有在能推断调用者上下文时才不用带
 * `--workspace` / `--window`（env 里的 `CMUX_WORKSPACE_ID` 或 cwd 匹配到某个 workspace）。
 * 从外部终端（Ghostty 里的 pi）调时两个都没有，CLI 直接报
 * 「close-surface requires --workspace or --window with explicit --surface」。
 * 这里遍历窗口的 panel 列表找到它属于哪个窗口，然后带上 `--window` 重试。
 *
 * 返回三种结果：窗口句柄（找到了）／ `null`（把能查的窗口都查过，那里没有这个 surface——
 * 面板早就不在了）／ `undefined`（cmux 连不上或列表读不出来，判断不了）。
 * 调用方靠这个区分「已经关掉了」与「真出错了」，不能混为一谈。
 */
async function findSurfaceWindow(surfaceRef: string): Promise<string | null | undefined> {
  const windows = await runCmux(["list-windows", "--json"], undefined, 15_000);
  if (!windows.ok) return undefined;
  let parsed: any;
  try {
    parsed = JSON.parse(windows.stdout);
  } catch {
    return undefined;
  }
  const list: any[] = Array.isArray(parsed) ? parsed : (parsed?.windows ?? []);
  if (list.length === 0) return undefined;
  let listed = 0;
  for (const item of list) {
    const handle = String(item?.index ?? item?.id ?? "").trim();
    if (!handle) continue;
    const panels = await runCmux(["list-panels", "--window", handle, "--json"], undefined, 15_000);
    if (!panels.ok) continue;
    listed += 1;
    try {
      const surfaces: any[] = JSON.parse(panels.stdout)?.surfaces ?? [];
      if (surfaces.some((surface) => surface?.ref === surfaceRef || surface?.id === surfaceRef)) {
        return handle;
      }
    } catch {
      // 解析失败就换下一个窗口
    }
  }
  // 至少成功列出过一个窗口的 panel，且哪儿都没这个 surface：面板已经被关掉了。
  // 一个都没列出来就当作「判断不了」，别把清理当成成功。
  return listed > 0 ? null : undefined;
}

/** 关掉一个已登记的面板；外部终端里缺调用者上下文时先定位窗口再重试。 */
async function closePanel(panel: OpenedPanel): Promise<RunResult> {
  const first = await runCmux(["close-surface", "--surface", panel.surface], panel.cwd, 20_000);
  if (first.ok) return first;
  const needsWindow =
    /requires --workspace or --window/i.test(first.stderr) || /requires --workspace/i.test(first.error ?? "");
  if (!needsWindow) return first;
  const windowHandle = await findSurfaceWindow(panel.surface);
  // 查询失败：保留原错误，交给调用方报告
  if (windowHandle === undefined) return first;
  // 面板已经不在任何窗口里（手动关掉 / cmux 重启过）：按已关闭处理，
  // 让登记跟着清掉，而不是报一个用户在界面上根本看不到的「没关掉」。
  if (windowHandle === null) return { ok: true, stdout: "", stderr: "", code: 0 };
  return runCmux(["close-surface", "--window", windowHandle, "--surface", panel.surface], panel.cwd, 20_000);
}

// ===== 会话内改动汇报（纯 git，不依赖 cmux） =====

/**
 * 为什么有这一块：cmux 的 diff 面板很好用，但要它跑起来得同时满足「cmux 在跑 + socket 放行 +
 * 面板窗口正确」，本质上依赖外部软件，`last-turn` 还要求 pi 是从 cmux 里启动的。这里给一条
 * 纯 git 的退路：每轮开始时记一个基线，轮次彻底结束（agent_settled）时把「这一轮改了什么」
 * 直接追加到会话里——不经过任何外部程序，也不进 LLM 上下文（custom entry 只落盘 + 渲染）。
 */

/** 会话内汇报的开关文件（跨会话共享）。 */
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
/** 本轮基线（按会话 id 存，落盘后 CLI 也能读）。 */
const BASELINE_STATE_FILE = path.join(STATE_DIR, "turn-baseline.json");
/** 上一个已完成轮次的报告（按仓库根存，供 `/diff-report` 与 CLI 读取）。 */
const LAST_REPORT_FILE = path.join(STATE_DIR, "last-turn.json");
/** 会话内汇报的 entry 类型（pi.appendEntry 的自定义类型）。 */
const REPORT_ENTRY_TYPE = "diff-view-report";
/** 不展开时最多列几个文件。 */
const REPORT_VISIBLE_FILES = 8;

interface ReportSettings {
  /** 每轮结束自动汇报；默认开启。 */
  inlineReport: boolean;
}

function loadReportSettings(): ReportSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return { inlineReport: parsed?.inlineReport === true };
  } catch {
    // 默认不主动出卡片：要就手敲 `/diff-report`（或跑 CLI），不要就别打扰。
    return { inlineReport: false };
  }
}

function saveReportSettings(settings: ReportSettings): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
  } catch {
    // 写不进去只影响下次启动的默认值，不影响本次会话
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch {
    // 状态写不进去只影响 CLI 与下次读取，不影响本次会话
  }
}

/** 一轮开始时的快照。 */
interface TurnBaseline {
  repoRoot: string;
  /** 基线时刻的 HEAD 提交。 */
  head: string;
  /**
   * `git stash create` 的结果：把基线时刻已跟踪文件的脏改动固化成一个游离提交，
   * 之后用它当 diff 基准。它不写 ref、不动工作区、也不进 stash 列表。
   */
  snapshot: string | null;
  /** 基线时刻未跟踪文件 → 指纹（大小 + mtime），用来判断「是不是这一轮新冒出来的」。 */
  untracked: Record<string, string>;
}

type ReportFileKind = "modified" | "added" | "deleted" | "renamed";

interface ReportFile {
  path: string;
  added: number;
  deleted: number;
  kind: ReportFileKind;
  binary?: boolean;
}

/** 这次汇报的对照口径：`turn` = 相对本轮基线，`head` = 相对当前 HEAD 的全部未提交改动。 */
type ReportScope = "turn" | "head";

interface ReportData {
  repoName: string;
  repoRoot: string;
  files: ReportFile[];
  added: number;
  deleted: number;
  scope: ReportScope;
}

function fingerprintFile(absPath: string): string {
  try {
    const stat = fs.statSync(absPath);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "";
  }
}

/** `git status --porcelain -z` → `{ code, path }`；重命名 / 复制取新路径。 */
function parseStatusEntries(buffer: string): Array<{ code: string; path: string }> {
  const chunks = buffer.split("\0");
  const entries: Array<{ code: string; path: string }> = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const code = chunk.slice(0, 2);
    const entryPath = chunk.slice(3);
    // 重命名 / 复制条目后面还跟着一个「原路径」块，跳过去
    if (code.startsWith("R") || code.startsWith("C")) index += 1;
    entries.push({ code, path: entryPath });
  }
  return entries;
}

function countFileLines(absPath: string): number {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    if (!text) return 0;
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

/** 记本轮基线；不在 git 仓库、或仓库还没有任何提交时返回 null。 */
async function captureTurnBaseline(cwd: string): Promise<TurnBaseline | null> {
  const repoRoot = await gitRoot(cwd);
  if (!repoRoot) return null;
  const headResult = await run("git", ["rev-parse", "HEAD"], repoRoot, 10_000);
  if (!headResult.ok) return null;
  const head = headResult.stdout.trim();
  if (!head) return null;
  const stashResult = await run("git", ["stash", "create"], repoRoot, 20_000);
  const snapshot = stashResult.ok && stashResult.stdout.trim() ? stashResult.stdout.trim() : null;
  const untracked: Record<string, string> = {};
  const statusResult = await run("git", ["status", "--porcelain", "-z"], repoRoot, 20_000);
  if (statusResult.ok) {
    for (const entry of parseStatusEntries(statusResult.stdout)) {
      if (entry.code !== "??") continue;
      untracked[entry.path] = fingerprintFile(path.join(repoRoot, entry.path));
    }
  }
  return { repoRoot, head, snapshot, untracked };
}

interface BaselineState {
  version: number;
  sessions: Record<string, TurnBaseline & { sessionId: string; capturedAt: number }>;
}

/** 落盘的一轮报告。 */
interface StoredTurn extends ReportData {
  sessionId: string;
  generatedAt: number;
}

/**
 * 每个仓库留一串轮次报告（新的在前）。
 *
 * 为什么是「串」而不是「一条」：没有文件改动的轮次不该把上一轮的报告冲掉——之前的
 * 单条存储就是这么干的，于是「跑一个空轮次 → 上一轮的结果没了」。空轮次现在只记基线、
 * 不写报告，历史自然保留。
 */
interface LastReportState {
  version: number;
  repos: Record<string, { turns: StoredTurn[] }>;
}

/** 每个仓库最多留几轮。 */
const MAX_STORED_TURNS = 20;

/** 把本轮基线按会话 id 落盘：CLI 与手敲命令都靠它拿「这一轮从哪儿开始」。 */
function persistBaseline(sessionKey: string, baseline: TurnBaseline): void {
  const state = readJsonFile<BaselineState>(BASELINE_STATE_FILE) ?? { version: 1, sessions: {} };
  state.version = 1;
  state.sessions[sessionKey] = { ...baseline, sessionId: sessionKey, capturedAt: Date.now() };
  // 只留最近 20 个会话，避免长期堆积
  const keys = Object.keys(state.sessions);
  if (keys.length > 20) {
    keys
      .sort((left, right) => (state.sessions[left].capturedAt ?? 0) - (state.sessions[right].capturedAt ?? 0))
      .slice(0, keys.length - 20)
      .forEach((key) => delete state.sessions[key]);
  }
  writeJsonFile(BASELINE_STATE_FILE, state);
}

/** 追加一轮报告到该仓库的历史；本轮没有改动就什么都不写（历史保持原样）。 */
function persistLastReport(sessionKey: string, repoRoot: string, report: ReportData | null): void {
  if (!report) return;
  const state = readJsonFile<LastReportState>(LAST_REPORT_FILE) ?? { version: 2, repos: {} };
  state.version = 2;
  const bucket = (state.repos[repoRoot] ??= { turns: [] });
  bucket.turns.unshift({ ...report, sessionId: sessionKey, generatedAt: Date.now() });
  bucket.turns = bucket.turns.slice(0, MAX_STORED_TURNS);
  writeJsonFile(LAST_REPORT_FILE, state);
}

/** 读某仓库最近的第 `index` 轮报告（0 = 最新）。 */
function readStoredTurn(repoRoot: string, index = 0): StoredTurn | null {
  const state = readJsonFile<LastReportState>(LAST_REPORT_FILE);
  const bucket = state?.repos?.[repoRoot];
  if (!bucket || !Array.isArray(bucket.turns) || bucket.turns.length === 0) return null;
  return bucket.turns[Math.min(Math.max(index, 0), bucket.turns.length - 1)] ?? null;
}

/**
 * 「相对 HEAD」的基线：不固化了工作区快照，untracked 也当作新文件，
 * 用来回答「现在工作区里一共有哪些未提交改动」——手敲 `/diff-report` 时用这个口径。
 * 注意它跟自动汇报的「本轮增量」不是一回事。
 */
async function captureHeadBaseline(cwd: string): Promise<TurnBaseline | null> {
  const repoRoot = await gitRoot(cwd);
  if (!repoRoot) return null;
  const headResult = await run("git", ["rev-parse", "HEAD"], repoRoot, 10_000);
  if (!headResult.ok) return null;
  const head = headResult.stdout.trim();
  if (!head) return null;
  return { repoRoot, head, snapshot: null, untracked: {} };
}

/** 算出「相对基线改了什么」；没有任何改动时返回 null。 */
async function buildTurnReport(baseline: TurnBaseline, scope: ReportScope = "turn"): Promise<ReportData | null> {
  const { repoRoot, head, snapshot } = baseline;
  const base = snapshot ?? head;
  const numstat = await run("git", ["diff", "--numstat", base], repoRoot, 20_000);
  if (!numstat.ok) return null;

  // 状态字母单独取一份，用来区分新增 / 删除 / 重命名；numstat 只给行数。
  const kinds = new Map<string, ReportFileKind>();
  const nameStatus = await run("git", ["diff", "--name-status", base], repoRoot, 20_000);
  if (nameStatus.ok) {
    for (const line of nameStatus.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [letter, ...rest] = line.split("\t");
      const target = rest[rest.length - 1];
      if (!target) continue;
      const kind: ReportFileKind =
        letter.startsWith("A") ? "added" : letter.startsWith("D") ? "deleted" : letter.startsWith("R") ? "renamed" : "modified";
      kinds.set(target, kind);
    }
  }

  const files: ReportFile[] = [];
  let added = 0;
  let deleted = 0;
  for (const line of numstat.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    if (!filePath) continue;
    const binary = addedRaw === "-" || deletedRaw === "-";
    const plus = binary ? 0 : Number(addedRaw) || 0;
    const minus = binary ? 0 : Number(deletedRaw) || 0;
    added += plus;
    deleted += minus;
    files.push({ path: filePath, added: plus, deleted: minus, kind: kinds.get(filePath) ?? "modified", binary });
  }

  // 这一轮新出现的未跟踪文件（基线里没有的）：按整份文件算作新增行
  const statusResult = await run("git", ["status", "--porcelain", "-z"], repoRoot, 20_000);
  if (statusResult.ok) {
    for (const entry of parseStatusEntries(statusResult.stdout)) {
      if (entry.code !== "??") continue;
      if (baseline.untracked[entry.path] !== undefined) continue;
      const lines = countFileLines(path.join(repoRoot, entry.path));
      added += lines;
      files.push({ path: entry.path, added: lines, deleted: 0, kind: "added" });
    }
  }

  if (files.length === 0) return null;
  files.sort((left, right) => right.added + right.deleted - (left.added + left.deleted));
  return { repoName: path.basename(repoRoot), repoRoot, files, added, deleted, scope };
}

/** 注册会话内汇报的渲染器（Box + Text，跟其它扩展卡片一个风格）。 */
function registerReportRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<ReportData>(REPORT_ENTRY_TYPE, (entry: any, renderOptions: any, theme: any) => {
    const expanded = Boolean(renderOptions?.expanded);
    const data = entry?.data as ReportData | undefined;
    const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    if (!data || data.files.length === 0) {
      box.addChild(new Text(theme.fg("dim", "没有文件变化"), 0, 0));
      return box;
    }
    box.addChild(
      new Text(
        theme.fg(
          "accent",
          `${data.scope === "head" ? "工作区改动（相对 HEAD）" : "本轮改动"} · ${data.files.length} 个文件 · +${data.added} -${data.deleted} · ${data.repoName}`,
        ),
        0,
        0,
      ),
    );
    const limit = expanded ? data.files.length : Math.min(REPORT_VISIBLE_FILES, data.files.length);
    for (const file of data.files.slice(0, limit)) {
      const mark = file.kind === "added" ? "A" : file.kind === "deleted" ? "D" : file.kind === "renamed" ? "R" : "M";
      const stat = file.binary ? "二进制" : `+${file.added} -${file.deleted}`;
      box.addChild(new Text(`  ${mark} ${file.path}  ${theme.fg("dim", stat)}`, 0, 0));
    }
    if (data.files.length > limit) {
      box.addChild(new Text(theme.fg("dim", `  …还有 ${data.files.length - limit} 个文件（展开查看）`), 0, 0));
    }
    return box;
  });
}

// ===== 扩展入口 =====

export default function (pi: ExtensionAPI) {
  /** 当前 pi 会话 id：用于区分「谁打开的面板」，也用于匹配 cmux 的 last-turn 基线。 */
  let sessionId = "";
  let sessionCwd = process.cwd();
  /** 会话内汇报的开关（默认开）与本轮基线。 */
  let reportSettings = loadReportSettings();
  let turnBaseline: TurnBaseline | null = null;

  registerReportRenderer(pi);

  pi.on("session_start", async (_event: any, ctx: any) => {
    try {
      sessionId = String(ctx?.sessionManager?.getSessionId?.() ?? "");
    } catch {
      sessionId = "";
    }
    if (!sessionId) sessionId = `pid-${process.pid}`;
    sessionCwd = String(ctx?.cwd ?? process.cwd());
  });

  // 每轮用户提示开始时记基线：之后算「这一轮改了什么」就靠它。基线同时落盘，
  // 这样轮次结束以后（甚至换了进程）CLI 也能按仓库把它捞回来重算。
  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    const cwd = String(ctx?.cwd ?? sessionCwd);
    try {
      turnBaseline = await captureTurnBaseline(cwd);
      if (turnBaseline) persistBaseline(sessionId, turnBaseline);
    } catch {
      turnBaseline = null;
    }
  });

  // 轮次彻底结束（不再有重试 / 补充）时算一次「本轮增量」：结果落盘给 `/diff-report`
  // 和 `diff-report` CLI 读；只有开了自动汇报（默认关）才顺手往会话里追加一张卡片。
  // 卡片是 custom entry：不进 LLM 上下文，也不消耗 token。
  pi.on("agent_settled", async () => {
    const baseline = turnBaseline;
    turnBaseline = null;
    if (!baseline) return;
    try {
      const report = await buildTurnReport(baseline, "turn");
      persistLastReport(sessionId, baseline.repoRoot, report);
      if (reportSettings.inlineReport && report) pi.appendEntry(REPORT_ENTRY_TYPE, report);
    } catch {
      // 汇报失败不该影响 agent 本身
    }
  });

  pi.registerTool({
    name: "open_diff",
    label: "打开 diff 面板",
    description:
      "在 cmux 里打开当前仓库的 diff 面板（默认不抢焦点）。source 省略时自动选择：本轮有 last-turn 基线就用 last turn（只看这一轮 AI 改动），否则用 unstaged（工作区全部改动）。" +
      "只读操作，不会修改任何文件。",
    promptSnippet: "Open a diff panel in cmux for the current repository (last turn when available, otherwise unstaged)",
    promptGuidelines: [
      "Use open_diff when the user asks to see the diff of recent edits (e.g. 「看看你改了什么」「打开 diff」). It never modifies files.",
      "Use close_diff when the user asks to close those panels.",
    ],
    parameters: Type.Object({
      source: Type.Optional(
        Type.String({
          description: "diff 来源：last-turn（这一轮 AI 改动）/ unstaged（未暂存，默认）/ staged（已暂存）/ branch（分支改动）。省略时自动选择。",
        }),
      ),
      path: Type.Optional(Type.String({ description: "仓库内任意路径（绝对或相对当前目录）；省略时用当前目录所在的仓库。" })),
    }),
    async execute(_toolCallId, params) {
      const parsed = normalizeSource(params.source);
      if (params.source && !parsed) {
        return {
          content: [
            {
              type: "text" as const,
              text: `source 不认识：${params.source}。可用值：last-turn / unstaged / staged / branch。`,
            },
          ],
        };
      }
      const result = await openDiff({
        source: parsed,
        pathArg: params.path,
        sessionId,
        sessionCwd,
        focus: false,
      });
      return { content: [{ type: "text" as const, text: result.message }] };
    },
  });

  pi.registerTool({
    name: "close_diff",
    label: "关闭 diff 面板",
    description:
      "关闭由本扩展打开过的 cmux diff 面板。默认只关本会话打开的；给 all=true 关掉所有会话打开的；给 path 只关该仓库的。" +
      "只会关闭登记在案的面板，绝不碰用户自己打开的面板或终端。",
    promptSnippet: "Close diff panels previously opened by open_diff in cmux",
    promptGuidelines: [
      "Use close_diff when the user asks to close diff panels (e.g. 「把 diff 关掉」). It only closes panels opened by this extension.",
    ],
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "只关闭该仓库下打开的面板。" })),
      all: Type.Optional(Type.Boolean({ description: "关闭所有会话打开的面板（默认只关本会话的）。" })),
    }),
    async execute(_toolCallId, params) {
      const result = await closeDiff({
        pathArg: params.path,
        all: params.all === true,
        sessionId,
        sessionCwd,
      });
      return { content: [{ type: "text" as const, text: result.message }] };
    },
  });

  pi.registerCommand("open-diff", {
    description: "在 cmux 里打开 diff 面板（可选 last-turn / unstaged / staged / branch / 路径）",
    handler: async (args: string, ctx: any) => {
      const raw = (args ?? "").trim();
      let source: DiffSource | null = null;
      let pathArg: string | undefined;
      if (raw) {
        const parsed = parseSource(raw);
        if (parsed === "unknown") {
          // 不是 source 关键字，按路径处理
          pathArg = raw;
        } else {
          source = parsed;
        }
      }
      const result = await openDiff({
        source,
        pathArg,
        sessionId,
        sessionCwd: String(ctx?.cwd ?? sessionCwd),
        focus: true,
      });
      try {
        ctx?.ui?.notify?.(result.message, result.ok ? "info" : "error");
      } catch {
        // 通知失败不影响命令结果
      }
    },
  });

  pi.registerCommand("close-diff", {
    description: "关闭由本扩展打开的 diff 面板（--all 关全部，给路径只关该仓库）",
    handler: async (args: string, ctx: any) => {
      const raw = (args ?? "").trim();
      const all = raw === "--all" || raw === "-a";
      const pathArg = raw && !all ? raw : undefined;
      const result = await closeDiff({
        pathArg,
        all,
        sessionId,
        sessionCwd: String(ctx?.cwd ?? sessionCwd),
      });
      try {
        ctx?.ui?.notify?.(result.message, result.ok ? "info" : "error");
      } catch {
        // 同上
      }
    },
  });

  pi.registerCommand("diff-report", {
    description: "把上一轮 AI 改了什么贴进会话（纯 git，不依赖 cmux）；on|off 切换每轮结束自动贴，head 看工作区相对 HEAD 的全量",
    handler: async (args: string, ctx: any) => {
      const raw = (args ?? "").trim().toLowerCase();
      if (raw === "on" || raw === "off") {
        reportSettings = { inlineReport: raw === "on" };
        saveReportSettings(reportSettings);
        ctx?.ui?.notify?.(`每轮结束自动贴改动卡片已${raw === "on" ? "开启" : "关闭"}。`, "info");
        return;
      }
      const cwd = String(ctx?.cwd ?? sessionCwd);
      let report: ReportData | null = null;
      if (raw === "head") {
        // 可选口径：工作区相对 HEAD 的全部未提交改动（不是「本轮」，要看总量时用）
        const headBaseline = await captureHeadBaseline(cwd);
        if (!headBaseline) {
          ctx?.ui?.notify?.("没有可汇报的改动：当前目录不是 git 仓库（或仓库还没有任何提交）。", "info");
          return;
        }
        report = await buildTurnReport(headBaseline, "head");
        if (!report) {
          ctx?.ui?.notify?.("没有可汇报的改动：工作区相对 HEAD 是干净的。", "info");
          return;
        }
      } else if (turnBaseline) {
        // 本轮还在跑（有内存基线）→ 直接算当前进度
        report = await buildTurnReport(turnBaseline, "turn");
      } else {
        // 轮次已结束 → 读落盘的历史（本轮基线在结束时就用掉了）；`/diff-report 2` 看再往前一轮
        const repoRoot = await gitRoot(cwd);
        if (!repoRoot) {
          ctx?.ui?.notify?.("没有可汇报的改动：当前目录不是 git 仓库（或仓库还没有任何提交）。", "info");
          return;
        }
        const index = Number.parseInt(raw, 10);
        report = readStoredTurn(repoRoot, Number.isFinite(index) && index > 0 ? index - 1 : 0);
        if (!report) {
          ctx?.ui?.notify?.(
            "这个仓库还没有可汇报的轮次：跑一轮带文件改动的任务后再来（或直接跑 `diff-report` 命令）。",
            "info",
          );
          return;
        }
      }
      pi.appendEntry(REPORT_ENTRY_TYPE, report);
    },
  });
}
