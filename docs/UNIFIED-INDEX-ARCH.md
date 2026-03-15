# 统一文件索引架构设计

## 核心概念：三层身份体系

```
┌─────────────────────────────────────────────────────────────────┐
│                      文件身份标识层                               │
│                    File Identity Layer                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   文件绝对路径 (Absolute Path)                                   │
│   └─ 唯一身份标识，贯穿整个系统的"主键"                           │
│                                                                 │
│   示例: "/home/user/docs/report.pdf"                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      精确匹配层 (V1.0)                           │
│                  Traditional Hash Layer                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   分块哈希漏斗模型                                               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │  稀疏哈希   │ -> │  分块哈希   │ -> │  完整哈希   │        │
│   │  (1KB)     │    │  (可变)     │    │  (SHA-256)  │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│        快速筛选          增量计算          精确匹配              │
│                                                                 │
│   用途: 快速精确去重（完全相同的文件）                            │
│   性能: 10万文件/秒                                             │
│   存储: SQLite file_index 表                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (可选增强)
┌─────────────────────────────────────────────────────────────────┐
│                      语义相似层 (V1.5+)                          │
│                     AI Vector Layer                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   AI 语义向量 (384/512 维 Float32Array)                          │
│   ┌─────────────────┐    ┌─────────────────┐                   │
│   │  文档嵌入向量   │    │  图片 CLIP 向量  │                   │
│   │  (bge-micro)   │    │  (CLIP-ViT)     │                   │
│   │   384 维       │    │   512 维        │                   │
│   └─────────────────┘    └─────────────────┘                   │
│                                                                 │
│   用途: 语义相似检测（内容相似但不同的文件）                       │
│   性能: 1000文件/分钟（后台异步）                                 │
│   存储: SQLite vector_features 表（BLOB）                        │
│   索引: 余弦相似度计算                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 数据流向

```
文件扫描流程:
=============

1. 发现文件
   └─> 注册文件路径 + 基础元数据
       └─> 存储到 file_index (path, size, mtime)

2. 计算传统哈希 (快速)
   └─> 分块哈希漏斗计算
       └─> 更新 file_index (sparse_hash, full_hash)
       └─> 精确去重检测 (full_hash 相同)

3. 计算 AI 向量 (异步，可选)
   └─> 后台任务队列调度
       └─> ONNX 模型推理
           └─> 存储到 vector_features (path, vector)
           └─> 语义相似检测 (余弦相似度)


去重检测流程:
=============

输入: 文件路径
  │
  ├─[1] 查缓存 (path -> hash)
  │
  ├─[2] 查传统索引 (hash -> duplicate_paths)
  │     └─> 精确重复组
  │
  └─[3] 查向量索引 (path -> vector)
        └─> 向量相似搜索
            └─> 语义相似组

输出: { exactDuplicates[], semanticDuplicates[] }
```

## 数据模型

### 表 1: file_index (传统索引)
```sql
CREATE TABLE file_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,      -- 身份标识
  file_size INTEGER NOT NULL,
  mtime REAL NOT NULL,

  -- 传统哈希层
  sparse_hash TEXT,                     -- 稀疏哈希 (快速筛选)
  full_hash TEXT,                       -- 完整哈希 (精确匹配)
  perceptual_hash TEXT,                 -- 感知哈希 (图片)
  sim_hash TEXT,                        -- SimHash (文档)

  category TEXT,
  extension TEXT,
  is_valid INTEGER DEFAULT 1
);

-- 索引
CREATE INDEX idx_full_hash ON file_index(full_hash);
CREATE INDEX idx_sparse_hash ON file_index(sparse_hash);
```

### 表 2: vector_features (向量存储)
```sql
CREATE TABLE vector_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,              -- 关联到 file_index
  file_hash TEXT NOT NULL,              -- 验证数据一致性
  model_type TEXT NOT NULL,             -- EMBEDDING | CLIP | LLM

  vector BLOB NOT NULL,                 -- Float32Array 二进制
  dimensions INTEGER NOT NULL,          -- 384 | 512 | 4096

  extracted_at REAL DEFAULT (strftime('%s', 'now')),
  is_valid INTEGER DEFAULT 1,

  UNIQUE(file_path, model_type)
);

-- 索引
CREATE INDEX idx_vector_file ON vector_features(file_path);
CREATE INDEX idx_vector_model ON vector_features(model_type);
```

### 表 3: similarity_cache (相似度缓存)
```sql
CREATE TABLE similarity_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path_1 TEXT NOT NULL,
  file_path_2 TEXT NOT NULL,
  model_type TEXT NOT NULL,
  similarity_score REAL NOT NULL,       -- 0-1 余弦相似度
  computed_at REAL DEFAULT (strftime('%s', 'now')),

  UNIQUE(file_path_1, file_path_2, model_type)
);
```

## 核心 API 设计

```typescript
class UnifiedFileIndex {
  // ========== 身份管理 ==========
  async registerFile(path: string, metadata: object): Promise<RegistrationResult>
  async getFileInfo(path: string): Promise<FileInfo>

  // ========== 传统哈希层 ==========
  async updateTraditionalHash(path: string, hashData: HashData): Promise<void>
  async findExactDuplicates(path: string): Promise<FileRecord[]>
  async getAllExactDuplicateGroups(): Promise<DuplicateGroup[]>

  // ========== AI 向量层 ==========
  async updateAIVectors(path: string, vectors: VectorData): Promise<void>
  async findSemanticDuplicates(path: string, options: SearchOptions): Promise<SimilarFile[]>
  async getAllSemanticDuplicateGroups(threshold: number): Promise<DuplicateGroup[]>

  // ========== 分层去重 ==========
  async analyzeDuplicates(path: string): Promise<{
    exactDuplicates: FileRecord[],
    semanticDuplicates: SimilarFile[],
    summary: { exactCount, semanticCount }
  }>

  // ========== 数据一致性 ==========
  async markFileDeleted(path: string): Promise<void>
  async verifyConsistency(): Promise<ConsistencyReport>
}
```

## 使用场景示例

### 场景 1: 快速精确去重（V1.0）
```javascript
// 只使用传统哈希，不需要 AI
const index = new UnifiedFileIndex({ enableVectors: false });

// 1. 注册文件
await index.registerFile('/docs/report.pdf', { size: 1024, mtime: Date.now() });

// 2. 计算哈希
await index.updateTraditionalHash('/docs/report.pdf', {
  fullHash: 'sha256:abc...',
  sparseHash: 'a1b2c3'
});

// 3. 查找重复
const duplicates = await index.findExactDuplicates('/docs/report.pdf');
// 结果: [{ path: '/docs/report_copy.pdf', full_hash: 'sha256:abc...' }]
```

### 场景 2: 语义相似检测（V1.5）
```javascript
// 启用向量存储
const index = new UnifiedFileIndex({ enableVectors: true });

// 1-2. 同上（注册 + 哈希）

// 3. 异步计算 AI 向量（后台任务）
await index.updateAIVectors('/docs/report.pdf', {
  fileHash: 'sha256:abc...',
  embedding: new Float32Array(384).fill(...)  // 从 ONNX 模型获取
});

// 4. 查找语义相似（内容相似但哈希不同）
const similar = await index.findSemanticDuplicates('/docs/report.pdf', {
  modelType: 'EMBEDDING',
  threshold: 0.9  // 90% 相似度
});
// 结果: [{ path: '/docs/report_v2.pdf', similarity: 0.95 }]
```

### 场景 3: 分层去重（完整流程）
```javascript
const analysis = await index.analyzeDuplicates('/docs/report.pdf');

console.log(analysis);
// {
//   path: '/docs/report.pdf',
//   exactDuplicates: [
//     { path: '/docs/report_copy.pdf', full_hash: 'sha256:abc...' }
//   ],
//   semanticDuplicates: [
//     { path: '/docs/report_v2.pdf', similarity: 0.95 }
//   ],
//   summary: {
//     exactCount: 1,
//     semanticCount: 1,
//     totalSimilar: 2
//   }
// }
```

## 设计优势

1. **渐进式增强**
   - V1.0 只使用传统哈希，AI 向量是可选增强
   - 不下载模型也能正常使用基础功能

2. **数据一致性**
   - 所有数据通过 `file_path` 关联
   - 支持事务更新和级联删除

3. **性能优化**
   - 分层缓存：内存缓存 + SQLite 索引
   - 按需加载：AI 向量异步计算，不阻塞主流程

4. **存储效率**
   - 传统哈希：每个文件 ~100 字节
   - AI 向量：每个文件 ~1.5KB (384维 Float32)
   - 10万文件：传统索引 ~10MB，向量存储 ~150MB

5. **查询效率**
   - 精确去重：O(1) 哈希查找
   - 语义搜索：O(n) 余弦相似度计算（可优化为近似最近邻）
