#!/bin/bash
# FileSense AI Linux 打包脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

VERSION=$(node -p "require('./package.json').version")

echo "========================================"
echo "  FileSense AI Linux 打包工具"
echo "  版本: $VERSION"
echo "========================================"
echo ""

echo "📦 正在打包 Linux 版本..."
echo ""

# AppImage (通用格式，绿色版)
echo "📱 正在生成 AppImage (通用绿色版)..."
npx electron-builder --linux AppImage --x64
echo "✅ AppImage 生成完成"
echo ""

# DEB 包 (Debian/Ubuntu)
echo "📦 正在生成 DEB 安装包..."
npx electron-builder --linux deb --x64
echo "✅ DEB 包生成完成"
echo ""

# RPM 包 (Fedora/RHEL/CentOS)
echo "📦 正在生成 RPM 安装包..."
npx electron-builder --linux rpm --x64
echo "✅ RPM 包生成完成"
echo ""

# TAR.GZ (绿色压缩包)
echo "🗜️  正在生成 TAR.GZ 绿色压缩包..."
npx electron-builder --linux tar.gz --x64
echo "✅ TAR.GZ 生成完成"
echo ""

echo "========================================"
echo "  Linux 打包完成！"
echo "========================================"
echo ""
echo "生成的文件:"
echo "  • FileSense-AI-$VERSION-Linux-AppImage-x64.AppImage  (通用绿色版，双击运行)"
echo "  • FileSense-AI-$VERSION-Linux-deb-x64.deb            (Debian/Ubuntu 安装包)"
echo "  • FileSense-AI-$VERSION-Linux-rpm-x64.rpm            (Fedora/RHEL 安装包)"
echo "  • FileSense-AI-$VERSION-Linux-tar.gz-x64.tar.gz      (绿色压缩包)"
echo ""
echo "输出目录: ./dist/"
echo ""
echo "使用说明:"
echo "  • AppImage: 赋予执行权限后双击运行"
echo "              chmod +x *.AppImage"
echo "  • DEB: sudo dpkg -i *.deb"
echo "  • RPM: sudo rpm -i *.rpm"
echo "  • TAR.GZ: 解压后运行 filesense-ai"
echo ""
