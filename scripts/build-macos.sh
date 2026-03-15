#!/bin/bash
# FileSense AI macOS 打包脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

VERSION=$(node -p "require('./package.json').version")

echo "========================================"
echo "  FileSense AI macOS 打包工具"
echo "  版本: $VERSION"
echo "========================================"
echo ""

echo "📦 正在打包 macOS 版本..."
echo ""

# DMG 安装包 (Intel)
echo "🔧 正在生成 DMG 安装包 (Intel x64)..."
npx electron-builder --mac dmg --x64
echo "✅ Intel 版本 DMG 生成完成"
echo ""

# DMG 安装包 (Apple Silicon)
echo "🔧 正在生成 DMG 安装包 (Apple Silicon arm64)..."
npx electron-builder --mac dmg --arm64
echo "✅ Apple Silicon 版本 DMG 生成完成"
echo ""

# ZIP 绿色版 (Intel)
echo "🗜️  正在生成 ZIP 绿色版 (Intel x64)..."
npx electron-builder --mac zip --x64
echo "✅ Intel 版本 ZIP 生成完成"
echo ""

# ZIP 绿色版 (Apple Silicon)
echo "🗜️  正在生成 ZIP 绿色版 (Apple Silicon arm64)..."
npx electron-builder --mac zip --arm64
echo "✅ Apple Silicon 版本 ZIP 生成完成"
echo ""

echo "========================================"
echo "  macOS 打包完成！"
echo "========================================"
echo ""
echo "生成的文件:"
echo "  • FileSense-AI-$VERSION-macOS-Installer-x64.dmg    (Intel 安装包)"
echo "  • FileSense-AI-$VERSION-macOS-Installer-arm64.dmg  (Apple Silicon 安装包)"
echo "  • FileSense-AI-$VERSION-macOS-x64.zip              (Intel 绿色版)"
echo "  • FileSense-AI-$VERSION-macOS-arm64.zip            (Apple Silicon 绿色版)"
echo ""
echo "输出目录: ./dist/"
echo ""
