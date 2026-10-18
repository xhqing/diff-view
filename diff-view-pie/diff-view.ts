/**
 * diff-view.ts（原 ai-edit-diff.ts，2026-10-18 改名）— 通用「改动可视化 / 跨会话双向知情」扩展（与 git 无关）。
 * 定位：独立于 git 的「文件内容 diff 视图」——改动来源不限（AI 编辑 / 用户手改 / 其它会话 / 脚本），
 * 一律以「改动前快照 ↔ 当前内容」的形式按需查看；不依赖版本控制、不要求仓库干净。
 * 归属：本文件是 diff-view 项目（~/Developer/diff-view）的 pi 侧组件（diff-view-pie）；
 * 部署副本位于 ~/.pi/agent/extensions/diff-view.ts（由项目 install.sh 拷贝，勿直接改副本）；
 * 完整功能需同时安装 VSCode 侧组件（diff-view-vsce）——两者都装才是完整功能，见项目 README。
 *
 * 功能：
 *  A) AI 改动 → 登记「改动前快照」（默认不打开任何窗口、不打扰）；用户需要时由 AI 调用
 *     `open_diff` 按需打开 diff（左：改动前快照 / 右：当前内容；先选文件与 VSCode 窗口、经用户确认）
 *     ——2026-10-18 起也可直接键入 `/open-diff` 打开、`/close-diff` 关闭（关闭经 VSCode 侧助手
 *     diff-view-vsce 执行，协议见文末改造说明）。
 *  B) 文件变更通知 → 任何来源的变更（用户手动改 / 某个会话改），都会通知给**正在干活
 *     （任务进行中）且碰过该文件的会话**（前台与后台一视同仁），让每个会话都及时更新对该
 *     文件的最新认知；通知附带变更来源、「改动前快照」与「相关性判断依据」（文件名 / 文件
 *     所属项目位置 / 本会话此前是否读过它），由接收会话**先判断当前任务是否用得到该文件**
 *     ——大概率无关则跳过读取（避免无关信息干扰当前任务），相关或拿不准才重新读取、避免覆盖。
 *     **已完成当前任务、在等用户过目/指示的会话不接收通知**（2026-10-14 用户立）：变更只消化
 *     进它的已知状态，不打扰、不唤醒，等用户下一步指示后新任务用到该文件时自然读到最新内容。
 *
 * 机制（跨会话通过共享状态目录协调，无守护进程）：
 *  - mirror/  ：各文件最近一次已知内容（全局共享基线；采集"改动前快照"用）
 *  - meta/    ：每个文件的最新变更记录（新内容哈希 + 改动前快照路径 + 来源：会话/用户）
 *  - touched/ ：每个会话「碰过」哪些文件（会话私有、持久化；重启恢复后仍然记得）
 *  - claims/  ：会话工具正在改某文件的短时声明（把变更归因到会话，而不是"用户"）
 *  每个会话轮询自己碰过的文件：内容哈希与「自己已知」不一致即为变更 → 归因（meta/claim）→
 *  通知本会话 → 更新自己已知的哈希与 stat 快照（mtime+size 未变则跳过读取，省 IO）。
 *  自己工具的改动不通知自己——工具运行期与后台任务窗口内的变更一律静默并入自己已知状态
 *  （2026-10-15 立规，见文末改造说明），但会写 meta/mirror 供其他会话感知。
 *
 * 特点：不依赖 git；任何目录、任何项目均可工作；二进制/大文件/垃圾目录自动跳过。
 * 建立：2026-10-11（用户需求：Agent 改动可视化 + 用户改动通知 + 通用化）
 * 改造：2026-10-12（用户需求：diff 默认不自动打开；改为用户按需触发、选定窗口与文件并授权）
 * 改造：2026-10-12（用户需求：跨会话广播——碰过文件的活跃会话都要收到变更通知，无论改动人/会话是谁）
 * 改造：2026-10-12（用户反馈：措辞要准确——归因不明时不要默认写成「用户修改」（实践中大部分
 *       是其它会话改的），改用中性措辞「来源未识别」并注明推测范围）
 * 改造：2026-10-12（修复：复合命令（`cp … && diff …`）曾被误判为只读——写动作没登记快照/声明，
 *       自己改自己的文件也会收到误报；判定改为「出现写类命令/重定向即按写处理」）
 * 改造：2026-10-13（修复 bash 路径解析：相对路径此前一律按会话 cwd 解析——`cd /elsewhere &&
 *       head CHANGELOG.md` 会把 CHANGELOG.md 误记成会话 cwd 下的同名文件、让无关会话收到它的
 *       变更通知。现改为逐段跟踪命令内实际的 cd 目录；绝对路径（含 ~/）不受 cd 影响；当前目录
 *       无法静态确定（变量 / `cd -` / 命令替换等）时跳过相对路径——宁可漏记、不再错记）
 * 改造：2026-10-14（变更通知新增「先判断相关性、再决定是否读取」：通知不再直接要求重读，而是
 *       附上判断依据——文件名、文件所属项目/目录位置、本会话此前是否读过它（上下文里有没有旧
 *       内容）——让接收会话先判断当前任务用不用得到；大概率无关则跳过读取（避免无关信息干扰
 *       当前任务），相关或拿不准才重新读取。配套：touched 记录新增「触碰来源」src
 *       （read/edit/bash-read/bash-write/unknown，只升不降）；新增项目根定位——按 .git /
 *       CLAUDE.md / AGENTS.md / package.json 等「项目标识文件」判断文件是否属于本会话当前项目）
 * 改造：2026-10-14（用户立：通知只发给「任务进行中」的会话——已结束当前回合、在等用户过目/
 *       指示的会话不再接收通知：变更只消化进已知状态，不打扰也不唤醒。判定用 ctx.isIdle()
 *       ——agent run / 自动重试 / 自动压缩重试 / 排队续跑期间为 false（任务未结束），完全静止
 *       为 true；同时去掉通知消息的 triggerTurn——原先空闲会话会被变更通知直接唤醒、多跑一轮
 *       无谓回合，正是本次要消除的打扰）
 * 改造：2026-10-15（用户立规：**自己的工具改动 / 新增文件不要通知自己**——「自己发起的改动或
 *       新增自己知道」。原实现只靠「工具声明（claim）+ 改动前快照落盘」一条路静默同步，覆盖
 *       不全，四类情况仍会让轮询把「自己的改动」当外部变更、以「来源未识别」通知自己：
 *       ① 新增文件、镜像缺失时没有快照，收尾落盘根本不处理该路径；② 命令被误判为只读
 *       （如 `npx prettier --write a.md` 因含 "file" 字样命中只读判定）、或脚本写了命令文本里
 *       没出现的文件（git checkout / 构建脚本 / 格式化工具等）；③ 长任务超过声明 60 秒有效期；
 *       ④ 后台任务在工具窗口之外写文件。现改为四层保障：
 *       a) 工具运行登记——write/edit 的 path、bash/background_run 从命令里解析出的路径、未知
 *          工具输入里像路径的字符串，都在工具开始时登记；登记不要求文件已存在（覆盖新增文件），
 *          并记下 preHash 供收尾判断「是否真变了」；
 *       b) 运行期抑制——本会话任一可能写文件的工具执行期间（长任务声明持续刷新、不再过期），
 *          轮询检测到的变更一律视作「自己的」→ 静默同步、不通知；
 *       c) 结束收尾——按 preHash 判定真变了的路径写 meta（归属自己）并更新镜像与自己已知状态；
 *          再做一次「清扫」：运行窗口内自己碰过的文件里任何变化都静默同步（脚本写文件等
 *          「路径不在工具输入里」的情况）；
 *       d) 后台任务窗口——background_run 起（经 pi.events 的 agent-wait-banner:activity 得知，
 *          与 background-tasks 扩展联动）至任务结束、上限 10 分钟：窗口内的变更同样静默同步
 *          （后台进程在工具窗口之外写文件）。
 *       例外：变更记录明确指向**别的会话或用户**时照常通知——跨会话知情不受影响；本会话只有
 *       在「变更来源不是自己」时才收到通知。
 *       代价：工具运行期间（及后台窗口内）外部来源对本会话跟踪文件的改动会被一并静默吞掉，
 *       这是「自己的改动不通知自己」换来的边界；窗口通常很短（毫秒～秒级），长任务期间的
 *       外部改动可能就此错过——之后真正读取该文件时读到的仍是最新内容。
 * 改造：2026-10-15（用户立：**委派出去的活，被委派会话中间的改动静默**——「这种情况只需要在
 *       被委派会话最终完成的汇报通知你就行，中间由被委派的会话改动的文件不需要通知」）。
 *       实现为「委派窗口」：本会话用 agent_call / intercom（send / ask / handover）把活交给
 *       别的会话时，记一条窗口（含目标名字 / 会话 id / 目标目录 dir）；窗口内由被委派方产生的
 *       变更一律静默
 *       并入自己已知状态、不通知——归属匹配两条路：
 *       ① 按会话 id——经 pi-intercom 的 `list --json` 把名字解析成 id（注册时预热、每
 *          60 秒刷新一次，对方上线后才解析得到）；目标本来就是 id 时直接前缀匹配；
 *       ② 按目标目录 dir 兜底——被委派会话没加载本扩展时，它的改动在归属上显示「未识别」，
 *          只能按目录判断（文件落在那次委派的目标目录里就静默）。
 *       窗口时长（2026-10-15 当日追补）：上限默认 24 小时（AI_EDIT_DIFF_DELEGATE_MS 可
 *       覆盖）——实测对方可能隔夜才处理委派（当晚 01:35 发出的委派次日 11:42 才动工，
 *       原来的 1 小时上限拦不住）；见到对方活动后，安静超过 30 分钟即关窗
 *       （AI_EDIT_DIFF_DELEGATE_IDLE_MS 可覆盖）——对方这一波干完就回到常态通知；阻塞式
 *       委派（agent_call ask / intercom ask / handover）返回后只保留一段尾随窗口（默认
 *       30 分钟、AI_EDIT_DIFF_DELEGATE_GRACE_MS 可覆盖）；工具报错（对方没连上等）立即
 *       撤销窗口。
 *       边界：窗口内落在目标目录里的外部改动（用户 / 其它会话）也会被一并静默——与工具运行
 *       窗口同源的取舍，窗口有上限（默认 24 小时 / 活动后 30 分钟）、且只作用于该目录。
 * 改造：2026-10-18（用户需求：「打开 diff / 关闭 diff」升级为可直接键入的命令——新增
 *       `/open-diff`、`/close-diff` 两个用户命令与 `close_diff` 工具；原 open_diff 工具实现
 *       抽成共用流程（选文件 / 选窗口 / 差异预检 / 确认后打开，命令与工具同一套）。
 *       关闭机制：VSCode 没有「从外部关闭标签页」的官方接口——CLI 无相关子命令，AppleScript
 *       不支持查询 VSCode 窗口（实测报 -1728 Can't get name of every window），UI 脚本又会抢
 *       焦点。因此走「请求文件 + 确认文件」协议，与 VSCode 侧组件 diff-view-vsce（同项目
 *       diff-view，原独立项目 diff-bridge）协作：
 *         · pi 写 close-requests/<id>.json（含要关闭的路径，空 = 全部由本扩展打开的 diff），
 *           等 close-acks/<id>-*.json 确认（首个确认后再等 400ms 收其它窗口、总上限 2 秒），
 *           汇总各窗口关闭数量后回报用户；
 *         · diff-view-vsce 在每个 VSCode 窗口内轮询请求目录，只关闭「左 = 本扩展快照」的 diff
 *           标签（preserveFocus 静默关闭；不碰用户自己的对比视图与普通编辑器），处理完回写确认。
 *       未安装 / 未重载 diff-view-vsce 不静默失败：命令会如实报告「未收到确认」并给出处理办法。
 * 改造：2026-10-18（用户需求：**取消会话启动时的「已启用改动可视化」提示**——不再在每次会话
 *       启动时弹那条说明；功能照常运行，用到时按需调用工具/命令即可）。
 * 改名：2026-10-18（用户指出原名不严谨——「ai-edit-diff」把范围说窄成「AI 编辑产生的 diff」，
 *       而用户编辑同样产生 diff，实际定位是「独立于 git 的文件内容 diff 视图」；据此更名为
 *       `diff-view.ts`。内部状态目录（`state/ai-edit-diff/`）与环境变量名（`AI_EDIT_DIFF_*`）
 *       保持不动——已装的 VSCode 侧 diff-view-vsce 与正在运行的会话都指向它们，动了会打断协作；
 *       这些属内部管道、不影响对外语义）。
 * 整合：2026-10-18（用户需求：pi 侧与 VSCode 侧本是一个功能，应放同一项目——整合为 diff-view 项目，
 *       下设两个组件：diff-view-pie（本文件，pi 侧扩展）与 diff-view-vsce（VSCode 侧扩展，
 *       原独立项目 diff-bridge 并入）；两者都安装才是完整功能，见项目 README）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ===== 共享状态目录（跨会话协调；可用环境变量覆盖，便于测试/调试） =====
const STATE_DIR = process.env.AI_EDIT_DIFF_STATE_DIR ?? path.join(os.homedir(), ".pi/agent/state/ai-edit-diff");
const MIRROR_DIR = path.join(STATE_DIR, "mirror");     // 文件最近一次已知内容（全局共享）
const SNAP_DIR = path.join(STATE_DIR, "snapshots");    // 改动前快照
const META_DIR = path.join(STATE_DIR, "meta");         // 每个文件的最新变更记录（共享）
const TOUCH_DIR = path.join(STATE_DIR, "touched");     // 每个会话碰过的文件（会话私有）
const CLAIM_DIR = path.join(STATE_DIR, "claims");      // 会话工具的短时声明（归因用）
const CLOSE_REQ_DIR = path.join(STATE_DIR, "close-requests"); // 「关闭这些 diff」请求（/close-diff 写、VSCode 侧 diff-view-vsce 处理）
const CLOSE_ACK_DIR = path.join(STATE_DIR, "close-acks");     // VSCode 侧处理完的确认（含关闭数量）
const VSCODE_EXT_DIR = path.join(os.homedir(), ".vscode", "extensions"); // 仅用于「diff-view-vsce 是否安装」的提示判断
const CLOSE_FILE_KEEP_MS = 10 * 60 * 1000; // 关闭请求 / 确认文件的清理期（防止无人处理时无限堆积）

const TEXT_EXT = new Set([
  ".md", ".txt", ".json", ".jsonl", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".toml", ".yaml", ".yml", ".html", ".htm", ".css", ".scss", ".sh", ".bash",
  ".zsh", ".csv", ".tsv", ".xml", ".ini", ".cfg", ".conf", ".env", ".sql",
  ".rs", ".go", ".java", ".c", ".cpp", ".h", ".rb", ".php", ".vue", ".svelte",
]);
const SKIP_SEGMENTS = [
  `${path.sep}.git${path.sep}`, `${path.sep}node_modules${path.sep}`,
  `${path.sep}__pycache__${path.sep}`, `${path.sep}.venv${path.sep}`,
  `${path.sep}venv${path.sep}`, `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`, `${path.sep}.pi${path.sep}`,
  `${path.sep}.ai-edit-diff${path.sep}`,
  // 2026-10-14 增（用户决定）：临时产物不做变更通知——`tmp/` 目录整体跳过
  // （采样日志 monitor_log_*.csv 盯盘期间每 40 秒写入一次，每次写入都被记为
  // 「外部变更」→ 每个采样段产生数条通知噪音）；monitor_log_ 前缀兜底
  // 覆盖放在 tmp/ 以外的同款采样日志。
  `${path.sep}tmp${path.sep}`, `${path.sep}monitor_log_`,
];
const MAX_FILE_BYTES = 1024 * 1024;      // 1MB
const RECENT_MAX = 50;                   // 「最近改动」登记上限（供 open_diff 选择）
const TOUCH_MAX = 300;                   // 每个会话跟踪的文件上限（LRU）
const POLL_MS = Math.max(200, Number(process.env.AI_EDIT_DIFF_POLL_MS) || 2500); // 轮询间隔
const CLAIM_TTL_MS = 60_000;             // 工具声明的有效期（超时视为失效）
const SNAP_KEEP_MS = 30 * 24 * 3600 * 1000; // 快照保留期（更早的清掉）
const BG_SUPPRESS_MAX_MS = 10 * 60 * 1000;  // 「自己的后台任务」静默窗口上限（超过恢复正常通知）
const RUN_STALE_MS = 3 * 3600 * 1000;       // 工具运行登记的最大存活期（防 tool_execution_end 丢失泄漏）
/** 只读工具：其运行期间检测到的变更一律视为外部（不静默吞掉），也不参与收尾清扫。 */
const READONLY_TOOLS = new Set(["read", "open_diff", "close_diff", "background_list", "background_stop", "agent_call", "agent_wake", "intercom"]);
const DELEGATE_MAX_MS = Math.max(1_000, Number(process.env.AI_EDIT_DIFF_DELEGATE_MS) || 24 * 3600 * 1000);       // 委派窗口上限（默认 24 小时——对方可能隔夜才处理，2026-10-15 实测 10 小时后才动工）
const DELEGATE_IDLE_MS = Math.max(500, Number(process.env.AI_EDIT_DIFF_DELEGATE_IDLE_MS) || 30 * 60 * 1000);    // 见到对方活动后，安静这么久即关窗（默认 30 分钟）
const DELEGATE_GRACE_MS = Math.max(500, Number(process.env.AI_EDIT_DIFF_DELEGATE_GRACE_MS) || 30 * 60 * 1000); // 阻塞式委派返回后的尾随静默（默认 30 分钟）
/** 委派类工具：用它们把活交给别的会话——窗口内被委派方的改动静默（2026-10-15 用户立）。 */
const DELEGATE_TOOLS = new Set(["agent_call", "intercom"]);
/** intercom 会话表 CLI（把会话名字解析成 id；与 agent-call 扩展同一路径）。 */
const INTERCOM_BIN = path.join(os.homedir(), ".pi/agent/npm/node_modules/.bin/pi-intercom");
const MISSING = "__missing__";           // 文件不存在的特殊哈希

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return new Date(ts).toISOString();
  }
}

/** 原子写文件（临时文件 + rename），避免读到半截内容。 */
function atomicWrite(file: string, data: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, file);
  } catch {}
}

/** 读取文件状态：content（有内容）/ missing（不存在）/ skip（存在但读不了）。 */
type ReadState = { kind: "content"; text: string } | { kind: "missing" } | { kind: "skip" };
function readState(p: string): ReadState {
  try {
    return { kind: "content", text: fs.readFileSync(p, "utf-8") };
  } catch {
    try {
      fs.statSync(p);
      return { kind: "skip" };
    } catch {
      return { kind: "missing" };
    }
  }
}

/** stat 快查：用于 mtime+size 快速判断「内容没变」（省去整文件读取）。 */
type StatState = { kind: "file"; mtimeMs: number; size: number } | { kind: "missing" } | { kind: "skip" };
function statState(p: string): StatState {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return { kind: "file", mtimeMs: st.mtimeMs, size: st.size };
    return { kind: "skip" };
  } catch {
    return { kind: "missing" };
  }
}

/** 变更来源：某个会话（id/name）/ 用户 / 未知。 */
interface ChangedBy { kind: "session" | "user" | "unknown"; id?: string; name?: string }
/** 共享变更记录：谁在什么时候把文件变成了什么（附改动前快照）。 */
interface MetaRec { path: string; hash: string; snapshot: string | null; changedAt: number; changedBy: ChangedBy }
/** 会话工具声明：某会话的工具正在动这个文件。 */
interface Claim { id: string; name?: string; ts: number }
/** 本会话「碰过」该文件的方式（供变更通知里的「上下文提示」用）。 */
type TouchSrc = "read" | "edit" | "bash-read" | "bash-write" | "unknown";
/** 来源强弱：直接读过/改过（read/edit）> 命令里访问过（bash-*）> 旧记录（unknown）。只升不降。 */
const SRC_RANK: Record<TouchSrc, number> = { read: 3, edit: 3, "bash-read": 2, "bash-write": 2, unknown: 1 };
/** 会话碰过的文件（持久化，重启恢复后仍记得）。 */
interface TouchRec { hash: string; ts: number; mtimeMs?: number; size?: number; src?: TouchSrc }
interface TouchStore { id: string; name?: string; cwd: string; updatedAt: number; files: Record<string, TouchRec> }

/** 工具运行中登记的「该工具可能碰过」的路径。 */
interface RegInfo { kind: "read" | "write"; src: TouchSrc; preHash: string | null }
/** 一次工具执行（tool_call → tool_execution_end），用于「自己的改动不通知自己」的抑制与收尾。 */
interface ToolRun { name: string; startedAt: number; suppress: boolean; paths: Map<string, RegInfo>; delegationKey?: string }

/** 一次「委派出去的活」：窗口内被委派会话的改动静默（按会话 id / 名字解析 / 目标目录匹配）。 */
interface Delegation { key: string; name?: string; idPrefix?: string; dir?: string; blocking: boolean; startedAt: number; until: number; lastActivity?: number }

const metaFile = (p: string) => path.join(META_DIR, md5(p) + ".json");
const claimFile = (p: string) => path.join(CLAIM_DIR, md5(p) + ".json");
const touchFile = (sid: string) => path.join(TOUCH_DIR, md5(sid) + ".json");

function readMeta(p: string): MetaRec | null {
  try {
    const rec = JSON.parse(fs.readFileSync(metaFile(p), "utf-8")) as MetaRec;
    return rec && rec.path === p ? rec : null;
  } catch {
    return null;
  }
}
const writeMeta = (p: string, rec: MetaRec) => atomicWrite(metaFile(p), JSON.stringify(rec));

function readClaim(p: string): Claim | null {
  try {
    const c = JSON.parse(fs.readFileSync(claimFile(p), "utf-8")) as Claim;
    if (Date.now() - c.ts <= CLAIM_TTL_MS) return c;
    try { fs.unlinkSync(claimFile(p)); } catch {}
  } catch {}
  return null;
}
const dropClaim = (p: string) => { try { fs.unlinkSync(claimFile(p)); } catch {} };

// ===== VSCode 窗口定位（open_diff 用） =====

interface VSCodeWindow {
  uri: string;      // folder 的 file:// URI（供 --folder-uri 使用）
  folder: string;   // folder 本地路径
  name: string;     // 显示名（basename）
}

/** storage.json 的候选路径（按平台：macOS / Linux / Windows）。 */
function codeStorageCandidates(): string[] {
  const home = os.homedir();
  const list = [
    path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "storage.json"), // macOS
    path.join(home, ".config", "Code", "User", "globalStorage", "storage.json"), // Linux
  ];
  if (process.env.APPDATA) {
    list.push(path.join(process.env.APPDATA, "Code", "User", "globalStorage", "storage.json")); // Windows
  }
  return list;
}

/** 列出当前打开着的 VSCode 窗口（读 windowsState；只含有 folder 的窗口）。 */
function listVSCodeWindows(): VSCodeWindow[] {
  for (const file of codeStorageCandidates()) {
    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      continue;
    }
    const opened: any[] = Array.isArray(data?.windowsState?.openedWindows) ? data.windowsState.openedWindows : [];
    const seen = new Set<string>();
    const out: VSCodeWindow[] = [];
    for (const w of opened) {
      const uri = String(w?.folder ?? "");
      if (!uri.startsWith("file://") || seen.has(uri)) continue;
      seen.add(uri);
      let folder = uri;
      try {
        folder = decodeURIComponent(new URL(uri).pathname);
      } catch {}
      out.push({ uri, folder, name: path.basename(folder) || folder });
    }
    return out;
  }
  return [];
}

/** 在指定 folder 对应的 VSCode 窗口打开 diff（左 = 快照、右 = 当前）。 */
function openDiffInWindow(uri: string, left: string, right: string): Promise<{ ok: boolean; err?: string }> {
  return new Promise((resolve) => {
    try {
      execFile(
        "code",
        ["--folder-uri", uri, "--diff", left, right],
        { timeout: 10000 },
        (err: any, _stdout: any, stderr: any) => {
          if (err) resolve({ ok: false, err: String(stderr || err.message || err) });
          else resolve({ ok: true });
        },
      );
    } catch (e) {
      resolve({ ok: false, err: String(e) });
    }
  });
}

/** 静态路径过滤（不要求文件当前存在——「新增文件」登记时文件还不存在）。 */
function pathEligible(p: string): boolean {
  if (!p || !path.isAbsolute(p)) return false;
  if (!TEXT_EXT.has(path.extname(p).toLowerCase())) return false;
  for (const seg of SKIP_SEGMENTS) if (p.includes(seg)) return false;
  if (p.startsWith(STATE_DIR)) return false;
  return true;
}

function shouldTrack(p: string): boolean {
  if (!pathEligible(p)) return false;
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size <= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

// 解析 `cd` 命令的参数字符串，得出目标目录：先跳过 -P/-L/-- 之类的选项，再取第一个 token
// （支持引号形式）；绝对路径 / ~ 直接采用，相对路径按「执行到此处时的当前目录」解析；
// 无法静态确定（变量、命令替换、`cd -` 等）时返回 null——之后不再登记相对路径。
function resolveCdTarget(raw: string, cur: string | null): string | null {
  let s = raw.trim();
  for (let guard = 0; guard < 5; guard++) {
    const opt = /^(-{1,2}[A-Za-z]+|--)(\s+|$)/.exec(s);
    if (!opt) break;
    s = s.slice(opt[0].length).trim();
  }
  let t: string;
  if (s.startsWith('"') || s.startsWith("'")) {
    const i = s.indexOf(s[0], 1);
    t = i >= 0 ? s.slice(1, i) : s.slice(1);
  } else {
    t = (s.split(/\s/)[0] ?? "").split(/[<>]/)[0];
  }
  if (!t || t === "~") return os.homedir();
  if (t.startsWith("~/")) return path.join(os.homedir(), t.slice(2));
  if (path.isAbsolute(t)) return t;
  if (/[$`(]/.test(t) || t === "-") return null;
  return cur === null ? null : path.resolve(cur, t);
}

// 从 bash 命令文本中解析疑似文件路径。
// 相对路径按命令中实际的 `cd` 目录解析（逐段扫描、跟踪 cd 目标）；绝对路径（含 ~/）不受 cd 影响；
// 当前目录无法静态确定（cd 到变量 / `cd -` / 命令替换等）时，之后的相对路径一律跳过——
// 宁可漏记，也不把相对路径错记到会话工作目录上。2026-10-13 修正：此前一律按会话 cwd 解析，
// `cd /elsewhere && head CHANGELOG.md` 会把 CHANGELOG.md 误记成会话 cwd 下的同名文件，
// 使无关会话收到该文件的变更通知。
function extractPaths(cmd: string, sessionCwd: string): string[] {
  const out = new Set<string>();
  const re = /(?:~|\/)?[\w./~-]+\.(?:md|txt|json|jsonl|py|ts|tsx|js|jsx|mjs|toml|yaml|yml|html|htm|css|scss|sh|bash|zsh|csv|tsv|xml|ini|cfg|conf|env|sql|rs|go|java|c|cpp|h|rb|php|vue|svelte)\b/g;
  let dir: string | null = sessionCwd && path.isAbsolute(sessionCwd) ? sessionCwd : process.cwd();
  for (const seg of cmd.split(/\n|;|&&|\|\||\|/)) {
    const cdM = /^\s*\(?\s*(?:cd|pushd)(?=\s|$)\s*(.*)$/.exec(seg);
    if (cdM) {
      dir = resolveCdTarget(cdM[1] ?? "", dir);
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg))) {
      const p = m[0];
      if (p.startsWith("~/")) out.add(path.join(os.homedir(), p.slice(2)));
      else if (path.isAbsolute(p)) out.add(p);
      else if (dir !== null) out.add(path.resolve(dir, p));
    }
  }
  return [...out];
}

/** 把工具输入里的路径统一解析成绝对路径（相对路径按会话工作目录解析）。 */
function resolvePath(raw: string, sessionCwd: string): string {
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(sessionCwd || process.cwd(), raw);
}

// 从「未知工具」的输入里搜集像文件路径的字符串（保守）：键名带 path/file/dir 的字符串值，或
// 绝对路径 / ~ 开头、且扩展名属于可跟踪文本类型的值。用途：把 MCP 文件写入等自定义工具的
// 改动也归入「自己的改动」、在收尾时静默同步——宁可多登记一点（登记只会静默同步、不产生通知）。
function extractInputPaths(input: unknown, sessionCwd: string): string[] {
  const out = new Set<string>();
  const take = (s: string, key?: string) => {
    const v = s.trim();
    if (!v || v.length > 500 || v.includes("\n")) return;
    if (!((key && /path|file|dir/i.test(key)) || path.isAbsolute(v) || v.startsWith("~/"))) return;
    const cand = resolvePath(v, sessionCwd);
    if (TEXT_EXT.has(path.extname(cand).toLowerCase())) out.add(cand);
  };
  const walk = (v: unknown, key: string | undefined, depth: number) => {
    if (depth > 4 || v === null || v === undefined) return;
    if (typeof v === "string") { take(v, key); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, undefined, depth + 1); return; }
    if (typeof v === "object") { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1); }
  };
  walk(input, undefined, 0);
  return [...out];
}

// ===== 变更通知的「相关性判断」辅助 =====

// 「项目标识文件」——用来定位一个路径属于哪个项目（文件位置的判断依据；
// 相当于用户所称的「项目 schema 文件」：表征项目结构/身份的标记文件）。
const PROJECT_MARKERS = [
  ".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "CLAUDE.md", "AGENTS.md", "pom.xml", "build.gradle", ".hg", ".svn",
];

/** 自 start 目录向上找最近的「项目根」（含任一项目标识文件的目录）；找不到返回 null。 */
function findProjectRoot(start: string): string | null {
  let dir = start;
  for (let guard = 0; guard < 200; guard++) {
    for (const m of PROJECT_MARKERS) {
      try {
        if (fs.existsSync(path.join(dir, m))) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * 生成变更通知里的三行「判断依据」：文件位置 / 上下文提示 / 相关度参考。
 * 判断依据对应三条线索：① 文件名（通知里另有文件路径，调用方自行带上）；② 文件在项目结构中的
 * 位置（这里算出它属于哪个项目、是否本会话当前项目）；③ 本会话此前是否读过它（上下文里有没有
 * 它变更前的内容——由 touched 记录的 src 判断）。
 */
function relevanceFacts(p: string, src: TouchSrc | undefined, cwd: string): { location: string; context: string; hint: string } {
  const fileRoot = findProjectRoot(path.dirname(p));
  const sessRoot = cwd ? findProjectRoot(cwd) : null;
  const sameProject = !!fileRoot && !!sessRoot && fileRoot === sessRoot;
  const insideCwd = !!cwd && (p === cwd || p.startsWith(cwd + path.sep));

  let location: string;
  if (!fileRoot) {
    location = `文件位置：未识别到所属项目（路径向上没有项目标识文件：${PROJECT_MARKERS.slice(0, 5).join(" / ")} 等）`;
  } else if (sameProject) {
    location = `文件位置：属于本会话当前项目（${fileRoot}）${insideCwd ? "、且在会话工作目录内" : "（不在会话工作目录内，但同属一个项目树）"}`;
  } else {
    location = `文件位置：属于项目 ${fileRoot}；本会话当前项目是 ${sessRoot ?? `（未识别，工作目录 ${cwd}）`}`;
  }

  let context: string;
  switch (src) {
    case "read":
      context = "上下文提示：本会话此前直接读过该文件——它变更前的内容可能仍留在你上下文中。";
      break;
    case "edit":
      context = "上下文提示：本会话此前直接编辑过该文件——它变更前的内容可能仍留在你上下文中。";
      break;
    case "bash-read":
      context = "上下文提示：本会话此前只在 shell 命令里访问过该文件——内容未必读进过你的上下文。";
      break;
    case "bash-write":
      context = "上下文提示：本会话此前通过 shell 命令写过该文件——内容可能在你的上下文中。";
      break;
    default:
      context = "上下文提示：未记录到本会话读过该文件——它变更前的内容大概率不在你上下文中。";
  }

  const direct = src === "read" || src === "edit";
  let hint: string;
  if (direct) {
    hint = "相关度参考：中高（本会话用过该文件）——若当前任务仍在处理它，就要读取最新内容。";
  } else if (!sameProject) {
    hint = "相关度参考：偏低（本会话没有直接读过/改过它、且它不在本会话当前项目内）——默认无需处理，除非当前任务明确涉及它。";
  } else {
    hint = "相关度参考：不确定——按下面的判断步骤对照当前任务决定。";
  }

  return { location, context, hint };
}

export default function (pi: ExtensionAPI) {
  let active = false;
  let sessionId = "";
  let sessionCwd = "";
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let latestCtx: any = null; // 最近一次事件的 ctx（轮询里判断「任务是否进行中」用）

  const sessionName = (): string | undefined => {
    try {
      return pi.getSessionName?.() ?? undefined;
    } catch {
      return undefined;
    }
  };
  const whoami = (): ChangedBy => ({ kind: "session", id: sessionId, name: sessionName() ?? sessionId.slice(0, 8) });

  // 会话是否「正在干活」（任务进行中）——agent run / 自动重试 / 自动压缩重试 / 排队续跑期间
  // ctx.isIdle() 为 false；已结束当前回合、等用户（或等外部回信/后台任务）时为 true。
  // 变更通知只发给正在干活的会话；等用户的会话不打扰（2026-10-14 用户立）。
  const isAgentWorking = (): boolean => {
    try {
      return latestCtx ? !latestCtx.isIdle() : false;
    } catch {
      return false;
    }
  };

  // ===== 会话「碰过」的文件：path -> {hash, mtime, size, ts}（自己的已知状态） =====
  const touched = new Map<string, TouchRec>();
  let touchedDirty = false;

  // ===== 工具运行登记（「自己的改动不通知自己」的核心状态） =====
  // 每个正在执行的工具登记：运行期间本会话「可能写文件」的工具在跑 → 检测到的变更视为自己的；
  // 结束时按登记收尾（快照落盘 / 静默同步 / 清扫运行窗口内的变化）。
  const runs = new Map<string, ToolRun>();
  let lastClaimRefresh = 0;
  let bgWindowStart: number | null = null; // 后台任务静默窗口起点（无后台任务时为 null）

  // ===== 委派窗口（agent_call / intercom 把活交给别的会话 → 对方的改动静默，2026-10-15 用户立） =====
  const delegations = new Map<string, Delegation>();
  let idMapAt = 0;                         // intercom 会话表刷新时间
  let idMap = new Map<string, string[]>(); // 小写会话名 -> 会话 id 列表
  let idMapLoading = false;
  const pruneDelegations = () => {
    const now = Date.now();
    for (const [k, d] of delegations) {
      if (now > d.until) { delegations.delete(k); continue; }
      // 见过对方活动后：安静超过 IDLE 窗口即关窗（对方这一波活干完了，恢复常态通知）
      if (d.lastActivity && now - d.lastActivity > DELEGATE_IDLE_MS) delegations.delete(k);
    }
  };
  /** 刷新 intercom 会话表（异步、60 秒节流；用于把委派目标名字解析成会话 id）。 */
  const refreshIdMap = (force = false) => {
    if (idMapLoading || (!force && Date.now() - idMapAt < 60_000)) return;
    if (!fs.existsSync(INTERCOM_BIN)) return;
    idMapLoading = true;
    execFile(INTERCOM_BIN, ["list", "--json"], { timeout: 5000 }, (err: any, stdout: any) => {
      idMapLoading = false;
      if (err) return; // 失败：保留旧表、稍后再试
      try {
        const data = JSON.parse(String(stdout ?? ""));
        const m = new Map<string, string[]>();
        for (const s of data?.sessions ?? []) {
          const n = String(s?.name ?? "").toLowerCase();
          const id = String(s?.id ?? "");
          if (!n || !id) continue;
          m.set(n, [...(m.get(n) ?? []), id]);
        }
        idMap = m;
        idMapAt = Date.now();
      } catch {}
    });
  };
  /** 登记一条委派窗口；返回窗口 key（不是委派 / 缺目标信息时返回 null）。 */
  const registerDelegation = (tool: string, input: any): string | null => {
    const action = String(input.action ?? "").toLowerCase();
    if (tool === "intercom" && !["send", "ask", "handover"].includes(action)) return null; // list / status / reply 等不是委派
    const name = String(input.name ?? input.to ?? "").trim();
    const dirRaw = String(input.dir ?? input.cwd ?? "").trim();
    let dir = "";
    if (dirRaw) {
      dir = resolvePath(dirRaw, sessionCwd);
      try { if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir); } catch {}
    }
    if (!name && !dir) return null;
    const blocking = tool === "intercom" ? action !== "send" : String(input.mode ?? "ask") !== "send";
    const now = Date.now();
    const key = `${name.toLowerCase()}|${dir}`;
    const idLike = /^[0-9a-f]{6,}(-[0-9a-f-]+)?$/i.test(name); // to 直接给了会话 id
    delegations.set(key, {
      key,
      name: name && !idLike ? name : undefined,
      idPrefix: idLike ? name.toLowerCase() : undefined,
      dir: dir || undefined,
      blocking,
      startedAt: now,
      until: now + DELEGATE_MAX_MS,
    });
    refreshIdMap(true); // 预热：对方若已在线，立即把名字解析到 id
    return key;
  };
  /** 这个变更是不是「我委派出去的那批活」产生的？是 → 静默（等对方的完成汇报即可）。 */
  const delegationSilenced = (p: string, changedBy: ChangedBy): boolean => {
    if (delegations.size === 0) return false;
    pruneDelegations();
    if (delegations.size === 0) return false;
    if (changedBy.kind === "session" && changedBy.id === sessionId) return false; // 自己的改动另有层级管
    let unresolved = false;
    const act = Date.now();
    for (const d of delegations.values()) {
      if (d.idPrefix && changedBy.kind === "session" && changedBy.id && changedBy.id.toLowerCase().startsWith(d.idPrefix)) { d.lastActivity = act; return true; }
      if (d.name) {
        const ids = idMap.get(d.name.toLowerCase());
        if (ids && changedBy.kind === "session" && changedBy.id && ids.includes(changedBy.id)) { d.lastActivity = act; return true; }
        if (!ids || ids.length === 0) unresolved = true; // 名字还没解析到（对方刚被唤醒 / 表过期）
      }
      if (d.dir) {
        // 目录兜底：被委派会话没加载本扩展时归属显示「未识别」，只能按目录判断
        const dir = d.dir.endsWith(path.sep) ? d.dir : d.dir + path.sep;
        if (p === d.dir || p.startsWith(dir)) { d.lastActivity = act; return true; }
      }
    }
    if (unresolved) refreshIdMap(); // 还没解析到时稍后重试（60 秒节流）
    return false;
  };
  const anySelfToolRunning = (): boolean => {
    const now = Date.now();
    for (const run of runs.values()) if (run.suppress && now - run.startedAt < RUN_STALE_MS) return true;
    return false;
  };
  const inBgWindow = (): boolean => bgWindowStart !== null && Date.now() - bgWindowStart <= BG_SUPPRESS_MAX_MS;
  const pruneRuns = () => {
    const now = Date.now();
    for (const [id, run] of runs) if (now - run.startedAt > RUN_STALE_MS) runs.delete(id);
  };
  // 长任务期间持续刷新「某会话正在改它」的声明（声明 60 秒过期；20 秒刷一次够用）
  const refreshRunClaims = () => {
    if (runs.size === 0 || Date.now() - lastClaimRefresh < 20_000) return;
    lastClaimRefresh = Date.now();
    for (const run of runs.values()) {
      if (!run.suppress) continue;
      for (const [p, reg] of run.paths) if (reg.kind === "write") writeClaim(p);
    }
  };

  const touchSet = (p: string, hash: string, mtimeMs?: number, size?: number, src?: TouchSrc) => {
    const prev = touched.get(p);
    // 来源只升不降：保留最强的「本会话与它有过来往」信号（直接读 / 改 > 命令访问 > 旧记录未知）
    const nextSrc: TouchSrc =
      src && SRC_RANK[src] >= SRC_RANK[prev?.src ?? "unknown"] ? src : prev?.src ?? "unknown";
    touched.set(p, { hash, ts: Date.now(), mtimeMs, size, src: nextSrc });
    if (touched.size > TOUCH_MAX) {
      let oldest: string | null = null;
      let oldestTs = Infinity;
      for (const [k, v] of touched) {
        if (v.ts < oldestTs) { oldestTs = v.ts; oldest = k; }
      }
      if (oldest) touched.delete(oldest);
    }
    touchedDirty = true;
  };

  const saveTouched = () => {
    if (!touchedDirty || !sessionId) return;
    const data: TouchStore = {
      id: sessionId,
      name: sessionName(),
      cwd: sessionCwd,
      updatedAt: Date.now(),
      files: Object.fromEntries(touched),
    };
    atomicWrite(touchFile(sessionId), JSON.stringify(data));
    touchedDirty = false;
  };

  const loadTouched = () => {
    try {
      const data = JSON.parse(fs.readFileSync(touchFile(sessionId), "utf-8")) as TouchStore;
      for (const [p, rec] of Object.entries(data?.files ?? {})) {
        // 2026-10-14 增：加载时同样过滤——旧登记里的已排除路径（如 tmp/ 采样日志）
        // 直接丢弃，避免重启后仍被轮询检测。
        if (rec && typeof rec.hash === "string" && shouldTrack(p)) touched.set(p, rec);
      }
    } catch {}
  };

  // ===== 共享镜像：文件最近一次已知内容 =====
  const mirrorGet = (p: string): string | null => {
    try {
      return fs.readFileSync(path.join(MIRROR_DIR, md5(p) + ".content"), "utf-8");
    } catch {
      return null;
    }
  };
  const mirrorSet = (p: string, content: string) => {
    atomicWrite(path.join(MIRROR_DIR, md5(p) + ".content"), content);
    atomicWrite(path.join(MIRROR_DIR, md5(p) + ".path"), p);
  };

  // ===== 快照 =====
  const writeSnapshot = (p: string, content: string): string | null => {
    try {
      fs.mkdirSync(SNAP_DIR, { recursive: true });
      const snap = path.join(SNAP_DIR, `${stamp()}-${path.basename(p)}`);
      fs.writeFileSync(snap, content, "utf-8");
      return snap;
    } catch {
      return null;
    }
  };
  const readSnapshot = (snap: string): string | null => {
    try {
      return fs.readFileSync(snap, "utf-8");
    } catch {
      return null;
    }
  };

  // ===== 本轮改动清单：path -> 改动前快照（供 flush 与 open_diff） =====
  const roundChanges = new Map<string, string>();
  const roundSources = new Map<string, TouchSrc>(); // 本轮改动的触碰来源（只升不降，flush 时登记）

  // 最近改动登记（跨轮次，供 open_diff 候选；同文件保留最新快照，新在前）
  const recentChanges: { path: string; snap: string; at: number }[] = [];
  const pushRecent = (p: string, snap: string) => {
    const i = recentChanges.findIndex((r) => r.path === p);
    if (i >= 0) recentChanges.splice(i, 1);
    recentChanges.unshift({ path: p, snap, at: Date.now() });
    if (recentChanges.length > RECENT_MAX) recentChanges.length = RECENT_MAX;
  };

  // ===== 工具侧：改动前快照 / 声明 / 读基线 =====

  /** 采集「改动前快照」：仅在本轮该文件第一次被工具触碰时执行（pre 为登记时已读到的状态，可省一次读取）。 */
  const takeSnapshot = (p: string, src: TouchSrc, pre?: ReadState) => {
    if (roundChanges.has(p)) {
      const prevSrc = roundSources.get(p);
      if (!prevSrc || SRC_RANK[src] > SRC_RANK[prevSrc]) roundSources.set(p, src);
      return;
    }
    const st = pre ?? readState(p);
    if (st.kind !== "content") return;
    roundSources.set(p, src);
    if (mirrorGet(p) === null) {
      // 镜像不存在 → 建立基线（不产生 diff）
      mirrorSet(p, st.text);
      return;
    }
    const snap = writeSnapshot(p, st.text);
    if (snap) roundChanges.set(p, snap);
  };

  /** 工具声明：告诉其他会话「是某个会话在改它」，避免被误标成"用户"。 */
  const writeClaim = (p: string) => {
    if (!sessionId) return;
    atomicWrite(claimFile(p), JSON.stringify({ id: sessionId, name: sessionName(), ts: Date.now() } satisfies Claim));
  };

  /** 「AI 读过该文件」→ 刷新镜像与自己已知状态（基线 = 刚看到的内容）。 */
  const baselineOnRead = (p: string, src: TouchSrc, pre?: ReadState) => {
    const st = pre ?? readState(p);
    if (st.kind !== "content") return;
    mirrorSet(p, st.text);
    const s = statState(p);
    touchSet(p, md5(st.text), s.kind === "file" ? s.mtimeMs : undefined, s.kind === "file" ? s.size : undefined, src);
  };

  /** 登记一个「本工具可能碰过」的路径（解析相对路径；不要求文件已存在，覆盖新增文件）。
   *  写类额外采「改动前快照」+ 写声明；读类刷新读基线。 */
  const registerRunPath = (run: ToolRun, raw: string, kind: "read" | "write", src: TouchSrc) => {
    if (!raw) return;
    const p = resolvePath(raw, sessionCwd);
    if (!pathEligible(p) || run.paths.has(p)) return;
    const st = readState(p);
    const preHash = st.kind === "content" ? md5(st.text) : st.kind === "missing" ? MISSING : null;
    run.paths.set(p, { kind, src, preHash });
    if (kind === "write") {
      takeSnapshot(p, src, st);
      writeClaim(p);
    } else {
      baselineOnRead(p, src, st);
    }
  };

  /** 静默同步：把路径最新状态并入自己已知状态（不通知；writeMetaRec 仅收尾认定「确实变了」时为真）。 */
  const quietSyncPath = (p: string, cur: string | null, hash: string, s: StatState, writeMetaRec: boolean) => {
    if (cur !== null) mirrorSet(p, cur);
    touchSet(p, hash, s.kind === "file" ? s.mtimeMs : undefined, s.kind === "file" ? s.size : undefined);
    if (writeMetaRec && sessionId) {
      const snap = roundChanges.get(p) ?? null;
      writeMeta(p, { path: p, hash, snapshot: snap, changedAt: Date.now(), changedBy: whoami() });
      if (snap && cur !== null && readSnapshot(snap) !== cur) pushRecent(p, snap);
    }
  };

  /** 收尾同步一个路径（工具结束 / 兜底落盘）：镜像 / meta / 自己已知状态 / diff 登记一起处理。
   *  有登记时按 preHash 判断「是否真的变了」——没变就不写 meta（如 touch 之类的空写命令，
   *  避免替早先的外部改动「认领」归属）；无登记（兜底）时退回与快照 / 自己已知状态比较。 */
  const endSyncPath = (p: string, reg?: RegInfo) => {
    const owned = !reg || reg.kind === "write"; // 只有写类登记才动快照（读类可能撞上并行工具的快照）
    const snap = owned ? roundChanges.get(p) ?? null : null;
    const st = readState(p);
    if (st.kind === "skip") return; // 读不了：保留待下次重试（roundChanges 不删）
    const hash = st.kind === "missing" ? MISSING : md5(st.text);
    const prevRec = touched.get(p);
    const changed = reg
      ? reg.preHash === null
        ? reg.kind === "write"
        : reg.preHash !== hash
      : snap !== null || (prevRec !== undefined && prevRec.hash !== hash);
    if (st.kind === "missing" && reg && reg.preHash === MISSING) {
      // 登记时与结束时都不存在（命令文本里提到过、并未产生文件）→ 不值得跟踪
      if (owned) { roundChanges.delete(p); roundSources.delete(p); }
      dropClaim(p);
      return;
    }
    if (st.kind === "content") mirrorSet(p, st.text);
    if (changed && sessionId) {
      writeMeta(p, { path: p, hash, snapshot: snap, changedAt: Date.now(), changedBy: whoami() });
    }
    // 跟踪范围：变了的、读类、此前已在跟踪的、无登记（兜底）——都更新；
    // 只是「出了个名字」、内容没变、此前也未跟踪的写类路径不纳入（避免无关通知）。
    if (changed || !reg || reg.kind === "read" || prevRec !== undefined) {
      const s = statState(p);
      touchSet(p, hash, s.kind === "file" ? s.mtimeMs : undefined, s.kind === "file" ? s.size : undefined,
        reg?.src ?? roundSources.get(p) ?? "edit");
    }
    if (snap && st.kind === "content" && readSnapshot(snap) !== st.text) pushRecent(p, snap);
    if (owned) { roundChanges.delete(p); roundSources.delete(p); }
    dropClaim(p);
  };

  /** 收尾清扫：工具运行窗口内，自己碰过的文件里任何变化都视作本工具所为——静默同步、不通知。
   *  覆盖「脚本写了命令文本里没出现的文件」这类路径不在工具输入里的情况（如构建 / git checkout）。
   *  变更记录明确指向别的会话 / 用户时不吞（留给正常轮询通知）；窗口起点之前就存在的变更
   *  （如休眠期间的用户编辑）也不吞。 */
  const sweepSelfChanges = (since: number) => {
    for (const [p, rec] of [...touched]) {
      const s = statState(p);
      if (s.kind === "skip") continue;
      if (s.kind === "missing") {
        if (rec.hash !== MISSING) quietSyncPath(p, null, MISSING, s, true);
        continue;
      }
      if (s.mtimeMs < since - 2000) continue; // 窗口起点之前的写入：不是自己的改动
      if (rec.hash !== MISSING && rec.mtimeMs === s.mtimeMs && rec.size === s.size) continue;
      const st = readState(p);
      if (st.kind !== "content" || st.text.length > MAX_FILE_BYTES) continue;
      const hash = md5(st.text);
      if (hash === rec.hash) {
        touchSet(p, hash, s.mtimeMs, s.size);
        continue;
      }
      const meta = readMeta(p);
      if (
        meta && meta.hash === hash &&
        (meta.changedBy.kind === "user" || (meta.changedBy.kind === "session" && meta.changedBy.id !== sessionId))
      ) {
        continue; // 记录明确指向别的来源 → 不是自己的改动
      }
      quietSyncPath(p, st.text, hash, s, true);
    }
  };

  // ===== 通知 =====
  const notify = (
    p: string,
    info: { deleted: boolean; snap: string | null; changedBy: ChangedBy; changedAt: number; priorSrc?: TouchSrc },
  ) => {
    const name = info.changedBy.name ?? info.changedBy.id?.slice(0, 8) ?? "未知";
    const who =
      info.changedBy.kind === "session"
        ? `由会话「${name}」修改`
        : info.changedBy.kind === "user"
          ? "由用户修改"
          : "来源未识别";
    const facts = relevanceFacts(p, info.priorSrc, sessionCwd);
    const lines = [
      `【文件变更通知 · ${who}】`,
      `文件：${p}`,
      facts.location,
      facts.context,
      ...(info.deleted ? ["状态：文件已被删除（快照为删除前内容）"] : []),
      ...(info.snap ? [`改动前快照：${info.snap}`] : []),
      `变更时间：${formatTime(info.changedAt)}`,
      ...(info.changedBy.kind === "unknown"
        ? ["变更来源：未识别——不是本会话所为（可能是其它会话，也可能是用户手动改）。"]
        : []),
      facts.hint,
      "—— 先判断当前任务是否需要用到这个文件，再决定读不读（避免无关信息干扰当前任务）——",
      `① 判断依据：文件名（${path.basename(p)}）与当前任务是否相关；文件位置（见上）是否属于当前任务在处理的模块/项目；你上下文中是否已有它变更前的内容（见上「上下文提示」；若上方列了「改动前快照」，它保存了这次变更前的旧版）。`,
      "② 大概率不需要用到它 → 不要读取该文件的新变更内容，也不要因此调整任务方向；本条仅作知晓即可（之后任务真用到该文件时，读取到的自然是最新内容）。",
      "③ 需要用到、或拿不准 → 先重新读取该文件的最新内容，再基于它回答或操作；不要继续沿用旧内容。",
      "④ 若之后要修改该文件 → 先读取最新内容再改（这次变更不是你做的，避免覆盖）。",
    ];
    // 不设 triggerTurn（2026-10-14 去掉）：调用方只在会话「任务进行中」时发送本通知，消息以
    // steer 排队、在下一个 LLM 调用前自然投递；去掉 triggerTurn 是为了彻底关掉通知把空闲会话
    // 唤醒跑一轮的可能（即使时序上恰好空闲，消息也只静静排队、不触发新回合）。
    pi.sendMessage({ customType: "file-change-notify", content: lines.join("\n"), display: true });
  };

  /** 外部变更 → 更新自己已知状态并通知（自己的改动绝不走这里，见 handleChange 的前两层判断）；
   *  通知只发给「任务进行中」的会话（2026-10-14 立）：空闲 / 等用户时不打扰，变更只消化进状态。 */
  const notifyExternal = (
    p: string, cur: string | null, hash: string, s: StatState,
    info: { changedBy: ChangedBy; snap: string | null; changedAt: number },
  ) => {
    if (info.changedBy.kind === "session" && info.changedBy.id === sessionId) return; // 自己的改动绝不通知自己
    if (cur !== null) mirrorSet(p, cur);
    const priorSrc = touched.get(p)?.src; // 变更前本会话与它的来往（通知里给「上下文提示」用）
    touchSet(p, hash, s.kind === "file" ? s.mtimeMs : undefined, s.kind === "file" ? s.size : undefined);
    // 委派窗口内：被委派方（会话 id / 目标目录匹配）的改动静默——等它最终完成的汇报即可
    // （2026-10-15 用户立）；跨会话与用户改动照常通知。
    if (delegationSilenced(p, info.changedBy)) return;
    if (isAgentWorking()) {
      notify(p, { deleted: cur === null, snap: info.snap, changedBy: info.changedBy, changedAt: info.changedAt, priorSrc });
    }
  };

  /** 处理一处变更：先判断「是不是自己的」——自己的（记录指向自己 / 工具在跑 / 后台窗口内）
   *  一律静默同步、不通知；外部来源才归因 + 通知（跨会话知情不受影响）。 */
  const handleChange = (p: string, cur: string | null, hash: string, s: StatState) => {
    const claim = readClaim(p);
    const meta = readMeta(p);
    const metaMatches = !!meta && meta.hash === hash;
    const mine = !!metaMatches && !!meta && meta.changedBy.kind === "session" && meta.changedBy.id === sessionId;
    const external = !!metaMatches && !!meta && !mine &&
      (meta.changedBy.kind === "user" || (meta.changedBy.kind === "session" && meta.changedBy.id !== sessionId));

    // ① 记录明确指向外部（别的会话 / 用户）→ 外部变更，照常走通知
    if (external && meta) {
      notifyExternal(p, cur, hash, s, { changedBy: meta.changedBy, snap: meta.snapshot, changedAt: meta.changedAt });
      return;
    }

    // ② 自己的改动——记录指向自己、自己的工具正在跑（含长任务；声明持续刷新、不再过期）、
    //    或自己发起的后台任务窗口内 → 静默同步，不通知自己（2026-10-15 用户立规）
    if (mine || (claim && claim.id === sessionId) || anySelfToolRunning() || inBgWindow()) {
      quietSyncPath(p, cur, hash, s, false);
      return;
    }

    // ③ 非自己的变更：记录为「未识别」→ 用记录的归属与快照；首次发现 → 补记（快照取自镜像
    //    旧内容；归因不明时用中性来源——不默认写成「用户」，实践中大部分是其它会话改的）→ 通知
    let changedBy: ChangedBy;
    let snap: string | null;
    let changedAt: number;
    if (metaMatches && meta) {
      changedBy = meta.changedBy;
      snap = meta.snapshot;
      changedAt = meta.changedAt;
    } else {
      const old = mirrorGet(p);
      snap = old !== null && old.length <= MAX_FILE_BYTES ? writeSnapshot(p, old) : null;
      changedBy = claim ? { kind: "session", id: claim.id, name: claim.name } : { kind: "unknown" };
      changedAt = Date.now();
      writeMeta(p, { path: p, hash, snapshot: snap, changedAt, changedBy });
    }
    notifyExternal(p, cur, hash, s, { changedBy, snap, changedAt });
  };

  // ===== 轮询：检测「自己碰过的文件」发生的一切变更（用户 / 其它会话） =====
  const poll = () => {
    if (!active) return;
    pruneRuns();
    refreshRunClaims();
    pruneDelegations();
    if (delegations.size > 0) {
      // 委派目标名字还没解析到 id 时持续重试（60 秒节流）——对方刚被唤醒、会话表里还没出现
      for (const d of delegations.values()) {
        if (d.name && !(idMap.get(d.name.toLowerCase())?.length)) { refreshIdMap(); break; }
      }
    }
    for (const [p, rec] of [...touched]) {
      const s = statState(p);
      if (s.kind === "skip") continue;
      if (s.kind === "missing") {
        if (rec.hash !== MISSING) handleChange(p, null, MISSING, s);
        continue;
      }
      // 快速路径：mtime + size 都没变 → 内容没变，跳过读取
      if (rec.hash !== MISSING && rec.mtimeMs === s.mtimeMs && rec.size === s.size) continue;
      const st = readState(p);
      if (st.kind !== "content") continue; // 读不了：下轮再试
      if (st.text.length > MAX_FILE_BYTES) continue;
      const hash = md5(st.text);
      if (hash === rec.hash) {
        // 内容其实没变（只是 mtime 变了）→ 刷新 stat 缓存即可
        touchSet(p, hash, s.mtimeMs, s.size);
        continue;
      }
      handleChange(p, st.text, hash, s);
    }
    saveTouched();
  };

  // ===== 事件：工具调用（运行登记 / 改动前快照 / 声明 / 读基线） =====
  pi.on("tool_call", async (event: any) => {
    if (!active) return;
    const name = String(event.toolName ?? "");
    const input = event.input || {};
    try {
      if (name === "read") {
        // 只读工具：刷新读基线即可（不建运行登记——读不会改文件，其期间的变化一律视为外部）
        const p = String(input.path ?? "");
        if (p) {
          const abs = resolvePath(p, sessionCwd);
          if (shouldTrack(abs)) baselineOnRead(abs, "read");
        }
        return;
      }
      const toolCallId = String(event.toolCallId ?? "");
      if (!toolCallId) return;
      const run: ToolRun = { name, startedAt: Date.now(), suppress: !READONLY_TOOLS.has(name), paths: new Map() };
      runs.set(toolCallId, run);
      if (DELEGATE_TOOLS.has(name)) {
        // 委派类工具：记一条「委派窗口」——窗口内被委派方的改动静默（2026-10-15 用户立）
        const key = registerDelegation(name, input);
        if (key) run.delegationKey = key;
        return; // 委派工具本身不改文件：不进行变更登记 / 收尾清扫
      }
      if (!run.suppress) return; // 只读工具（open_diff / background_list 等）：不登记、不抑制、不清扫

      if (name === "write" || name === "edit") {
        // 工具输入里的 path（相对路径按会话工作目录解析；不要求文件已存在——覆盖「新增文件」）
        const p = String(input.path ?? "");
        if (p) registerRunPath(run, p, "write", "edit");
      } else if (name === "bash" || name === "background_run") {
        const cmd = String(input.command ?? "");
        if (cmd) {
          // 判定「纯读」要严格：命令里出现写类命令（cp/mv/sed/tee/重定向…）就按写处理——
          // 复合命令（如 `cp a b && diff a b`）里一个 `diff` 字样曾让整条命令被误判为只读，
          // 导致写动作没登记快照/声明，自己改自己的文件还会收到误报（2026-10-12 实测）。
          // 关键词判定 2026-10-15 收紧：词后不允许跟 `.`——`npx prettier --write a.md` 里的
          // 文件名曾让 `\bfile\b` 命中、把写命令误判成只读（读基线 → 写入后轮询误报）。
          const cleaned = cmd
            .replace(/2\s*>>?\s*\/dev\/null/g, "")
            .replace(/2>&1/g, "")
            .replace(/>>?\s*\/dev\/null/g, "");
          const hasWriteHint = /(^|[\s;&|])(cp|mv|rm|sed|tee|touch|mkdir|ln|dd|truncate|chmod|chown|install|patch|tar|unzip)\b|>>?/.test(cleaned);
          const isReadCmd = !hasWriteHint && /(^|[\s;&|()])(cat|head|tail|less|more|grep|rg|wc|stat|ls|diff|file)(?![\w.])/.test(cmd);
          for (const p of extractPaths(cmd, sessionCwd)) {
            if (!pathEligible(p)) continue;
            if (isReadCmd) registerRunPath(run, p, "read", "bash-read");
            else registerRunPath(run, p, "write", "bash-write");
          }
        }
      } else {
        // 未知 / 自定义工具（MCP 等）：输入里像路径的字符串也登记（保守；登记只做静默同步、不产生通知）
        for (const p of extractInputPaths(input, sessionCwd)) {
          if (pathEligible(p)) registerRunPath(run, p, "write", "edit");
        }
      }
    } catch {}
  });

  // ===== 事件：工具结束（收尾登记路径 + 清扫窗口内变化 → 自己改动不通知自己、其它会话及时感知） =====
  pi.on("tool_execution_end", async (event: any) => {
    if (!active) return;
    const toolCallId = String(event?.toolCallId ?? "");
    const run = toolCallId ? runs.get(toolCallId) : undefined;
    if (toolCallId) runs.delete(toolCallId);
    try {
      if (!run) {
        // 未登记（旧事件形态 / tool_call 缺失）：兜底把遗留快照落盘
        if (roundChanges.size > 0 && sessionId) for (const p of [...roundChanges.keys()]) endSyncPath(p);
        return;
      }
      if (run.delegationKey) {
        // 委派窗口收尾：报错（对方没连上等）→ 撤销；阻塞式（ask / handover）→ 只保留一段
        // 尾随窗口；send（不等回复）→ 保持原窗口（对方可能还在干，截至窗口上限）
        const d = delegations.get(run.delegationKey);
        if (d) {
          if (event?.isError) delegations.delete(run.delegationKey);
          else if (d.blocking) d.until = Math.min(d.until, Date.now() + DELEGATE_GRACE_MS);
        }
        return;
      }
      if (!run.suppress) return; // 只读工具：其期间的变化一律视为外部，不收尾
      for (const [p, reg] of run.paths) endSyncPath(p, reg);
      // 清扫：运行窗口内自己碰过的文件里任何变化（脚本写文件等路径不在工具输入里的情况）
      // 一并静默并入自己已知状态——自己的改动不通知自己。
      sweepSelfChanges(run.startedAt);
    } catch {}
  });

  // ===== 事件：一轮结束（兜底落盘 + 运行登记收尾） =====
  pi.on("agent_end", async () => {
    if (!active) return;
    try {
      for (const p of [...roundChanges.keys()]) endSyncPath(p);
      // 运行登记兜底清理：正常已由 tool_execution_end 清掉；防止事件丢失导致「抑制」泄漏
      for (const run of runs.values()) {
        if (!run.suppress) continue;
        for (const [p] of run.paths) dropClaim(p);
        sweepSelfChanges(run.startedAt); // 残留登记的写入也要扫掉，防止之后误报给自己
      }
      runs.clear();
      saveTouched();
    } catch {}
  });

  // ===== 工具与命令：open_diff / close_diff（/open-diff、/close-diff 可直接键入） =====
  // 2026-10-18 增：打开 / 关闭各配一个工具（供 AI 按需调用）与一个用户命令（直接键入，不绕模型）。
  // 关闭走「请求 + 确认」协议与 VSCode 侧组件 diff-view-vsce 协作，机制见文件头改造说明。

  /** 打开 diff 的完整流程（选文件 → 选窗口 → 差异预检 → 确认 → 打开）：open_diff 工具与 /open-diff 命令共用。 */
  async function runOpenDiffFlow(params: { path?: string }, ctx: any): Promise<string> {
    if (!ctx?.hasUI) {
      return "当前会话没有可交互界面（需要 TUI 会话），无法进行选择与授权，未打开。";
    }

    // 候选：最近登记（跨轮）+ 进行中本轮（优先），去重、新在前
    const merged = new Map<string, { path: string; snap: string; at: number }>();
    for (const r of recentChanges) if (!merged.has(r.path)) merged.set(r.path, r);
    for (const [p, snap] of roundChanges) merged.set(p, { path: p, snap, at: Date.now() });
    const candidates = [...merged.values()].sort((a, b) => b.at - a.at);
    if (candidates.length === 0) {
      return "最近没有记录到可查看的改动（每个文件需先有一次「改动前快照」）。";
    }

    // ① 选文件
    let target: { path: string; snap: string; at: number };
    const wanted = params.path ? path.resolve(ctx.cwd, params.path) : "";
    if (wanted) {
      const hit = candidates.find((c) => c.path === wanted);
      if (!hit) return `该文件不在最近的改动记录中：${wanted}`;
      target = hit;
    } else if (candidates.length === 1) {
      target = candidates[0]!;
    } else {
      const labels = candidates.map((c) => `${path.basename(c.path)} — ${c.path}`);
      const pick = await ctx.ui.select("打开哪个文件的 diff？（左：改动前快照 / 右：当前内容）", labels);
      if (!pick) return "已取消。";
      target = candidates[labels.indexOf(pick)]!;
    }

    // ② 列窗口（确保有可用的目标窗口）
    const windows = listVSCodeWindows();
    if (windows.length === 0) {
      return "未发现打开着工作区文件夹的 VSCode 窗口，无法定位打开位置。";
    }
    let win = windows[0]!;
    if (windows.length > 1) {
      const counts = new Map<string, number>();
      for (const w of windows) counts.set(w.name, (counts.get(w.name) ?? 0) + 1);
      const labels = windows.map((w) => ((counts.get(w.name) ?? 0) > 1 ? `${w.name} — ${w.folder}` : w.name));
      const pick = await ctx.ui.select("在哪个 VSCode 窗口打开 diff？", labels);
      if (!pick) return "已取消。";
      win = windows[labels.indexOf(pick)]!;
    }

    // ③ 差异预检（无差异 / 文件不可读时提前返回，不打扰用户）
    const current = (() => { try { return fs.readFileSync(target.path, "utf-8"); } catch { return null; } })();
    if (current === null) {
      return `目标文件当前无法读取（可能已删除）：${target.path}`;
    }
    const snapContent = readSnapshot(target.snap);
    if (snapContent !== null && snapContent === current) {
      return "当前内容与改动前快照一致（无差异），未打开窗口。";
    }

    // ④ 用户确认授权
    const ok = await ctx.ui.confirm(
      "打开 diff 视图？",
      `窗口：${win.name}（${win.folder}）\n文件：${target.path}\n左：改动前快照 / 右：当前内容`,
    );
    if (!ok) return "已取消（未获授权，未打开）。";

    // ⑤ 打开
    const res = await openDiffInWindow(win.uri, target.snap, target.path);
    if (!res.ok) return `打开失败：${res.err}`;
    return `已在窗口「${win.name}」打开 ${path.basename(target.path)} 的 diff 视图。`;
  }

  /** 清理过期的关闭请求 / 确认文件（没人处理时也不会无限堆积）。 */
  function gcCloseFiles() {
    const cutoff = Date.now() - CLOSE_FILE_KEEP_MS;
    for (const dir of [CLOSE_REQ_DIR, CLOSE_ACK_DIR]) {
      try {
        for (const f of fs.readdirSync(dir)) {
          try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f)); } catch {}
        }
      } catch {}
    }
  }

  /**
   * 请求关闭 diff 视图：写请求文件 → 等 VSCode 侧 diff-view-vsce 处理并回写确认（最多约 2 秒）。
   * @param paths 要关闭的文件（绝对路径）；空数组 = 关闭全部由本扩展打开过的 diff。
   * @returns 给用户看的说明文字（成功 / 未收到确认 / 失败）。
   */
  async function requestCloseDiff(paths: string[]): Promise<string> {
    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    try {
      fs.mkdirSync(CLOSE_REQ_DIR, { recursive: true });
      fs.writeFileSync(path.join(CLOSE_REQ_DIR, `${id}.json`), JSON.stringify({ id, ts: Date.now(), paths }), "utf-8");
    } catch (e) {
      return `写入关闭请求失败：${String(e)}`;
    }
    // 等确认：首个确认到达后再给 400ms 收其它窗口的确认；总上限 2 秒
    const hardUntil = Date.now() + 2000;
    let graceUntil = 0;
    let closed = 0;
    let acks = 0;
    const seen = new Set<string>();
    while (Date.now() < (graceUntil || hardUntil)) {
      try {
        for (const f of fs.readdirSync(CLOSE_ACK_DIR)) {
          if (!f.endsWith(".json") || !f.startsWith(id) || seen.has(f)) continue;
          seen.add(f);
          acks += 1;
          try {
            const a = JSON.parse(fs.readFileSync(path.join(CLOSE_ACK_DIR, f), "utf-8"));
            closed += Number(a?.closed) || 0;
          } catch {}
          if (!graceUntil) graceUntil = Date.now() + 400;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    gcCloseFiles();
    if (acks === 0) {
      let installed = false;
      try { installed = fs.readdirSync(VSCODE_EXT_DIR).some((d) => d.startsWith("xhqing.diff-view-vsce")); } catch {}
      return installed
        ? "关闭请求已发出，但未收到 VSCode 侧确认——diff-view-vsce 可能尚未生效（安装 / 更新后需在 VSCode 中重载窗口再试）。"
        : "关闭请求已发出，但没有窗口响应——VSCode 侧组件 diff-view-vsce 未安装（装好并重载窗口后即可用）。";
    }
    return `已关闭 ${closed} 个 diff 标签（${acks} 个 VSCode 窗口响应）。`;
  }

  pi.registerTool({
    name: "open_diff",
    label: "打开改动 Diff",
    description:
      "打开某个「AI 改动过文件」的 diff 视图（改动前快照 ↔ 当前内容），在用户指定的 VSCode 窗口中打开。" +
      "打开前会询问用户：选择文件（候选多于一个时）、选择目标 VSCode 窗口（窗口多于一个时），并经用户确认授权后才执行。" +
      "本扩展默认不会自动打开任何 diff——只在用户要求查看时由本工具按需打开。",
    promptSnippet: "Open the pre-edit vs current diff of a recently edited file in a user-chosen VSCode window (asks the user first)",
    promptGuidelines: [
      "Use open_diff when the user asks to view or open the diff of recent edits (e.g. 「打开刚才改动的 diff」「看看你改了什么」). Do not call it when no edit was recorded or the user has not asked.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "要查看 diff 的文件路径（绝对路径或相对当前目录）；省略时列出最近改动的文件供用户选择。" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return { content: [{ type: "text", text: await runOpenDiffFlow(params, ctx) }] };
    },
  });

  pi.registerTool({
    name: "close_diff",
    label: "关闭改动 Diff",
    description:
      "关闭由本扩展（open_diff / /open-diff）打开过的 diff 视图（VSCode 标签页）。不指定 path 时关闭全部；" +
      "只关闭「左 = 改动前快照」的 diff 标签——不会碰用户自己开的对比视图与普通编辑器。" +
      "依赖 VSCode 侧组件 diff-view-vsce，经「请求 + 确认」协议执行（最多等 2 秒）。",
    promptSnippet: "Close diff views previously opened by open_diff in VSCode (delegates to the diff-view-vsce helper extension)",
    promptGuidelines: [
      "Use close_diff when the user asks to close diff views (e.g. 「把 diff 关掉」「关闭刚才打开的 diff」). It only closes diffs opened by this extension, never user-opened comparison views.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "只关闭该文件的 diff（绝对路径或相对当前目录）；省略时关闭全部由本扩展打开的 diff。" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const paths = params.path ? [path.resolve(ctx.cwd, params.path)] : [];
      return { content: [{ type: "text", text: await requestCloseDiff(paths) }] };
    },
  });

  // 用户命令（2026-10-18 增）：直接键入 /open-diff、/close-diff 执行，不绕模型。
  pi.registerCommand("open-diff", {
    description: "打开最近改动的 diff（选文件与 VSCode 窗口，确认后打开）",
    handler: async (args: string, ctx: any) => {
      const text = await runOpenDiffFlow({ path: args?.trim() || undefined }, ctx);
      try { ctx?.ui?.notify?.(text, "info"); } catch {}
    },
  });
  pi.registerCommand("close-diff", {
    description: "关闭由 pi 打开的 diff 标签（VSCode 侧 diff-view-vsce 执行）",
    handler: async (args: string, ctx: any) => {
      const paths = args?.trim() ? [path.resolve(ctx?.cwd ?? process.cwd(), args.trim())] : [];
      const text = await requestCloseDiff(paths);
      try { ctx?.ui?.notify?.(text, "info"); } catch {}
    },
  });

  // ===== 事件总线：后台任务窗口（与 background-tasks 扩展联动） =====
  // background_run 起的后台进程在「工具窗口之外」写文件——运行期间经 pi.events 的
  // `agent-wait-banner:activity` 得知；窗口内检测到的变更视作自己后台任务所写，静默同步。
  // 上限 BG_SUPPRESS_MAX_MS：超过即恢复正常通知（避免长驻后台任务把通知能力长期关掉）。
  try {
    pi.events.on("agent-wait-banner:activity", (data: any) => {
      try {
        if (!data || data.source !== "background-tasks") return;
        if (data.active) {
          if (bgWindowStart === null) bgWindowStart = Date.now();
        } else if (bgWindowStart !== null) {
          // 全部后台任务结束：窗口内最后一次轮询间隙的变化也一并静默同步（仅窗口未超上限时）
          if (Date.now() - bgWindowStart <= BG_SUPPRESS_MAX_MS) sweepSelfChanges(bgWindowStart);
          bgWindowStart = null;
        }
      } catch {}
    });
  } catch {}

  pi.on("session_start", async (_event: any, ctx: any) => {
    if (active) return;
    active = true;
    try { sessionId = String(ctx?.sessionManager?.getSessionId?.() ?? ""); } catch {}
    if (!sessionId) sessionId = `pid-${process.pid}`;
    try { sessionCwd = String(ctx?.cwd ?? process.cwd()); } catch {}
    latestCtx = ctx ?? null; // 保存 ctx：轮询检测到变更时用 ctx.isIdle() 判断会话是否「任务进行中」
    for (const d of [MIRROR_DIR, SNAP_DIR, META_DIR, TOUCH_DIR, CLAIM_DIR, CLOSE_REQ_DIR, CLOSE_ACK_DIR]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch {}
    }
    // 轻量 GC：清掉超过保留期的旧快照（meta 里的老引用已无意义）
    try {
      const cutoff = Date.now() - SNAP_KEEP_MS;
      for (const f of fs.readdirSync(SNAP_DIR)) {
        const full = path.join(SNAP_DIR, f);
        try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch {}
      }
    } catch {}
    loadTouched();
    // 立即跑一轮：恢复会话时把「缺席期间」的变更消化进已知状态；此刻会话还没开始任务
    // （等用户输入），检测到变更也不发通知（2026-10-14 起）
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  });

  pi.on("session_shutdown", async () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    saveTouched();
    roundChanges.clear();
    roundSources.clear();
    recentChanges.length = 0;
    runs.clear();
    delegations.clear();
    bgWindowStart = null;
    latestCtx = null;
    active = false;
  });
}
