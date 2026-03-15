# AI 模型下载指南

## 📦 模型文件说明

本应用使用三个本地 AI 模型，总大小约 1.3GB：

### 1. 文档向量化模型 (EMBEDDING)
- **文件名**: `bge-micro-v2.onnx`
- **大小**: 22 MB
- **用途**: 文档语义分析和去重
- **推荐**: ⭐⭐⭐⭐⭐ (必装)

### 2. 图片理解模型 (CLIP)
- **文件名**: `clip-vit-b-32.onnx`
- **大小**: 150 MB
- **用途**: 图片内容理解和跨模态搜索
- **推荐**: ⭐⭐⭐⭐ (建议安装)

### 3. 语言模型 (LLM)
- **文件名**: `qwen2.5-1.5b-instruct-q4_k_m.gguf`
- **大小**: 1.1 GB
- **用途**: 智能文件分类和分析
- **推荐**: ⭐⭐⭐ (可选，需要较大内存)

## 🚀 自动下载（推荐）

1. 打开应用
2. 切换到 **"设置"** 标签页
3. 在 **"AI 模型管理"** 区域点击 **"下载"** 按钮
4. 等待下载完成（显示进度条）
5. 下载完成后会自动加载模型

## 📥 手动下载

如果自动下载失败，可以手动下载模型文件并放到 `models` 文件夹。

### 方法一：ModelScope（阿里云）

```bash
# 文档向量化模型
curl -L https://modelscope.cn/api/v1/models/iic/bge-micro-v2/repo?Revision=master&FilePath=model.onnx -o models/bge-micro-v2.onnx

# 图片理解模型
curl -L "https://modelscope.cn/api/v1/models/damo/cv_vit-base-patch32_image-multimodal-embedding/repo?Revision=master&FilePath=model.onnx" -o models/clip-vit-b-32.onnx

# 语言模型
curl -L "https://modelscope.cn/api/v1/models/qwen/Qwen2.5-1.5B-Instruct-GGUF/repo?Revision=master&FilePath=qwen2.5-1.5b-instruct-q4_k_m.gguf" -o models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

### 方法二：HuggingFace

```bash
# 文档向量化模型
curl -L https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx -o models/bge-micro-v2.onnx

# 图片理解模型
curl -L https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx -o models/clip-vit-b-32.onnx

# 语言模型
curl -L https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf -o models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

### 方法三：浏览器下载

1. 访问以下链接下载模型文件
2. 将下载的文件重命名为正确的名称
3. 放入 `models` 文件夹

**下载链接：**
- [bge-micro-v2.onnx](https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx) (22MB)
- [clip-vit-b-32.onnx](https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx) (150MB)
- [qwen2.5-1.5b-instruct-q4_k_m.gguf](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf) (1.1GB)

## 📁 文件结构

```
rerere/
├── models/
│   ├── bge-micro-v2.onnx          # 文档向量化模型
│   ├── clip-vit-b-32.onnx         # 图片理解模型
│   └── qwen2.5-1.5b-instruct-q4_k_m.gguf  # 语言模型
├── src/
├── index.html
└── ...
```

## ✅ 验证安装

1. 打开应用
2. 切换到 **"设置"** 标签页
3. 查看 **"AI 模型管理"** 区域
4. 已安装的模型会显示 **"已安装"** 状态
5. 点击 **"加载"** 按钮可以加载模型到内存

## 🔧 故障排除

### 问题：下载速度慢或失败

**解决方案：**
1. 尝试切换镜像源（应用会自动尝试）
2. 使用手动下载方式
3. 检查网络连接
4. 关闭代理软件

### 问题：模型文件损坏

**解决方案：**
1. 删除 `models` 文件夹中的对应文件
2. 重新下载

### 问题：内存不足

**解决方案：**
1. 只安装必需的模型（至少安装 EMBEDDING）
2. 在设置中选择适合的 AI 模式
3. 关闭其他占用内存的程序

## 💡 提示

- 首次使用建议只安装 **EMBEDDING** 模型（22MB），体验基础功能
- 如果需要处理大量图片，再安装 **CLIP** 模型
- **LLM** 模型较大，仅在需要智能分析时安装
- 已下载的模型可以离线使用，无需重复下载
