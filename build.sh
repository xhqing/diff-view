#!/usr/bin/env bash
# diff-view 构建脚本：产出唯一发布产物 —— 一个 zip，内含两个组件、共用项目 VERSION 版本号
#   dist/diff-view-<version>.zip
#     ├── diff-view-vsce-<version>.vsix   —— VS Code 侧扩展
#     └── diff-view.ts                    —— pi 侧扩展（部署名固定为 diff-view.ts）
# 版本号唯一权威：项目根 VERSION；构建前先校验 diff-view-vsce/package.json 与它一致。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VER="$(tr -d '[:space:]' < VERSION)"
PKG_VER="$(node -p "require('./diff-view-vsce/package.json').version")"
if [ "$VER" != "$PKG_VER" ]; then
  echo "版本号不一致：VERSION=$VER，diff-view-vsce/package.json=$PKG_VER（以 VERSION 为准，先修齐再构建）" >&2
  exit 1
fi

DIST="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$DIST"
rm -f "$DIST/diff-view-"*.zip

echo "==> 构建 diff-view-vsce-$VER.vsix（VS Code 侧）"
(cd diff-view-vsce && npx --yes @vscode/vsce package --out "$STAGE/diff-view-vsce-$VER.vsix" >/dev/null)

echo "==> 打包 dist/diff-view-${VER}.zip（vsix + pi 侧 diff-view.ts，共用版本号 ${VER}）"
cp diff-view-pie/diff-view.ts "$STAGE/diff-view.ts"
(cd "$STAGE" && zip -q -j "$DIST/diff-view-$VER.zip" "diff-view-vsce-$VER.vsix" "diff-view.ts")

echo "完成："
ls -lh "$DIST"
