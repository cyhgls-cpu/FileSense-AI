#!/bin/bash
# 手动创建 GitHub Release 并上传打包文件

VERSION=${1:-v1.0.0}
REPO="cyhgls-cpu/FileSense-AI"

echo "========================================"
echo "  FileSense AI Release 创建工具"
echo "  版本: $VERSION"
echo "========================================"
echo ""

# 检查是否安装了 gh CLI
if ! command -v gh &> /dev/null; then
    echo "错误: 需要安装 GitHub CLI (gh)"
    echo "安装: https://cli.github.com/"
    exit 1
fi

# 检查是否登录
if ! gh auth status &> /dev/null; then
    echo "错误: 请先登录 GitHub CLI"
    echo "运行: gh auth login"
    exit 1
fi

echo "步骤 1: 下载最新的 Artifact..."
echo ""

# 创建临时目录
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# 下载 Artifact
echo "下载 Windows 构建..."
gh run download --repo "$REPO" --name "windows-build" --dir "$TEMP_DIR/windows" 2>/dev/null || echo "  Windows Artifact 暂不可用"

echo "下载 macOS 构建..."
gh run download --repo "$REPO" --name "macos-build" --dir "$TEMP_DIR/macos" 2>/dev/null || echo "  macOS Artifact 暂不可用"

echo "下载 Linux 构建..."
gh run download --repo "$REPO" --name "linux-build" --dir "$TEMP_DIR/linux" 2>/dev/null || echo "  Linux Artifact 暂不可用"

echo ""
echo "步骤 2: 创建 Release..."
echo ""

# 收集所有文件
FILES=""
for dir in windows macos linux; do
    if [ -d "$TEMP_DIR/$dir" ]; then
        for file in "$TEMP_DIR/$dir"/*; do
            if [ -f "$file" ]; then
                FILES="$FILES$file "
            fi
        done
    fi
done

if [ -z "$FILES" ]; then
    echo "错误: 没有找到任何构建文件"
    echo "请确保 GitHub Actions 打包已完成"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "找到以下文件:"
for file in $FILES; do
    echo "  - $(basename "$file")"
done
echo ""

# 创建 Release
echo "创建 Release $VERSION..."
gh release create "$VERSION" \
    --repo "$REPO" \
    --title "FileSense AI $VERSION" \
    --notes "## FileSense AI $VERSION

### 下载
- Windows: 下载 .exe 文件
- macOS: 下载 .zip 文件
- Linux: 下载 .AppImage 文件

### 安装说明
详见 [README.md](https://github.com/$REPO#安装使用)" \
    $FILES

echo ""
echo "========================================"
echo "  Release 创建成功!"
echo "  访问: https://github.com/$REPO/releases/tag/$VERSION"
echo "========================================"

# 清理
rm -rf "$TEMP_DIR"
