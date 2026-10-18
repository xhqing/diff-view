'use strict';
// 纯逻辑（不依赖 vscode 模块）：路径判断与请求解析——便于在 Node 里直接跑单测。
const path = require('path');

/** p 是否位于 dir 之下（含 dir 本身）。 */
function isUnder(dir, p) {
  if (!dir || !p) return false;
  const d = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return p === dir || p.startsWith(d);
}

/** 请求里的 paths（绝对路径数组）是否匹配目标文件：空数组（或缺失）= 匹配全部。 */
function pathFilterMatches(filter, filePath) {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  return !!filePath && filter.includes(filePath);
}

/** 解析请求体：合法则返回 {id, ts, paths}，否则 null。 */
function parseRequest(text) {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o.id !== 'string' || !o.id) return null;
    return {
      id: o.id,
      ts: Number(o.ts) || 0,
      paths: Array.isArray(o.paths) ? o.paths.filter((p) => typeof p === 'string') : [],
    };
  } catch {
    return null;
  }
}

/** 请求是否仍在有效期内（避免陈旧请求误关窗口后来新开的标签）。 */
function isFresh(ts, now, validMs) {
  return now - (Number(ts) || 0) <= validMs;
}

module.exports = { isUnder, pathFilterMatches, parseRequest, isFresh };
