/**
 * 统一文件索引 (Unified File Index)
 *
 * 核心设计理念：
 * 1. 文件身份标识：绝对路径是文件的唯一身份标识
 * 2. 分层指纹体系：传统哈希 -> AI 向量，从精确到语义的多层去重
 * 3. 按需加载：AI 向量是可选的，不阻碍基础扫描流程
 * 4. 数据一致性：所有数据通过 file_path 关联，支持事务更新
 *
 * 数据流：
 * 文件路径 (Identity)
 *    ↓
 * 传统分块哈希 (Precise) - 快速精确去重
 *    ↓
 * AI 语义向量 (Semantic) - 深度相似检测
 */

const { IndexDatabase } = require('./index-db');
const { VectorDatabase } = require('./vector-db');
const path = require('path');

class UnifiedFileIndex {
  constructor(options = {}) {
    this.options = {
      dbPath: options.dbPath || path.join(process.cwd(), 'data', 'unified-index.db'),
      vectorDbPath: options.vectorDbPath || path.join(process.cwd(), 'data', 'vectors.db'),
      enableVectors: options.enableVectors !== false,  // 默认启用向量存储
      ...options
    };

    // 子系统
    this.indexDb = null;      // 传统索引
    this.vectorDb = null;     // 向量存储

    // 缓存
    this.pathToHash = new Map();      // 路径 -> 哈希缓存
    this.hashToPaths = new Map();     // 哈希 -> 路径列表缓存
    this.pathToVector = new Map();    // 路径 -> 向量缓存（LRU）

    // 统计
    this.stats = {
      totalFiles: 0,
      withTraditionalHash: 0,
      withAIVectors: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * 初始化统一索引
   */
  async init() {
    // 初始化传统索引
    this.indexDb = new IndexDatabase(this.options.dbPath);
    await this.indexDb.init();

    // 初始化向量存储（如果启用）
    if (this.options.enableVectors) {
      this.vectorDb = new VectorDatabase(this.options.vectorDbPath);
      await this.vectorDb.init();
    }

    console.log('[UnifiedIndex] 统一索引初始化完成');
    return this;
  }

  /**
   * ============================================
   * 核心 API：文件身份管理（路径为中心）
   * ============================================
   */

  /**
   * 注册文件（仅路径和基础元数据）
   * 这是第一步，快速记录文件存在
   */
  async registerFile(filePath, metadata = {}) {
    const record = {
      path: filePath,
      size: metadata.size || 0,
      mtime: metadata.mtime || Date.now(),
      category: metadata.category || 'other',
      extension: metadata.extension || path.extname(filePath).toLowerCase(),
      // 哈希和向量初始为空，后续异步计算
      sparseHash: null,
      fullHash: null,
      perceptualHash: null,
      simHash: null
    };

    await this.indexDb.upsertFiles([record]);
    this.stats.totalFiles++;

    return {
      path: filePath,
      status: 'registered',
      nextSteps: ['computeTraditionalHash', 'computeAIVectors']
    };
  }

  /**
   * 批量注册文件
   */
  async registerFiles(fileList) {
    const records = fileList.map(f => ({
      path: f.path,
      size: f.size || 0,
      mtime: f.mtime || Date.now(),
      category: f.category || 'other',
      extension: f.extension || path.extname(f.path).toLowerCase(),
      sparseHash: null,
      fullHash: null,
      perceptualHash: null,
      simHash: null
    }));

    await this.indexDb.upsertFiles(records);
    this.stats.totalFiles += records.length;

    return {
      registered: records.length,
      paths: records.map(r => r.path)
    };
  }

  /**
   * ============================================
   * 核心 API：传统哈希层（精确去重）
   * ============================================
   */

  /**
   * 更新文件的传统哈希
   * 这是第二步，计算精确哈希用于快速去重
   */
  async updateTraditionalHash(filePath, hashData) {
    const record = {
      path: filePath,
      size: hashData.size,
      mtime: hashData.mtime,
      category: hashData.category,
      extension: hashData.extension,
      sparseHash: hashData.sparseHash,
      fullHash: hashData.fullHash,
      perceptualHash: hashData.perceptualHash || null,
      simHash: hashData.simHash || null
    };

    await this.indexDb.upsertFiles([record]);

    // 更新缓存
    this.pathToHash.set(filePath, hashData.fullHash);
    if (!this.hashToPaths.has(hashData.fullHash)) {
      this.hashToPaths.set(hashData.fullHash, []);
    }
    this.hashToPaths.get(hashData.fullHash).push(filePath);
    this.stats.withTraditionalHash++;

    return {
      path: filePath,
      fullHash: hashData.fullHash,
      status: 'hashed'
    };
  }

  /**
   * 通过传统哈希查找重复文件
   * 快速精确去重
   */
  async findExactDuplicates(filePath) {
    // 先查缓存
    let fullHash = this.pathToHash.get(filePath);

    // 缓存未命中，查数据库
    if (!fullHash) {
      const record = await this.indexDb.getCachedFile(filePath, 0);
      if (record && record.full_hash) {
        fullHash = record.full_hash;
        this.pathToHash.set(filePath, fullHash);
        this.stats.cacheMisses++;
      } else {
        return [];
      }
    } else {
      this.stats.cacheHits++;
    }

    // 查找相同哈希的文件
    const duplicates = await this.indexDb.findDuplicatesByHash(fullHash);
    return duplicates.filter(d => d.file_path !== filePath);
  }

  /**
   * 获取所有精确重复组
   */
  async getAllExactDuplicateGroups() {
    const sql = `
      SELECT full_hash, GROUP_CONCAT(file_path) as paths
      FROM file_index
      WHERE full_hash IS NOT NULL AND is_valid = 1
      GROUP BY full_hash
      HAVING COUNT(*) > 1
    `;

    return new Promise((resolve, reject) => {
      this.indexDb.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else {
          const groups = rows.map(row => ({
            hash: row.full_hash,
            paths: row.paths.split(',')
          }));
          resolve(groups);
        }
      });
    });
  }

  /**
   * ============================================
   * 核心 API：AI 向量层（语义去重）
   * ============================================
   */

  /**
   * 更新文件的 AI 向量
   * 这是第三步，异步计算语义特征
   */
  async updateAIVectors(filePath, vectorData) {
    if (!this.vectorDb) {
      throw new Error('向量存储未启用');
    }

    const results = [];

    // 存储文档嵌入向量
    if (vectorData.embedding) {
      await this.vectorDb.storeVector(
        filePath,
        vectorData.fileHash,
        'EMBEDDING',
        vectorData.embedding
      );
      results.push({ type: 'EMBEDDING', dimensions: vectorData.embedding.length });
    }

    // 存储图片 CLIP 向量
    if (vectorData.clip) {
      await this.vectorDb.storeVector(
        filePath,
        vectorData.fileHash,
        'CLIP',
        vectorData.clip
      );
      results.push({ type: 'CLIP', dimensions: vectorData.clip.length });
    }

    // 更新缓存
    this.pathToVector.set(filePath, {
      embedding: vectorData.embedding,
      clip: vectorData.clip,
      updatedAt: Date.now()
    });
    this.stats.withAIVectors++;

    return {
      path: filePath,
      vectors: results,
      status: 'vectorized'
    };
  }

  /**
   * 通过 AI 向量查找相似文件
   * 语义相似度去重
   */
  async findSemanticDuplicates(filePath, options = {}) {
    if (!this.vectorDb) {
      return [];
    }

    const { modelType = 'EMBEDDING', threshold = 0.9, topK = 10 } = options;

    // 获取文件的向量
    let vector = this.pathToVector.get(filePath)?.[modelType.toLowerCase()];

    if (!vector) {
      const record = await this.vectorDb.getVector(filePath, modelType);
      if (record) {
        vector = record.vector;
      } else {
        return [];
      }
    }

    // 搜索相似向量
    const similar = await this.vectorDb.searchSimilar(vector, modelType, topK, threshold);
    return similar.filter(s => s.filePath !== filePath);
  }

  /**
   * 获取所有语义相似组
   */
  async getAllSemanticDuplicateGroups(modelType = 'EMBEDDING', threshold = 0.9) {
    if (!this.vectorDb) {
      return [];
    }

    const pairs = await this.vectorDb.findAllSimilarPairs(modelType, threshold);

    // 将配对结果分组
    const groups = this._clusterPairsToGroups(pairs);
    return groups;
  }

  /**
   * ============================================
   * 高级 API：分层去重（精确 + 语义）
   * ============================================
   */

  /**
   * 分层去重分析
   * 第一层：传统哈希（精确匹配）
   * 第二层：AI 向量（语义相似）
   */
  async analyzeDuplicates(filePath, options = {}) {
    const result = {
      path: filePath,
      exactDuplicates: [],      // 传统哈希相同
      semanticDuplicates: [],   // AI 向量相似
      summary: {
        exactCount: 0,
        semanticCount: 0,
        totalSimilar: 0
      }
    };

    // 第一层：精确去重
    result.exactDuplicates = await this.findExactDuplicates(filePath);
    result.summary.exactCount = result.exactDuplicates.length;

    // 第二层：语义去重（排除已精确匹配的）
    const exactPaths = new Set(result.exactDuplicates.map(d => d.file_path));
    const semanticMatches = await this.findSemanticDuplicates(filePath, options);

    result.semanticDuplicates = semanticMatches.filter(s => !exactPaths.has(s.filePath));
    result.summary.semanticCount = result.semanticDuplicates.length;

    result.summary.totalSimilar = result.summary.exactCount + result.summary.semanticCount;

    return result;
  }

  /**
   * 批量分层去重分析
   */
  async analyzeAllDuplicates(options = {}) {
    const { includeSemantic = true, semanticThreshold = 0.9 } = options;

    // 获取所有精确重复组
    const exactGroups = await this.getAllExactDuplicateGroups();

    let semanticGroups = [];
    if (includeSemantic && this.vectorDb) {
      // 获取所有语义相似组
      semanticGroups = await this.getAllSemanticDuplicateGroups('EMBEDDING', semanticThreshold);
    }

    return {
      exact: exactGroups,
      semantic: semanticGroups,
      summary: {
        exactGroups: exactGroups.length,
        semanticGroups: semanticGroups.length,
        totalFilesAffected: this._countAffectedFiles(exactGroups, semanticGroups)
      }
    };
  }

  /**
   * ============================================
   * 数据一致性管理
   * ============================================
   */

  /**
   * 标记文件删除
   * 级联删除所有相关数据
   */
  async markFileDeleted(filePath) {
    // 删除传统索引
    await this.indexDb.markFileInvalid(filePath);

    // 删除向量数据
    if (this.vectorDb) {
      await this.vectorDb.markInvalid(filePath);
    }

    // 清理缓存
    const hash = this.pathToHash.get(filePath);
    if (hash) {
      const paths = this.hashToPaths.get(hash);
      if (paths) {
        const idx = paths.indexOf(filePath);
        if (idx > -1) paths.splice(idx, 1);
      }
    }
    this.pathToHash.delete(filePath);
    this.pathToVector.delete(filePath);

    return { path: filePath, status: 'deleted' };
  }

  /**
   * 验证数据一致性
   * 检查路径 -> 哈希 -> 向量的完整性
   */
  async verifyConsistency() {
    const issues = [];

    // 检查有哈希但没有向量的文件（可选的警告）
    const sql = `
      SELECT file_path, full_hash FROM file_index
      WHERE full_hash IS NOT NULL AND is_valid = 1
    `;

    const files = await new Promise((resolve, reject) => {
      this.indexDb.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (this.vectorDb) {
      for (const file of files) {
        const hasVector = await this.vectorDb.hasValidVector(
          file.file_path,
          file.full_hash,
          'EMBEDDING'
        );
        if (!hasVector) {
          issues.push({
            path: file.file_path,
            issue: 'missing_vector',
            severity: 'warning'
          });
        }
      }
    }

    return {
      valid: issues.length === 0,
      totalFiles: files.length,
      issues
    };
  }

  /**
   * ============================================
   * 查询 API
   * ============================================
   */

  /**
   * 获取文件的完整信息
   */
  async getFileInfo(filePath) {
    const info = {
      path: filePath,
      traditional: null,
      vectors: null
    };

    // 查询传统索引
    const record = await this.indexDb.getCachedFile(filePath, 0);
    if (record) {
      info.traditional = {
        size: record.file_size,
        mtime: record.mtime,
        fullHash: record.full_hash,
        sparseHash: record.sparse_hash,
        perceptualHash: record.perceptual_hash,
        simHash: record.sim_hash
      };
    }

    // 查询向量
    if (this.vectorDb) {
      const embedding = await this.vectorDb.getVector(filePath, 'EMBEDDING');
      const clip = await this.vectorDb.getVector(filePath, 'CLIP');

      if (embedding || clip) {
        info.vectors = {
          embedding: embedding ? {
            dimensions: embedding.dimensions,
            extractedAt: embedding.extracted_at
          } : null,
          clip: clip ? {
            dimensions: clip.dimensions,
            extractedAt: clip.extracted_at
          } : null
        };
      }
    }

    return info;
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const indexStats = await this.indexDb.getStats();
    const vectorStats = this.vectorDb ? await this.vectorDb.getStats() : [];

    return {
      totalFiles: this.stats.totalFiles,
      withTraditionalHash: this.stats.withTraditionalHash,
      withAIVectors: this.stats.withAIVectors,
      cache: {
        hits: this.stats.cacheHits,
        misses: this.stats.cacheMisses,
        hitRate: this.stats.cacheHits + this.stats.cacheMisses > 0
          ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)).toFixed(2)
          : 0
      },
      byCategory: indexStats,
      byVectorType: vectorStats
    };
  }

  /**
   * ============================================
   * 工具方法
   * ============================================
   */

  /**
   * 将配对列表聚类成组
   */
  _clusterPairsToGroups(pairs) {
    const graph = new Map();

    // 构建邻接表
    for (const pair of pairs) {
      if (!graph.has(pair.file1)) graph.set(pair.file1, new Set());
      if (!graph.has(pair.file2)) graph.set(pair.file2, new Set());
      graph.get(pair.file1).add(pair.file2);
      graph.get(pair.file2).add(pair.file1);
    }

    // DFS 找连通分量
    const visited = new Set();
    const groups = [];

    function dfs(node, group) {
      if (visited.has(node)) return;
      visited.add(node);
      group.push(node);
      for (const neighbor of graph.get(node) || []) {
        dfs(neighbor, group);
      }
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const group = [];
        dfs(node, group);
        groups.push({
          paths: group,
          count: group.length
        });
      }
    }

    return groups;
  }

  /**
   * 计算受影响文件数
   */
  _countAffectedFiles(exactGroups, semanticGroups) {
    const affected = new Set();
    exactGroups.forEach(g => g.paths.forEach(p => affected.add(p)));
    semanticGroups.forEach(g => g.paths.forEach(p => affected.add(p)));
    return affected.size;
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    await this.indexDb.close();
    if (this.vectorDb) {
      await this.vectorDb.close();
    }
  }
}

module.exports = { UnifiedFileIndex };
