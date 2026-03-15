# FileSense AI (灵析) - 功能详解

## 概述

通过引入本地 AI 引擎，软件从传统的"清理工具"跃升为**"智能文件管家"**。所有 AI 功能均在本地运行，无需联网，保护隐私。

---

## 一、三层 AI 架构

### 1.1 轻量级 Embedding (文档语义去重)

**模型**: BAAI/bge-micro-v2 (22MB)  
**用途**: 将文档内容转换为 384 维向量，实现语义级去重  
**速度**: 毫秒级向量化  
**内存**: <50MB

#### 功能特性

```
传统哈希比对: "这两个文件内容完全一样"
↓
AI 语义比对："这两份合同虽然格式不同，但核心条款相同"
```

**支持场景**:
- ✅ 同一文档的不同格式（.docx vs .pdf）
- ✅ 代码文件的微小修改
- ✅ 文章的不同版本
- ✅ 翻译后的对照文本

#### 使用示例

```javascript
// 向量化文档
const vector = await ipcRenderer.invoke('embed-document', text);

// 计算相似度
const similarity = await ipcRenderer.invoke(
  'calculate-similarity', 
  vector1, 
  vector2
);

if (similarity > 0.95) {
  console.log('语义重复！');
}
```

---

### 1.2 中等 CLIP (图片跨模态理解)

**模型**: CLIP-ViT-B-32 (150MB)  
**用途**: 理解图片内容，支持自然语言搜索  
**速度**: 秒级预处理  
**内存**: ~200MB

#### 功能特性

```
用户输入："找出所有发票截图"
    ↓
AI 理解：识别图片中的文字、版式、内容
    ↓
返回结果：所有包含发票特征的图片
```

**支持场景**:
- ✅ 自然语言搜图："风景照"、"含人物的照片"
- ✅ 模糊匹配："模糊的照片"、"夜景"
- ✅ 内容识别："合同扫描件"、"产品照片"
- ✅ 相似图片检测（即使格式不同）

#### 使用示例

```javascript
// 提取图片特征
const vector = await ipcRenderer.invoke('encode-image', imagePath);

// 文本搜索图片
const results = await ipcRenderer.invoke(
  'search-images',
  '发票和收据',
  imageVectors
);

// 返回最相似的 Top 10
results.forEach(r => {
  console.log(`相似度：${r.score.toFixed(3)}, 图片：${r.path}`);
});
```

---

### 1.3 按需 LLM (智能差异分析)

**模型**: Qwen2.5-1.5B INT4 (1.1GB 量化)  
**用途**: 理解文件内容，生成智能分析报告  
**速度**: 分钟级分析（取决于文件大小）  
**内存**: <1.5GB（量化后）

#### 功能特性

```
用户上传："比较这两个合同文件"
    ↓
LLM 阅读：理解两个文件的完整内容
    ↓
智能报告：
  - 主要差异点列表
  - 是否为重复文件
  - 建议保留哪个版本
```

**支持场景**:
- ✅ 合同版本对比
- ✅ 代码审查
- ✅ 论文查重
- ✅ 报告差异分析

#### 使用示例

```javascript
const analysis = await ipcRenderer.invoke('analyze-diff', {
  name: '合同 v1.docx',
  preview: '本合同由甲方...'
}, {
  name: '合同 v2.docx',
  preview: '本合同由甲方...（有修改）'
});

console.log(analysis.summary);
console.log('建议:', analysis.recommendation);
```

---

## 二、AI 模式选择

### 2.1 四种预设模式

| 模式 | 功能 | 内存 | 适用场景 |
|------|------|------|---------|
| 🚀 **完全 AI** | Embedding + CLIP + LLM | ~2GB | 高端电脑，需要全部智能功能 |
| ⚖️ **平衡** | Embedding + CLIP | ~200MB | 主流电脑，日常使用 |
| 💨 **极速** | 仅 Embedding | ~50MB | 老旧电脑，快速扫描 |
| 🐢 **基础** | 无 AI，仅哈希 | <10MB | 极低配置，最快扫描 |

### 2.2 自动硬件探测

软件启动时自动检测：

```javascript
{
  cpu: "Intel i7-12700H (14 核)",
  memory: { total: 32768, available: 28000 }, // MB
  gpu: "NVIDIA RTX 3060",
  instructions: ["AVX", "AVX2"],
  recommendedMode: "FULL_AI" // 自动推荐
}
```

**推荐逻辑**:

```
可用内存 >= 8GB + AVX2 → FULL_AI
可用内存 >= 4GB + AVX   → BALANCED
可用内存 >= 2GB         → LITE
可用内存 < 2GB          → MINIMAL
```

### 2.3 优雅降级机制

```
用户设备：10 年前的双核电脑，4GB 内存
    ↓
硬件探针检测到性能不足
    ↓
自动禁用 LLM 功能
    ↓
UI 提示："已为您切换至极速模式"
    ↓
软件正常运行，不会崩溃
```

---

## 三、性能优化机制

### 3.1 懒加载 (Lazy Loading)

```
软件启动 → 不加载任何 AI 模型
    ↓
用户点击"AI 分析" → 立即加载对应模型
    ↓
使用完毕 → 60 秒后自动卸载
    ↓
释放内存给系统
```

**优势**:
- 启动速度快（无 AI 负担）
- 内存占用低（按需加载）
- 不影响其他应用

### 3.2 后台预处理

```
系统空闲时:
  1. 扫描新文件
  2. 预计算特征向量
  3. 存入向量数据库
    ↓
用户搜索时:
  直接查询，瞬间返回
```

### 3.3 向量存储优化

**不使用**: ChromaDB、Milvus（太重）  
**使用**: SQLite + sqlite-vss

```sql
-- 向量存储表
CREATE TABLE file_vectors (
  file_id INTEGER PRIMARY KEY,
  file_path TEXT,
  embedding BLOB,  -- 384 维 float 数组
  clip_vector BLOB -- 512 维 float 数组
);

-- 余弦相似度查询
SELECT * FROM file_vectors
ORDER BY cosine_distance(embedding, :query_vector)
LIMIT 10;
```

**内存占用**: <50MB  
**查询速度**: 10 万条记录 <100ms

---

## 四、模型下载与管理

### 4.1 按需下载

```
初始安装包：50MB（仅核心程序）
    ↓
用户首次点击 AI 功能
    ↓
后台静默下载模型（显示进度）
    ↓
下载完成，立即可用
```

**模型大小**:
- bge-micro-v2: 22MB
- clip-vit-b-32: 150MB
- Qwen2.5-1.5B: 1.1GB

### 4.2 模型管理界面

在设置中可以：
- ✅ 查看已下载的模型
- ✅ 手动加载/卸载模型
- ✅ 查看内存占用
- ✅ 切换 AI 模式

---

## 五、隐私与安全

### 5.1 纯本地运行

```
❌ 不上传任何文件到云端
❌ 不需要网络连接
❌ 不调用第三方 API
✅ 所有计算在本地 CPU/GPU 完成
✅ 数据存储在本地 SQLite
```

### 5.2 模型来源

所有模型来自 HuggingFace 开源社区：
- BAAI/bge-micro-v2 (MIT License)
- openai/clip-vit-b-32 (MIT License)
- Qwen/Qwen2.5-1.5B (Apache 2.0)

---

## 六、实际应用场景

### 场景 1: 整理工作文档

```
用户操作：
  1. 选择"扫描工作文件夹"
  2. 启用"文档语义去重"
  3. 点击开始

AI 处理:
  - 提取每个文档的语义向量
  - 发现 3 份内容相同的合同（不同格式）
  - 标记为"语义重复组"

结果:
  节省空间：15MB
  保留建议：保留最新版本的 .docx
```

### 场景 2: 整理摄影作品

```
用户输入："找出所有模糊的风景照"

AI 处理:
  - CLIP 模型理解"模糊"和"风景"
  - 搜索图片库
  - 返回 23 张匹配的照片

结果:
  找到目标照片，无需手动翻找
```

### 场景 3: 代码版本对比

```
用户操作:
  1. 选择两个代码文件
  2. 点击"AI 智能分析差异"

LLM 输出:
  "v2 版本主要修改:
   1. 修复了空指针异常 (第 45 行)
   2. 优化了循环性能 (第 78-82 行)
   3. 添加了错误处理 (新增 15 行)
   
   建议：保留 v2 版本"
```

---

## 七、技术栈

### 推理引擎

| 组件 | 框架 | 后端 |
|------|------|------|
| Embedding | ONNX Runtime | CPU (AVX2) |
| CLIP | ONNX Runtime | CPU/GPU |
| LLM | llama.cpp | CPU (GGUF) |

### 依赖安装

```bash
# ONNX Runtime (Embedding + CLIP)
npm install onnxruntime-node

# llama.cpp (LLM)
npm install node-llama-cpp

# 图像处理 (CLIP 预处理)
npm install sharp

# 向量搜索扩展
npm install sqlite-vss
```

---

## 八、性能基准

### 测试环境
- CPU: Intel i7-12700H
- RAM: 32GB
- GPU: RTX 3060

### 向量化速度

| 任务 | 单次耗时 | 批量 (1000 次) |
|------|---------|--------------|
| 文档 Embedding | 5ms | 5s |
| 图片 CLIP | 150ms | 2.5min |
| LLM 分析 | 2s | - |

### 内存占用

| 模式 | 静态占用 | 峰值占用 |
|------|---------|---------|
| MINIMAL | <10MB | 50MB |
| LITE | 50MB | 100MB |
| BALANCED | 200MB | 400MB |
| FULL_AI | 1.5GB | 2.2GB |

---

*版本：v3.0 AI-Native*  
*最后更新：2026-03-14*
