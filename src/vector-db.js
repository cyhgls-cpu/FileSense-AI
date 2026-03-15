/**
 * 向量特征数据库 (V1.5+)
 * 使用 SQLite 存储 AI 提取的向量特征，支持相似度搜索
 *
 * 架构设计：
 * - 纯 SQLite 实现，无需外部向量数据库
 * - 使用 FLOAT 数组存储向量（384/512 维度）
 * - 支持余弦相似度计算
 * - 与 file_index.db 分离，可选加载
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class VectorDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'vectors.db');
    this.db = null;
    this.dimensions = {
      EMBEDDING: 384,  // bge-micro-v2
      CLIP: 512,       // CLIP-ViT-B32
      LLM: 4096        // Qwen2.5 (可选)
    };
  }

  /**
   * 初始化数据库
   */
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        this._createTables().then(resolve).catch(reject);
      });
    });
  }

  /**
   * 创建表结构
   */
  async _createTables() {
    const createTableSQL = `
      -- 向量特征表
      CREATE TABLE IF NOT EXISTS vector_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_hash TEXT NOT NULL,           -- 文件内容哈希，用于验证
        model_type TEXT NOT NULL,          -- EMBEDDING | CLIP | LLM
        vector BLOB NOT NULL,              -- 二进制存储的 Float32Array
        dimensions INTEGER NOT NULL,       -- 向量维度
        extracted_at REAL DEFAULT (strftime('%s', 'now')),
        is_valid INTEGER DEFAULT 1
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_vector_file ON vector_features(file_path);
      CREATE INDEX IF NOT EXISTS idx_vector_model ON vector_features(model_type);
      CREATE INDEX IF NOT EXISTS idx_vector_hash ON vector_features(file_hash);

      -- 相似度搜索缓存表（预计算的相似对）
      CREATE TABLE IF NOT EXISTS similarity_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path_1 TEXT NOT NULL,
        file_path_2 TEXT NOT NULL,
        model_type TEXT NOT NULL,
        similarity_score REAL NOT NULL,    -- 0-1 之间的相似度
        computed_at REAL DEFAULT (strftime('%s', 'now')),
        UNIQUE(file_path_1, file_path_2, model_type)
      );

      CREATE INDEX IF NOT EXISTS idx_sim_file1 ON similarity_cache(file_path_1);
      CREATE INDEX IF NOT EXISTS idx_sim_score ON similarity_cache(similarity_score);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(createTableSQL, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 存储向量特征
   * @param {string} filePath - 文件路径
   * @param {string} fileHash - 文件内容哈希
   * @param {string} modelType - 模型类型 (EMBEDDING|CLIP|LLM)
   * @param {Float32Array} vector - 向量数据
   */
  async storeVector(filePath, fileHash, modelType, vector) {
    const sql = `
      INSERT OR REPLACE INTO vector_features
      (file_path, file_hash, model_type, vector, dimensions, extracted_at, is_valid)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), 1)
    `;

    // 将 Float32Array 转换为 Buffer 存储
    const vectorBuffer = Buffer.from(vector.buffer);

    return new Promise((resolve, reject) => {
      this.db.run(sql, [filePath, fileHash, modelType, vectorBuffer, vector.length], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取文件的向量特征
   */
  async getVector(filePath, modelType) {
    const sql = `
      SELECT * FROM vector_features
      WHERE file_path = ? AND model_type = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [filePath, modelType], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        if (row && row.vector) {
          // 将 Buffer 转换回 Float32Array
          row.vector = new Float32Array(row.vector.buffer);
        }
        resolve(row);
      });
    });
  }

  /**
   * 检查向量是否已存在且有效
   */
  async hasValidVector(filePath, fileHash, modelType) {
    const sql = `
      SELECT 1 FROM vector_features
      WHERE file_path = ? AND file_hash = ? AND model_type = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [filePath, fileHash, modelType], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  /**
   * 相似度搜索 - 查找与目标向量最相似的文件
   * @param {Float32Array} queryVector - 查询向量
   * @param {string} modelType - 模型类型
   * @param {number} topK - 返回前 K 个结果
   * @param {number} threshold - 相似度阈值 (0-1)
   */
  async searchSimilar(queryVector, modelType, topK = 10, threshold = 0.85) {
    // 先获取该类型的所有向量
    const sql = `
      SELECT file_path, vector, dimensions FROM vector_features
      WHERE model_type = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [modelType], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // 计算余弦相似度并排序
        const results = rows
          .map(row => {
            const vector = new Float32Array(row.vector.buffer);
            const similarity = this._cosineSimilarity(queryVector, vector);
            return {
              filePath: row.file_path,
              similarity,
              dimensions: row.dimensions
            };
          })
          .filter(r => r.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, topK);

        resolve(results);
      });
    });
  }

  /**
   * 批量相似度搜索 - 查找所有相似对（用于去重）
   * @param {string} modelType - 模型类型
   * @param {number} threshold - 相似度阈值
   */
  async findAllSimilarPairs(modelType, threshold = 0.9) {
    const sql = `
      SELECT file_path, vector FROM vector_features
      WHERE model_type = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [modelType], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // 转换为 Float32Array
        const vectors = rows.map(row => ({
          filePath: row.file_path,
          vector: new Float32Array(row.vector.buffer)
        }));

        // 计算所有对的相似度（优化：只计算上三角）
        const pairs = [];
        for (let i = 0; i < vectors.length; i++) {
          for (let j = i + 1; j < vectors.length; j++) {
            const similarity = this._cosineSimilarity(vectors[i].vector, vectors[j].vector);
            if (similarity >= threshold) {
              pairs.push({
                file1: vectors[i].filePath,
                file2: vectors[j].filePath,
                similarity
              });
            }
          }
        }

        resolve(pairs.sort((a, b) => b.similarity - a.similarity));
      });
    });
  }

  /**
   * 缓存相似度结果
   */
  async cacheSimilarity(filePath1, filePath2, modelType, similarity) {
    const sql = `
      INSERT OR REPLACE INTO similarity_cache
      (file_path_1, file_path_2, model_type, similarity_score, computed_at)
      VALUES (?, ?, ?, ?, strftime('%s', 'now'))
    `;

    // 确保路径顺序一致
    const [path1, path2] = filePath1 < filePath2
      ? [filePath1, filePath2]
      : [filePath2, filePath1];

    return new Promise((resolve, reject) => {
      this.db.run(sql, [path1, path2, modelType, similarity], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取缓存的相似度
   */
  async getCachedSimilarity(filePath1, filePath2, modelType) {
    const [path1, path2] = filePath1 < filePath2
      ? [filePath1, filePath2]
      : [filePath2, filePath1];

    const sql = `
      SELECT similarity_score FROM similarity_cache
      WHERE file_path_1 = ? AND file_path_2 = ? AND model_type = ?
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [path1, path2, modelType], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.similarity_score : null);
      });
    });
  }

  /**
   * 标记向量无效（文件已删除或修改）
   */
  async markInvalid(filePath) {
    const sql = `UPDATE vector_features SET is_valid = 0 WHERE file_path = ?`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [filePath], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 清理无效记录
   */
  async cleanup() {
    const sql = `DELETE FROM vector_features WHERE is_valid = 0`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const sql = `
      SELECT
        model_type,
        COUNT(*) as count,
        SUM(dimensions * 4) as total_bytes  -- Float32 = 4 bytes
      FROM vector_features
      WHERE is_valid = 1
      GROUP BY model_type
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 计算余弦相似度
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('向量维度不匹配');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 关闭数据库
   */
  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = { VectorDatabase };
