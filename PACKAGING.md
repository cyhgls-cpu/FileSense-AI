# FileSense AI 打包指南

## 📦 打包文件输出位置

打包完成后，文件将生成在 `dist/` 目录中。

## 🪟 Windows 打包

### 环境要求
- Windows 10/11
- Node.js 18+
- Python 3.x
- Visual Studio 2022 (包含 "Desktop development with C++" 工作负载)
- 或 Visual Studio Build Tools

### 安装 Visual Studio Build Tools
```bash
# 使用 Chocolatey 安装
choco install visualstudio2022buildtools
choco install visualstudio2022-workload-vctools
```

### 打包命令
```bash
# 安装依赖
npm install

# 打包所有 Windows 版本
npm run build:win

# 或运行脚本
.\scripts\build-windows.bat
```

### 输出文件
| 文件 | 说明 |
|------|------|
| `FileSense-AI-1.0.0-Windows-Setup-x64.exe` | 安装程序 |
| `FileSense-AI-1.0.0-Windows-Portable-x64.exe` | 绿色便携版 |
| `FileSense-AI-1.0.0-Windows-x64.zip` | ZIP 压缩包 |

---

## 🍎 macOS 打包

### 环境要求
- macOS 12+
- Xcode Command Line Tools
- Node.js 18+

### 安装依赖
```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 安装 Node.js
brew install node
```

### 打包命令
```bash
# 安装依赖
npm install

# 打包所有 macOS 版本
bash scripts/build-macos.sh
```

### 输出文件
| 文件 | 说明 |
|------|------|
| `FileSense-AI-1.0.0-macOS-Installer-x64.dmg` | Intel 安装包 |
| `FileSense-AI-1.0.0-macOS-Installer-arm64.dmg` | Apple Silicon 安装包 |
| `FileSense-AI-1.0.0-macOS-x64.zip` | Intel 绿色版 |
| `FileSense-AI-1.0.0-macOS-arm64.zip` | Apple Silicon 绿色版 |

---

## 🐧 Linux 打包

### 环境要求
- Ubuntu 20.04+ / Fedora 35+ / Debian 11+
- Node.js 18+

### 安装依赖 (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y nodejs npm build-essential
```

### 安装依赖 (Fedora)
```bash
sudo dnf install -y nodejs npm gcc-c++ make
```

### 打包命令
```bash
# 安装依赖
npm install

# 打包所有 Linux 版本
bash scripts/build-linux.sh
```

### 输出文件
| 文件 | 说明 |
|------|------|
| `FileSense-AI-1.0.0-Linux-AppImage-x64.AppImage` | 通用绿色版 |
| `FileSense-AI-1.0.0-Linux-deb-x64.deb` | Debian/Ubuntu 安装包 |
| `FileSense-AI-1.0.0-Linux-rpm-x64.rpm` | Fedora/RHEL 安装包 |
| `FileSense-AI-1.0.0-Linux-tar.gz-x64.tar.gz` | 绿色压缩包 |

---

## 🔧 常见问题

### 1. sqlite3 编译失败
**问题**: `node-gyp rebuild` 失败
**解决**: 
```bash
# Windows: 安装 Visual Studio Build Tools
# macOS: 安装 Xcode Command Line Tools
# Linux: 安装 build-essential 或 gcc-c++

# 或使用预编译版本
npm install sqlite3 --build-from-source=false
```

### 2. Electron 下载慢
**解决**: 配置镜像源
```bash
# 临时使用
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build

# 永久配置
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 3. 代码签名错误 (Windows)
**问题**: `cannot execute winCodeSign`
**解决**: 以管理员身份运行 PowerShell 或 CMD

### 4. 权限不足 (macOS/Linux)
**解决**:
```bash
sudo chmod +x scripts/build-macos.sh
sudo chmod +x scripts/build-linux.sh
```

---

## 📋 快速打包脚本

### 全平台打包 (需要对应系统)
```bash
# 在每个系统上分别运行

# Windows (管理员 PowerShell)
.\scripts\build-windows.bat

# macOS
bash scripts/build-macos.sh

# Linux
bash scripts/build-linux.sh
```

### 使用 GitHub Actions 自动打包
项目可以配置 GitHub Actions 在推送时自动打包所有平台版本。

---

## 📦 打包体积优化

当前配置已优化：
- ✅ 不包含 AI 模型文件 (`.gguf`, `.bin`)
- ✅ 不包含开发依赖
- ✅ 使用 ASAR 压缩

预计体积：
- Windows: ~150-200 MB
- macOS: ~180-220 MB
- Linux: ~160-200 MB

用户首次运行时需要在设置页面下载 AI 模型。
