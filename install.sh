#!/usr/bin/env bash
# diff-view 安装脚本：把 pi 扩展部署到全局扩展目录。
#   - 部署副本：~/.pi/agent/extensions/diff-view.ts
#   - 生效方式：新会话自动加载；已打开的会话在 pi 里执行 /reload
#   - 卸载：删掉上面那个文件即可（面板登记在 ~/.pi/agent/state/cmux-diff/，可一并删除）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.pi/agent/extensions/diff-view.ts"
CLI_DEST="$HOME/.local/bin/diff-report"

mkdir -p "$(dirname "$DEST")"
cp "$ROOT/diff-view.ts" "$DEST"

# 命令行工具：读扩展落盘的轮次报告，不跑 pi、不触发会话
mkdir -p "$(dirname "$CLI_DEST")"
install -m 0755 "$ROOT/scripts/diff-report" "$CLI_DEST"

echo "已部署：$DEST"
echo "已部署：$CLI_DEST"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "⚠️  $HOME/.local/bin 不在 PATH 里，直接敲 diff-report 会找不到，需要把它加进 PATH。" ;;
esac
echo "新会话自动生效；已打开的 pi 会话执行 /reload 后生效。"
echo
echo "用法："
echo "  /open-diff                 打开当前仓库的 diff（有 last-turn 基线用 last turn，否则 unstaged）"
echo "  /open-diff staged          指定来源（last-turn / unstaged / staged / branch）"
echo "  /open-diff ~/Developer/x   打开指定仓库的 diff"
echo "  /close-diff                关闭本会话打开的面板"
echo "  /close-diff --all          关闭所有会话打开的面板"
echo "  /diff-report               把上一轮 AI 改了什么贴进会话（默认不自动贴）"
echo "  /diff-report head          改看「工作区相对 HEAD 的全量未提交改动」"
echo "  /diff-report on|off        切换每轮结束是否自动贴"
echo
echo "命令行（不经过 pi，随时可敲）： diff-report [--repo <路径>] [--all] [--json] [--since]"
