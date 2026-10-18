'use strict';
// diff-bridge — pi「改动可视化」（pi 扩展 ai-edit-diff）的 VSCode 侧助手。
//
// 职责：轮询 pi 写下的关闭请求（~/.pi/agent/state/ai-edit-diff/close-requests/），
// 把 pi 的 `/close-diff`（或 AI 工具 close_diff）落实为「静默关闭由 pi 打开的 diff 标签」，
// 并把关闭数量回写为确认（close-acks/），供 pi 侧汇总回报用户。
//
// 安全边界：只关闭「左侧 = pi 改动前快照」（state/ai-edit-diff/snapshots/ 下的文件）的
// diff 标签——用户自己开的对比视图与普通编辑器一概不动；关闭时 preserveFocus，不抢焦点。
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isUnder, pathFilterMatches, parseRequest, isFresh } = require('./lib/util');

const STATE_DIR = process.env.AI_EDIT_DIFF_STATE_DIR || path.join(os.homedir(), '.pi/agent/state/ai-edit-diff');
const SNAP_DIR = path.join(STATE_DIR, 'snapshots');
const REQ_DIR = path.join(STATE_DIR, 'close-requests');
const ACK_DIR = path.join(STATE_DIR, 'close-acks');

const POLL_MS = 1000;                 // 请求轮询间隔
const REQ_VALID_MS = 30 * 1000;       // 请求有效期：超过不再执行（陈旧请求可能误关后来新开的标签）
const REQ_KEEP_MS = 120 * 1000;       // 请求文件保留期：到期删除（多窗口各自轮询，不立即删以免别的窗口错过）
const ACK_KEEP_MS = 10 * 60 * 1000;   // 确认文件保留期

let output = null; // OutputChannel：排障用（命令面板 → Output: Focus on Output View → diff-bridge）

function log(msg) {
  try { if (output) output.appendLine(`[${new Date().toISOString()}] ${msg}`); } catch {}
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
}

/** 是否本扩展负责的 diff 标签（file 协议，且左侧是 pi 的改动前快照）。 */
function isBridgedDiffTab(tab) {
  const input = tab && tab.input;
  if (!(input instanceof vscode.TabInputTextDiff)) return false;
  const original = input.original;
  if (!original || original.scheme !== 'file') return false;
  return isUnder(SNAP_DIR, original.fsPath);
}

/** 关闭匹配的 diff 标签，返回关闭数量；paths 为空 = 全部由 pi 打开的 diff。 */
async function closeBridgedDiffs(paths) {
  const targets = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!isBridgedDiffTab(tab)) continue;
      const modified = tab.input.modified && tab.input.modified.fsPath;
      if (!pathFilterMatches(paths, modified)) continue;
      targets.push(tab);
    }
  }
  let closed = 0;
  for (const tab of targets) {
    try { await vscode.window.tabGroups.close(tab, true); closed += 1; } catch (e) { log(`关闭失败：${e}`); }
  }
  return closed;
}

/** 一轮轮询：处理新请求（执行关闭 + 回写确认）并清理过期文件。processed：本窗口已处理的请求文件名。 */
async function tick(processed) {
  let entries;
  try { entries = fs.readdirSync(REQ_DIR); } catch { return; } // 目录不存在（pi 未用过）→ 无事可做

  const now = Date.now();
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(REQ_DIR, f);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (now - st.mtimeMs > REQ_KEEP_MS) { try { fs.unlinkSync(full); } catch {} continue; }
    if (!isFresh(st.mtimeMs, now, REQ_VALID_MS)) continue; // 陈旧请求：等保留期到后删除
    if (processed.has(f)) continue;
    processed.add(f);

    let req = null;
    try { req = parseRequest(fs.readFileSync(full, 'utf-8')); } catch {}
    if (!req) continue;

    const closed = await closeBridgedDiffs(req.paths);
    log(`请求 ${req.id}：关闭 ${closed} 个 diff 标签（窗口：${vscode.workspace.name || '(无工作区)'}）`);
    try {
      fs.mkdirSync(ACK_DIR, { recursive: true });
      atomicWrite(
        path.join(ACK_DIR, `${req.id}-${process.pid}.json`),
        JSON.stringify({ id: req.id, closed, ts: Date.now(), window: vscode.workspace.name || null, pid: process.pid }),
      );
    } catch (e) { log(`确认写入失败：${e}`); }
  }

  // 确认文件清理（pi 侧拿到后也会清；这里是无人认领时的兜底）
  try {
    for (const f of fs.readdirSync(ACK_DIR)) {
      const full = path.join(ACK_DIR, f);
      try { if (now - fs.statSync(full).mtimeMs > ACK_KEEP_MS) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}

function activate(context) {
  output = vscode.window.createOutputChannel('diff-bridge');
  context.subscriptions.push(output);

  const processed = new Set();
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // 上一轮未完（正常不会）→ 跳过，不重入
    running = true;
    tick(processed)
      .catch(() => {})
      .finally(() => { running = false; });
  }, POLL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // 手动兜底：命令面板执行（或排障用）
  context.subscriptions.push(vscode.commands.registerCommand('diffBridge.closeAll', async () => {
    const n = await closeBridgedDiffs([]);
    vscode.window.setStatusBarMessage(`diff-bridge：已关闭 ${n} 个 pi diff 标签`, 3000);
  }));

  log(`已启动（state: ${STATE_DIR}）`);
}

function deactivate() {}

module.exports = { activate, deactivate, isBridgedDiffTab, closeBridgedDiffs };
