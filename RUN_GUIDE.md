# 🚀 智能文件整理助手 - 运行指南

## 📋 系统要求

- **Node.js**: v14 或更高版本
- **npm**: 随 Node.js 一起安装
- **操作系统**: Windows 10/11, macOS, Linux

---

## 🔧 安装步骤

### Windows 用户（推荐）

#### 方法一：使用 winget（最快）

```powershell
winget install OpenJS.NodeJS
```

#### 方法二：官网下载安装

1. 访问 [https://nodejs.org/](https://nodejs.org/)
2. 下载 LTS（长期支持）版本
3. 运行安装程序，一路下一步即可
4. 安装完成后重启终端

### macOS 用户

```bash
# 使用 Homebrew
brew install node

# 或从官网下载
# https://nodejs.org/
```

### Linux 用户

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup-lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup-lts.x | sudo bash -
sudo yum install -y nodejs
```

---

## ✅ 验证安装

安装完成后，在终端运行：

```bash
node --version
npm --version
```

如果显示版本号，说明安装成功！

---

## 🎯 运行应用

### 方式一：双击运行（推荐）

直接双击项目根目录的 `run.bat` 文件

### 方式二：命令行启动

1. 打开命令提示符或 PowerShell
2. 进入项目目录：
   ```bash
   cd "k:\AI soft\rerere"
   ```
3. 运行应用：
   ```bash
   npm start
   ```

---

## 🛠️ 首次使用

1. **选择目录**: 点击"选择目录"按钮，选择要扫描的文件夹
2. **开始扫描**: 点击"开始扫描"按钮
3. **查找重复**: 点击"查找重复文件"按钮
4. **查看结果**: 
   - 检查文件时间显示（年月日 时分秒）
   - 查看图片缩略图预览
   - 悬停播放视频预览
5. **清理文件**: 选择要删除的重复文件，点击"删除选中文件"

---

## 🎨 新功能演示

### 📅 完整时间显示
- ✅ 修改时间：2026-03-14 15:30:45
- ✅ 创建时间：2026-03-14 15:30:45

### 🖼️ 图片预览
- 自动显示 300x300 缩略图
- 点击"查看图片"用系统默认应用打开
- 支持：JPG, PNG, GIF, BMP, WebP, ICO

### 🎬 视频预览
- 显示视频封面（第一帧）
- 鼠标悬停自动播放（静音循环）
- 点击"播放视频"用系统播放器打开
- 支持：MP4, AVI, MKV, MOV, WMV, FLV, WebM

### 📋 简洁界面
- 移除了文件类型图标
- 只显示必要的文件信息
- 更清爽的视觉体验

---

## 🐛 常见问题

### Q: 提示"找不到 Node.js"
A: 请按照上面的安装步骤安装 Node.js，然后重新运行 `run.bat`

### Q: 图片缩略图无法显示
A: 确保已安装 sharp 依赖：
```bash
npm install sharp
```

### Q: 视频无法播放
A: 视频预览需要系统有相应的解码器。如果无法播放，可以点击"打开文件位置"手动打开。

### Q: 应用启动失败
A: 尝试以下步骤：
1. 删除 `node_modules` 文件夹
2. 运行 `npm install` 重新安装依赖
3. 再次运行 `npm start`

---

## 📞 技术支持

如果遇到其他问题，请：
1. 检查控制台错误信息
2. 查看项目的 README.md 文档
3. 联系开发者反馈

---

## 📝 更新日志

**v1.1.0 (2026-03-14)**
- ✅ 修复文件创建时间显示问题
- ✅ 修复图片缩略图加载问题
- ✅ 移除不必要的文件类型图标
- ✅ 新增视频文件预览功能
- ✅ 优化重复文件比对界面

---

**祝您使用愉快！** 🎉
