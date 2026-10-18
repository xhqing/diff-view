#!/usr/bin/env bash
# diff-view 安装脚本：安装两个组件 —— 都装才是完整功能
#   1) diff-view-pie  —— pi 侧扩展：拷贝部署到 ~/.pi/agent/extensions/diff-view.ts（新会话或 pi 里 /reload 生效）
#   2) diff-view-vsce —— VS Code 侧扩展：打包 vsix 并安装（含旧身份 xhqing.diff-bridge 的卸载与残留清理；装完需重载 VSCode 窗口）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> [1/2] 安装 diff-view-pie（pi 侧扩展）"
mkdir -p "$HOME/.pi/agent/extensions"
cp "$ROOT/diff-view-pie/diff-view.ts" "$HOME/.pi/agent/extensions/diff-view.ts"
echo "    已部署：~/.pi/agent/extensions/diff-view.ts（新会话或 /reload 后生效）"

echo "==> [2/2] 安装 diff-view-vsce（VS Code 侧扩展）"
cd "$ROOT/diff-view-vsce"

# 旧身份（diff-bridge）与旧版本：先卸载、再清残留目录与 contribution 缓存（防历史版本污染）
code --uninstall-extension xhqing.diff-bridge >/dev/null 2>&1 || true
rm -rf "$HOME/.vscode/extensions/xhqing.diff-bridge-"* 2>/dev/null || true
rm -rf "$HOME/Library/Application Support/Code/CachedExtensionVSIXs/xhqing.diff-bridge"* 2>/dev/null || true
code --uninstall-extension xhqing.diff-view-vsce >/dev/null 2>&1 || true
rm -rf "$HOME/.vscode/extensions/xhqing.diff-view-vsce-"* 2>/dev/null || true
rm -rf "$HOME/Library/Application Support/Code/CachedExtensionVSIXs/xhqing.diff-view-vsce"* 2>/dev/null || true

# 打包并安装（extension 目录内自带 README / LICENSE，vsce 自动读取）
npx --yes @vscode/vsce package --out diff-view-vsce.vsix >/dev/null
code --install-extension ./diff-view-vsce.vsix --force

echo "    已安装：xhqing.diff-view-vsce"
echo
echo "完成。请在 VS Code 里重载窗口（命令面板 → Developer: Reload Window），两个组件都生效后即为完整功能。"
