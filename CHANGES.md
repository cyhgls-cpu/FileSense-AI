# 重复文件功能修复说明

## ✅ 已完成的修复

### 1. 文件时间显示修复

**问题**: 修改时间、创建时间都显示"未知"

**原因**: 
- 后端只保存了 `modifiedTime`，没有保存 `createdTime`
- 日期对象没有转换为字符串格式

**修复**:
- 在 `src/main.js` 的 `scanDirectory` 函数中，同时保存 `mtime` 和 `birthtime`
- 将 Date 对象转换为 ISO 字符串：`stats.mtime.toISOString()` 和 `stats.birthtime.toISOString()`
- 前端 `formatDate` 函数已经能正确处理 ISO 字符串

**修改文件**:
- `src/main.js:113-114`

---

### 2. 图片预览功能修复

**问题**: 图片预览不能正确显示

**原因**: 
- 缩略图加载逻辑可能存在时序问题
- onerror 处理不够完善

**修复**:
- 保持现有的 sharp 缩略图生成逻辑
- 改进前端缩略图加载，确保在 DOM 渲染后加载
- 添加错误处理，加载失败时隐藏 img 元素

**修改文件**:
- `index.html:1637-1662` (缩略图加载逻辑)
- `src/main.js:335-351` (sharp 缩略图生成)

---

### 3. 移除软件和文档类型显示

**问题**: 软件和文档类型不需要显示特殊图标

**修复**:
- 移除了重复组标题中的文件类型图标显示
- 不再调用 `getFileTypeIcon()` 函数显示在标题中
- 保留了文件路径和大小信息

**修改前**:
```html
<span>📋 重复组 #1 · 🖼️ image.jpg</span>
```

**修改后**:
```html
<span>📋 重复组 #1 · image.jpg</span>
```

**修改文件**:
- `index.html:1580`

---

### 4. 视频预览功能

**新增**: 支持常见视频格式的预览播放

**实现**:
- 添加 `isVideoFile()` 函数检测视频文件
- 在重复组中嵌入 `<video>` 元素
- 鼠标悬停时自动播放预览
- 添加"播放视频"按钮，点击使用系统默认播放器打开

**支持的视频格式**:
- MP4, AVI, MKV, MOV, WMV, FLV, WebM

**新增函数**:
```javascript
function isVideoFile(filePath) {
  const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];
  return videoExts.includes(path.extname(filePath).toLowerCase().slice(1));
}

function previewVideo(videoPath) {
  ipcRenderer.invoke('open-file', videoPath);
}
```

**修改文件**:
- `index.html:1339-1347` (新增 isVideoFile 函数)
- `index.html:1574-1633` (视频预览 UI)
- `index.html:1710-1713` (previewVideo 函数)

---

## 🎯 使用说明

### 图片文件
- **缩略图预览**: 自动显示 300x300 缩略图
- **全屏查看**: 点击"查看图片"按钮，使用系统默认图片查看器打开
- **支持的格式**: JPG, JPEG, PNG, GIF, BMP, WebP, ICO

### 视频文件
- **缩略图预览**: 显示视频第一帧作为封面
- **悬停预览**: 鼠标移到缩略图上自动播放（静音循环）
- **全屏播放**: 点击"播放视频"按钮，使用系统默认播放器打开
- **支持的格式**: MP4, AVI, MKV, MOV, WMV, FLV, WebM

### 其他文件
- **时间信息**: 显示修改时间和创建时间（精确到秒）
- **文件操作**: 可以打开文件位置、删除副本

---

## 📝 技术细节

### 后端修改 (src/main.js)

```javascript
// 扫描文件时保存完整的时间信息
files.push({
  path: fullPath,
  name: entry.name,
  size: stats.size,
  extension: ext,
  modifiedTime: stats.mtime.toISOString(),    // 修改时间
  createdTime: stats.birthtime.toISOString()  // 创建时间
});
```

### 前端修改 (index.html)

1. **时间格式化** - 已有的 `formatDate` 函数可以正确处理 ISO 字符串
2. **缩略图加载** - 使用 IPC 调用后端的 sharp 生成服务
3. **视频预览** - HTML5 video 标签，支持悬停播放

---

## 🔍 测试建议

1. **时间显示测试**:
   - 扫描包含不同创建/修改时间的文件
   - 验证时间是否正确显示（包括秒数）

2. **图片预览测试**:
   - 准备各种格式的图片文件
   - 验证缩略图是否正常显示
   - 点击查看图片是否能用系统默认应用打开

3. **视频预览测试**:
   - 准备 MP4、AVI 等格式的视频
   - 验证悬停时是否自动播放
   - 点击"播放视频"是否能打开系统播放器

4. **混合类型测试**:
   - 创建包含图片、视频、文档的重复文件组
   - 验证每种类型的显示和预览功能

---

## 🐛 已知限制

1. **视频缩略图**: 目前直接显示视频第一帧，如果需要更精美的封面，可以使用 ffmpeg 提取关键帧
2. **大文件预览**: 超大图片或视频（>1GB）可能加载较慢
3. **网络路径**: UNC 路径的文件可能无法生成缩略图

---

## 📦 依赖要求

- **Sharp**: 用于图片缩略图生成 (`npm install sharp`)
- **Electron**: 文件操作和系统集成
- **Node.js**: v14 或更高版本

---

## 🔄 更新日志

**2026-03-14**
- ✅ 修复文件创建时间显示问题
- ✅ 修复图片缩略图加载问题
- ✅ 移除不必要的文件类型图标显示
- ✅ 新增视频文件预览功能
- ✅ 优化重复文件比对界面
