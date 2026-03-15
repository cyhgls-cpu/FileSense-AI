# 模型下载问题解决方案

## ❌ 当前问题

**错误信息**: `下载失败：Error invoking remote method 'download-model': [object Object]`

**原因分析**: 
1. HuggingFace/ModelScope 下载链接可能无法访问
2. 网络环境问题（需要代理）
3. 错误对象没有正确处理

## ✅ 解决方案

### 方案一：使用命令行工具下载（推荐）

```bash
# 运行快速测试工具
test-download.bat

# 或运行完整下载工具
download-models.bat
```

### 方案二：手动下载（最可靠）

#### 1. 使用浏览器下载

访问以下链接下载模型文件：

**文档向量化模型 (22MB)**:
- [HuggingFace - bge-micro-v2](https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx)
- 下载后重命名为：`models/bge-micro-v2.onnx`

**图片理解模型 (150MB)**:
- [HuggingFace - clip-vit-b-32](https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx)
- 下载后重命名为：`models/clip-vit-b-32.onnx`

**语言模型 (1.1GB)**:
- [HuggingFace - Qwen2.5-1.5B](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf)
- 下载后重命名为：`models/qwen2.5-1.5b-instruct-q4_k_m.gguf`

#### 2. 使用 Git 克隆

```bash
# 克隆到 models 文件夹
cd models
git lfs install
git clone https://huggingface.co/BAAI/bge-micro-v2 embedding-temp
move embedding-temp\model.onnx bge-micro-v2.onnx
rmdir /s /q embedding-temp
```

#### 3. 使用 IDM 等下载工具

复制上面的 HuggingFace 链接到下载工具，可以断点续传。

### 方案三：配置代理

如果您有代理服务器，可以设置环境变量：

```bash
set HTTPS_PROXY=http://127.0.0.1:7890
node download-models-cli.js
```

或在 PowerShell 中：
```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
node download-models-cli.js
```

## 🔧 调试步骤

### 1. 测试网络连接

```bash
# 测试能否访问 HuggingFace
curl -I https://huggingface.co
```

如果返回 `HTTP/2 200` 说明可以访问。

### 2. 使用测试工具

```bash
test-download.bat
```

这个工具会：
- 测试连接到 HuggingFace
- 下载最小的模型（22MB）
- 显示详细的进度和速度
- 给出明确的错误信息

### 3. 查看详细日志

应用启动时添加 `--dev` 参数打开开发者工具：
```bash
start.bat --dev
```

然后在控制台查看下载相关的日志。

## 📊 常见错误及解决方法

| 错误代码 | 含义 | 解决方法 |
|---------|------|---------|
| **404** | 文件不存在 | 检查 URL 是否正确 |
| **401/403** | 未授权/禁止访问 | 需要代理或认证 |
| **ETIMEDOUT** | 连接超时 | 检查网络或使用代理 |
| **ENOTFOUND** | 域名解析失败 | 检查 DNS 设置 |
| **ECONNRESET** | 连接被重置 | 网络不稳定，重试 |

## 💡 最佳实践

1. **首次安装建议**:
   - 只安装必需的模型（EMBEDDING - 22MB）
   - 使用命令行工具下载（可以看到详细进度）
   - 下载完成后重启应用

2. **网络环境差的用户**:
   - 使用浏览器手动下载（支持断点续传）
   - 使用 IDM 等下载工具
   - 找朋友拷贝已下载的模型文件

3. **企业用户**:
   - 可能需要配置公司代理
   - 联系 IT 部门开放 HuggingFace 域名
   - 考虑离线安装包

## 🎯 快速验证

下载完成后，验证模型文件：

```bash
# Windows
dir models\*.onnx
dir models\*.gguf

# 应该看到:
# bge-micro-v2.onnx (22MB)
# clip-vit-b-32.onnx (150MB)
# qwen2.5-1.5b-instruct-q4_k_m.gguf (1.1GB)
```

然后在应用中：
1. 打开"设置"标签页
2. 查看"AI 模型管理"
3. 已安装的模型会显示"已安装"状态
4. 点击"加载"按钮即可使用

## 📞 获取帮助

如果仍然无法下载：
1. 查看 `MODEL_DOWNLOAD_GUIDE.md` 详细指南
2. 运行 `test-download.bat` 获取详细错误信息
3. 检查应用的开发者工具控制台日志

## 🚀 推荐流程

```
1. 先尝试应用内下载 ← 当前步骤
   ↓ 失败？
2. 运行 test-download.bat 诊断
   ↓ 失败？
3. 使用 download-models.bat 命令行下载
   ↓ 失败？
4. 浏览器手动下载（最可靠）
   ↓ 完成！
5. 重启应用，加载模型
```

记住：**手动下载是最可靠的方式**，不受网络波动影响！
