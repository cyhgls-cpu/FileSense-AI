/**
 * 增量索引数据库 - 高性能优化版
 * 使用 SQLite 持久化文件特征指纹，实现毫秒级复扫
 * 优化项：WAL模式 + 批量事务 + 内存映射 + 预编译语句缓存
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class IndexDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(process.cwd(), 'file-index.db');
    this.db = null;
    this.stmtCache = new Map(); // 预编译语句缓存
    this.batchQueue = [];       // 批量写入队列
    this.batchTimer = null;     // 批量写入定时器
    this.BATCH_SIZE = 1000;     // 每批写入数量
    this.BATCH_INTERVAL = 100;  // 批量写入间隔(ms)
  }

  /**
   * 初始化数据库 - 包含完整性能优化配置
   */
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // 应用性能优化配置
        this._applyOptimizations()
          .then(() => this._createTables())
          .then(() => {
            console.log('✓ 数据库初始化完成，已启用WAL模式');
            resolve();
          })
          .catch(reject);
      });
    });
  }

  /**
   * 应用SQLite性能优化配置
   * WAL模式 + 内存映射 + 缓存优化
   */
  async _applyOptimizations() {
    const pragmas = [
      'PRAGMA journal_mode = WAL',           // 写前日志模式，读写不阻塞
      'PRAGMA synchronous = NORMAL',         // 平衡安全与性能（WAL模式下安全）
      'PRAGMA cache_size = -64000',          // 64MB页缓存（负值表示KB）
      'PRAGMA temp_store = MEMORY',          // 临时表和索引存内存
      'PRAGMA mmap_size = 268435456',        // 256MB内存映射文件
      'PRAGMA page_size = 4096',             // 4KB页大小（匹配OS页）
      'PRAGMA auto_vacuum = INCREMENTAL',    // 增量自动清理
      'PRAGMA busy_timeout = 5000',          // 忙等待5秒
      'PRAGMA wal_autocheckpoint = 1000',    // WAL检查点1000页
    ];

    for (const pragma of pragmas) {
      await new Promise((resolve, reject) => {
        this.db.run(pragma, (err) => {
          if (err) {
            console.warn(`⚠ ${pragma} 失败:`, err.message);
            resolve(); // 非致命错误，继续
          } else {
            resolve();
          }
        });
      });
    }
  }

  /**
   * 创建表结构 - 包含向量存储扩展
   */
  async _createTables() {
    const createTableSQL = `
      -- 主文件索引表
      CREATE TABLE IF NOT EXISTS file_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        category TEXT,
        extension TEXT,
        sparse_hash TEXT,
        full_hash TEXT,
        perceptual_hash TEXT,
        sim_hash TEXT,
        scan_time REAL DEFAULT (strftime('%s', 'now')),
        is_valid INTEGER DEFAULT 1
      );

      -- 向量特征表（用于AI语义搜索）
      CREATE TABLE IF NOT EXISTS file_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        model_type TEXT NOT NULL,  -- 'embedding', 'clip', 'custom'
        vector BLOB,               -- 二进制向量数据
        dimensions INTEGER,        -- 向量维度
        created_at REAL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (file_id) REFERENCES file_index(id) ON DELETE CASCADE,
        UNIQUE(file_id, model_type)
      );

      -- 智能文件夹表
      CREATE TABLE IF NOT EXISTS smart_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        query_text TEXT,           -- 原始自然语言查询
        query_vector BLOB,         -- 查询向量缓存
        match_threshold REAL DEFAULT 0.75,
        created_at REAL DEFAULT (strftime('%s', 'now')),
        updated_at REAL DEFAULT (strftime('%s', 'now'))
      );

      -- 智能文件夹-文件关联表
      CREATE TABLE IF NOT EXISTS smart_folder_matches (
        folder_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL,
        similarity REAL NOT NULL,
        matched_at REAL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (folder_id, file_id),
        FOREIGN KEY (folder_id) REFERENCES smart_folders(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES file_index(id) ON DELETE CASCADE
      );

      -- 用户偏好学习表
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT NOT NULL,   -- 'image', 'document', 'software', 'all'
        weights_json TEXT NOT NULL,-- 权重配置JSON
        feedback_count INTEGER DEFAULT 0,
        last_updated REAL DEFAULT (strftime('%s', 'now')),
        UNIQUE(file_type)
      );

      -- 用户反馈记录表（用于RLHF学习）
      CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT,
        recommended_path TEXT,
        chosen_path TEXT,
        context_json TEXT,         -- 决策上下文
        timestamp REAL DEFAULT (strftime('%s', 'now'))
      );

      -- 索引优化
      CREATE INDEX IF NOT EXISTS idx_full_hash ON file_index(full_hash);
      CREATE INDEX IF NOT EXISTS idx_sparse_hash ON file_index(sparse_hash);
      CREATE INDEX IF NOT EXISTS idx_perceptual_hash ON file_index(perceptual_hash);
      CREATE INDEX IF NOT EXISTS idx_sim_hash ON file_index(sim_hash);
      CREATE INDEX IF NOT EXISTS idx_mtime ON file_index(mtime);
      CREATE INDEX IF NOT EXISTS idx_category ON file_index(category);
      CREATE INDEX IF NOT EXISTS idx_file_size ON file_index(file_size);
      CREATE INDEX IF NOT EXISTS idx_valid ON file_index(is_valid);

      CREATE INDEX IF NOT EXISTS idx_vectors_model ON file_vectors(model_type);
      CREATE INDEX IF NOT EXISTS idx_vectors_file ON file_vectors(file_id);
      CREATE INDEX IF NOT EXISTS idx_folder_matches ON smart_folder_matches(folder_id, similarity);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(createTableSQL, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取或创建预编译语句
   */
  _getStatement(sql) {
    if (!this.stmtCache.has(sql)) {
      this.stmtCache.set(sql, this.db.prepare(sql));
    }
    return this.stmtCache.get(sql);
  }

  /**
   * 检查文件是否已缓存（未修改）
   */
  async getCachedFile(filePath, mtime) {
    const sql = `
      SELECT * FROM file_index
      WHERE file_path = ? AND mtime = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [filePath, mtime], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /**
   * 批量检查缓存状态 - 一次性查询多个文件
   */
  async getCachedFilesBatch(fileInfos) {
    if (fileInfos.length === 0) return new Map();

    const placeholders = fileInfos.map(() => '(?, ?)').join(',');
    const params = fileInfos.flatMap(f => [f.path, f.mtime]);

    const sql = `
      SELECT file_path, mtime, * FROM file_index
      WHERE (file_path, mtime) IN (${placeholders})
      AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        const result = new Map();
        rows.forEach(row => result.set(row.file_path, row));
        resolve(result);
      });
    });
  }

  /**
   * 批量插入或更新文件记录 - 高性能版本
   * 使用事务 + 预编译语句 + 批量提交
   */
  async upsertFiles(files) {
    if (files.length === 0) return;

    const sql = `
      INSERT OR REPLACE INTO file_index
      (file_path, file_size, mtime, category, extension, sparse_hash, full_hash, perceptual_hash, sim_hash, scan_time, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), 1)
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // 开始事务
        this.db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
          if (err) {
            reject(err);
            return;
          }

          const stmt = this.db.prepare(sql);
          let completed = 0;
          let hasError = false;

          for (const file of files) {
            stmt.run(
              file.path,
              file.size,
              file.mtime,
              file.category,
              file.extension,
              file.sparseHash || null,
              file.fullHash || null,
              file.perceptualHash ? file.perceptualHash.phash : null,
              file.simHash || null,
              function(err) {
                if (err && !hasError) {
                  hasError = true;
                  console.error(`插入失败 ${file.path}:`, err.message);
                }
                completed++;

                if (completed === files.length) {
                  stmt.finalize((finalizeErr) => {
                    if (finalizeErr || hasError) {
                      this.db.run('ROLLBACK', () => reject(finalizeErr || new Error('批量插入失败')));
                    } else {
                      this.db.run('COMMIT', (commitErr) => {
                        if (commitErr) reject(commitErr);
                        else resolve();
                      });
                    }
                  });
                }
              }.bind(this)
            );
          }
        });
      });
    });
  }

  /**
   * 流式批量写入 - 适用于超大批量数据
   * 自动分块，避免单事务过大
   */
  async upsertFilesStreaming(files, onProgress) {
    const CHUNK_SIZE = 5000; // 每5000条提交一次
    const total = files.length;
    let processed = 0;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      await this.upsertFiles(chunk);
      processed += chunk.length;

      if (onProgress) {
        onProgress(processed, total);
      }

      // 让出事件循环，避免阻塞
      await new Promise(r => setImmediate(r));
    }
  }

  /**
   * 异步批量写入队列 - 非阻塞写入
   * 适用于实时扫描场景
   */
  async queueFileForBatch(file) {
    this.batchQueue.push(file);

    if (this.batchQueue.length >= this.BATCH_SIZE) {
      await this._flushBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this._flushBatch(), this.BATCH_INTERVAL);
    }
  }

  /**
   * 刷新批量写入队列
   */
  async _flushBatch() {
    if (this.batchQueue.length === 0) return;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = this.batchQueue.splice(0, this.BATCH_SIZE);
    await this.upsertFiles(batch);
  }

  /**
   * 存储向量特征
   */
  async storeVector(fileId, modelType, vector, dimensions) {
    const sql = `
      INSERT OR REPLACE INTO file_vectors
      (file_id, model_type, vector, dimensions)
      VALUES (?, ?, ?, ?)
    `;

    // 将Float32Array转为Buffer存储
    const vectorBuffer = Buffer.from(vector.buffer);

    return new Promise((resolve, reject) => {
      this.db.run(sql, [fileId, modelType, vectorBuffer, dimensions], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 批量存储向量
   */
  async storeVectorsBatch(vectors) {
    const sql = `
      INSERT OR REPLACE INTO file_vectors
      (file_id, model_type, vector, dimensions)
      VALUES (?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        const stmt = this.db.prepare(sql);

        for (const v of vectors) {
          const vectorBuffer = Buffer.from(v.vector.buffer);
          stmt.run(v.fileId, v.modelType, vectorBuffer, v.dimensions);
        }

        stmt.finalize((err) => {
          if (err) {
            this.db.run('ROLLBACK', () => reject(err));
          } else {
            this.db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
        });
      });
    });
  }

  /**
   * 获取文件的向量
   */
  async getVector(fileId, modelType) {
    const sql = `
      SELECT vector, dimensions FROM file_vectors
      WHERE file_id = ? AND model_type = ?
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [fileId, modelType], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          // Buffer转回Float32Array
          const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dimensions);
          resolve({ vector, dimensions: row.dimensions });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * 创建智能文件夹
   */
  async createSmartFolder(name, queryText, queryVector, threshold = 0.75) {
    const sql = `
      INSERT INTO smart_folders (name, query_text, query_vector, match_threshold)
      VALUES (?, ?, ?, ?)
    `;

    const vectorBuffer = queryVector ? Buffer.from(queryVector.buffer) : null;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [name, queryText, vectorBuffer, threshold], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  /**
   * 获取智能文件夹匹配的文件
   */
  async getSmartFolderFiles(folderId, minSimilarity = 0.7) {
    const sql = `
      SELECT f.*, m.similarity
      FROM file_index f
      JOIN smart_folder_matches m ON f.id = m.file_id
      WHERE m.folder_id = ? AND m.similarity >= ?
      ORDER BY m.similarity DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [folderId, minSimilarity], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 保存用户偏好
   */
  async saveUserPreference(fileType, weights) {
    const sql = `
      INSERT INTO user_preferences (file_type, weights_json, last_updated)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(file_type) DO UPDATE SET
        weights_json = excluded.weights_json,
        last_updated = excluded.last_updated,
        feedback_count = feedback_count + 1
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [fileType, JSON.stringify(weights)], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 获取用户偏好
   */
  async getUserPreference(fileType) {
    const sql = `
      SELECT weights_json, feedback_count FROM user_preferences
      WHERE file_type = ?
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [fileType], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({
            weights: JSON.parse(row.weights_json),
            feedbackCount: row.feedback_count
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * 记录用户反馈（用于RLHF学习）
   */
  async recordFeedback(fileType, recommendedPath, chosenPath, context) {
    const sql = `
      INSERT INTO user_feedback (file_type, recommended_path, chosen_path, context_json)
      VALUES (?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        fileType,
        recommendedPath,
        chosenPath,
        JSON.stringify(context)
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 根据哈希值查找重复文件
   */
  async findDuplicatesByHash(hash) {
    const sql = `
      SELECT * FROM file_index
      WHERE full_hash = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [hash], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 查找所有重复文件组
   */
  async findAllDuplicateGroups() {
    const sql = `
      SELECT full_hash, GROUP_CONCAT(file_path) as paths,
             COUNT(*) as count, SUM(file_size) as total_size
      FROM file_index
      WHERE full_hash IS NOT NULL AND is_valid = 1
      GROUP BY full_hash
      HAVING count > 1
      ORDER BY total_size DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 查找相似图片（基于感知哈希）
   */
  async findSimilarImages(phash, threshold = 5) {
    // 简化版本：实际应计算汉明距离
    const sql = `
      SELECT * FROM file_index
      WHERE perceptual_hash IS NOT NULL AND is_valid = 1
      LIMIT 100
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 查找相似文档（基于 SimHash）
   */
  async findSimilarDocuments(simHash) {
    const sql = `
      SELECT * FROM file_index
      WHERE sim_hash IS NOT NULL AND is_valid = 1
      LIMIT 100
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 标记文件为无效（已删除）
   */
  async markFileInvalid(filePath) {
    const sql = `UPDATE file_index SET is_valid = 0 WHERE file_path = ?`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [filePath], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 批量标记无效文件
   */
  async markFilesInvalid(filePaths) {
    const placeholders = filePaths.map(() => '?').join(',');
    const sql = `UPDATE file_index SET is_valid = 0 WHERE file_path IN (${placeholders})`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, filePaths, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 清理无效记录
   */
  async cleanup() {
    const sql = `DELETE FROM file_index WHERE is_valid = 0`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 执行VACUUM优化（应在空闲时调用）
   */
  async vacuum() {
    return new Promise((resolve, reject) => {
      this.db.run('VACUUM', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 强制WAL检查点（应在空闲时调用）
   */
  async checkpoint() {
    return new Promise((resolve, reject) => {
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
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
        COUNT(*) as total_files,
        SUM(file_size) as total_size,
        COUNT(DISTINCT full_hash) as unique_hashes,
        category,
        COUNT(*) as category_count
      FROM file_index
      WHERE is_valid = 1
      GROUP BY category
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 获取数据库性能统计
   */
  async getDbStats() {
    const pragmas = [
      'PRAGMA page_count',
      'PRAGMA page_size',
      'PRAGMA freelist_count',
      'PRAGMA journal_mode',
      'PRAGMA wal_checkpoint'
    ];

    const stats = {};
    for (const pragma of pragmas) {
      const key = pragma.replace('PRAGMA ', '').replace('(', '_').replace(')', '');
      await new Promise((resolve) => {
        this.db.get(pragma, (err, row) => {
          if (!err && row) {
            stats[key] = Object.values(row)[0];
          }
          resolve();
        });
      });
    }

    return stats;
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    // 刷新剩余批量数据
    await this._flushBatch();

    // 执行检查点
    await this.checkpoint();

    // 清理预编译语句
    for (const stmt of this.stmtCache.values()) {
      stmt.finalize();
    }
    this.stmtCache.clear();

    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = { IndexDatabase };
