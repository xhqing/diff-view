#!/usr/bin/env bash
# diff-view 安装脚本：把 pi 扩展部署到全局扩展目录。
#   - 部署副本：~/.pi/agent/extensions/diff-view.ts
#   - 生效方式：新会话自动加载；已打开的会话在 pi 里执行 /reload
#   - 卸载：删掉上面那个文件即可（面板登记在 ~/.pi/agent/state/cmux-diff/，可一并删除）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.pi/agent/extensions/diff-view.ts"

mkdir -p "$(dirname "$DEST")"
cp "$ROOT/diff-view.ts" "$DEST"

echo "已部署：$DEST"
echo "新会话自动生效；已打开的 pi 会话执行 /reload 后生效。"
echo
echo "用法："
echo "  /open-diff                 打开当前仓库的 diff（有 last-turn 基线用 last turn，否则 unstaged）"
echo "  /open-diff staged          指定来源（last-turn / unstaged / staged / branch）"
echo "  /open-diff ~/Developer/x   打开指定仓库的 diff"
echo "  /close-diff                关闭本会话打开的面板"
echo "  /close-diff --all          关闭所有会话打开的面板"
