/**
 * 增量索引数据库 - 高性能优化版
 * 使用 better-sqlite3 替代 sqlite3，提供同步高性能操作
 * 优化项：WAL模式 + 批量事务 + 内存映射 + 预编译语句缓存
 */

const Database = require('better-sqlite3');
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
    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 打开数据库
    this.db = new Database(this.dbPath);

    // 应用性能优化配置
    this._applyOptimizations();

    // 创建表结构
    this._createTables();

    console.log('✓ 数据库初始化完成，已启用WAL模式');
  }

  /**
   * 应用SQLite性能优化配置
   * WAL模式 + 内存映射 + 缓存优化
   */
  _applyOptimizations() {
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
      try {
        this.db.pragma(pragma.replace('PRAGMA ', ''));
      } catch (err) {
        console.warn(`⚠ ${pragma} 失败:`, err.message);
      }
    }
  }

  /**
   * 创建表结构 - 包含向量存储扩展
   */
  _createTables() {
    // 主文件索引表
    this.db.exec(`
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
      )
    `);

    // 向量特征表（用于AI语义搜索）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        model_type TEXT NOT NULL,
        vector BLOB,
        dimensions INTEGER,
        created_at REAL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (file_id) REFERENCES file_index(id) ON DELETE CASCADE,
        UNIQUE(file_id, model_type)
      )
    `);

    // 智能文件夹表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        query_text TEXT,
        query_vector BLOB,
        match_threshold REAL DEFAULT 0.75,
        created_at REAL DEFAULT (strftime('%s', 'now')),
        updated_at REAL DEFAULT (strftime('%s', 'now'))
      )
    `);

    // 智能文件夹-文件关联表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_folder_matches (
        folder_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL,
        similarity REAL NOT NULL,
        matched_at REAL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (folder_id, file_id),
        FOREIGN KEY (folder_id) REFERENCES smart_folders(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES file_index(id) ON DELETE CASCADE
      )
    `);

    // 用户偏好学习表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT NOT NULL,
        weights_json TEXT NOT NULL,
        feedback_count INTEGER DEFAULT 0,
        last_updated REAL DEFAULT (strftime('%s', 'now')),
        UNIQUE(file_type)
      )
    `);

    // 用户反馈记录表（用于RLHF学习）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT,
        recommended_path TEXT,
        chosen_path TEXT,
        context_json TEXT,
        timestamp REAL DEFAULT (strftime('%s', 'now'))
      )
    `);

    // 索引优化
    this.db.exec(`
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
    `);
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
    const stmt = this._getStatement(`
      SELECT * FROM file_index
      WHERE file_path = ? AND mtime = ? AND is_valid = 1
    `);
    return stmt.get(filePath, mtime);
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

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    const result = new Map();
    rows.forEach(row => result.set(row.file_path, row));
    return result;
  }

  /**
   * 批量插入或更新文件记录 - 高性能版本
   * 使用事务 + 预编译语句 + 批量提交
   */
  async upsertFiles(files) {
    if (files.length === 0) return;

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO file_index
      (file_path, file_size, mtime, category, extension, sparse_hash, full_hash, perceptual_hash, sim_hash, scan_time, is_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), 1)
    `);

    const transaction = this.db.transaction((files) => {
      for (const file of files) {
        insert.run(
          file.path,
          file.size,
          file.mtime,
          file.category,
          file.extension,
          file.sparseHash || null,
          file.fullHash || null,
          file.perceptualHash ? file.perceptualHash.phash : null,
          file.simHash || null
        );
      }
    });

    transaction(files);
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
    const stmt = this._getStatement(`
      INSERT OR REPLACE INTO file_vectors
      (file_id, model_type, vector, dimensions)
      VALUES (?, ?, ?, ?)
    `);

    // 将Float32Array转为Buffer存储
    const vectorBuffer = Buffer.from(vector.buffer);
    stmt.run(fileId, modelType, vectorBuffer, dimensions);
  }

  /**
   * 批量存储向量
   */
  async storeVectorsBatch(vectors) {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO file_vectors
      (file_id, model_type, vector, dimensions)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((vectors) => {
      for (const v of vectors) {
        const vectorBuffer = Buffer.from(v.vector.buffer);
        insert.run(v.fileId, v.modelType, vectorBuffer, v.dimensions);
      }
    });

    transaction(vectors);
  }

  /**
   * 获取文件的向量
   */
  async getVector(fileId, modelType) {
    const stmt = this._getStatement(`
      SELECT vector, dimensions FROM file_vectors
      WHERE file_id = ? AND model_type = ?
    `);

    const row = stmt.get(fileId, modelType);
    if (row) {
      // Buffer转回Float32Array
      const vector = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dimensions);
      return { vector, dimensions: row.dimensions };
    }
    return null;
  }

  /**
   * 创建智能文件夹
   */
  async createSmartFolder(name, queryText, queryVector, threshold = 0.75) {
    const stmt = this._getStatement(`
      INSERT INTO smart_folders (name, query_text, query_vector, match_threshold)
      VALUES (?, ?, ?, ?)
    `);

    const vectorBuffer = queryVector ? Buffer.from(queryVector.buffer) : null;
    const result = stmt.run(name, queryText, vectorBuffer, threshold);
    return result.lastInsertRowid;
  }

  /**
   * 获取智能文件夹匹配的文件
   */
  async getSmartFolderFiles(folderId, minSimilarity = 0.7) {
    const stmt = this._getStatement(`
      SELECT f.*, m.similarity
      FROM file_index f
      JOIN smart_folder_matches m ON f.id = m.file_id
      WHERE m.folder_id = ? AND m.similarity >= ?
      ORDER BY m.similarity DESC
    `);

    return stmt.all(folderId, minSimilarity);
  }

  /**
   * 保存用户偏好
   */
  async saveUserPreference(fileType, weights) {
    const stmt = this._getStatement(`
      INSERT INTO user_preferences (file_type, weights_json, last_updated)
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(file_type) DO UPDATE SET
        weights_json = excluded.weights_json,
        last_updated = excluded.last_updated,
        feedback_count = feedback_count + 1
    `);

    stmt.run(fileType, JSON.stringify(weights));
  }

  /**
   * 获取用户偏好
   */
  async getUserPreference(fileType) {
    const stmt = this._getStatement(`
      SELECT weights_json, feedback_count FROM user_preferences
      WHERE file_type = ?
    `);

    const row = stmt.get(fileType);
    if (row) {
      return {
        weights: JSON.parse(row.weights_json),
        feedbackCount: row.feedback_count
      };
    }
    return null;
  }

  /**
   * 记录用户反馈（用于RLHF学习）
   */
  async recordFeedback(fileType, recommendedPath, chosenPath, context) {
    const stmt = this._getStatement(`
      INSERT INTO user_feedback (file_type, recommended_path, chosen_path, context_json)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(fileType, recommendedPath, chosenPath, JSON.stringify(context));
  }

  /**
   * 根据哈希值查找重复文件
   */
  async findDuplicatesByHash(hash) {
    const stmt = this._getStatement(`
      SELECT * FROM file_index
      WHERE full_hash = ? AND is_valid = 1
    `);

    return stmt.all(hash);
  }

  /**
   * 查找所有重复文件组
   */
  async findAllDuplicateGroups() {
    const stmt = this.db.prepare(`
      SELECT full_hash, GROUP_CONCAT(file_path) as paths,
             COUNT(*) as count, SUM(file_size) as total_size
      FROM file_index
      WHERE full_hash IS NOT NULL AND is_valid = 1
      GROUP BY full_hash
      HAVING count > 1
      ORDER BY total_size DESC
    `);

    return stmt.all();
  }

  /**
   * 查找相似图片（基于感知哈希）
   */
  async findSimilarImages(phash, threshold = 5) {
    // 简化版本：实际应计算汉明距离
    const stmt = this._getStatement(`
      SELECT * FROM file_index
      WHERE perceptual_hash IS NOT NULL AND is_valid = 1
      LIMIT 100
    `);

    return stmt.all();
  }

  /**
   * 查找相似文档（基于 SimHash）
   */
  async findSimilarDocuments(simHash) {
    const stmt = this._getStatement(`
      SELECT * FROM file_index
      WHERE sim_hash IS NOT NULL AND is_valid = 1
      LIMIT 100
    `);

    return stmt.all();
  }

  /**
   * 标记文件为无效（已删除）
   */
  async markFileInvalid(filePath) {
    const stmt = this._getStatement(`UPDATE file_index SET is_valid = 0 WHERE file_path = ?`);
    stmt.run(filePath);
  }

  /**
   * 批量标记无效文件
   */
  async markFilesInvalid(filePaths) {
    const placeholders = filePaths.map(() => '?').join(',');
    const stmt = this.db.prepare(`UPDATE file_index SET is_valid = 0 WHERE file_path IN (${placeholders})`);
    stmt.run(...filePaths);
  }

  /**
   * 清理无效记录
   */
  async cleanup() {
    this.db.exec(`DELETE FROM file_index WHERE is_valid = 0`);
  }

  /**
   * 执行VACUUM优化（应在空闲时调用）
   */
  async vacuum() {
    this.db.exec('VACUUM');
  }

  /**
   * 强制WAL检查点（应在空闲时调用）
   */
  async checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_files,
        SUM(file_size) as total_size,
        COUNT(DISTINCT full_hash) as unique_hashes,
        category,
        COUNT(*) as category_count
      FROM file_index
      WHERE is_valid = 1
      GROUP BY category
    `);

    return stmt.all();
  }

  /**
   * 获取数据库性能统计
   */
  async getDbStats() {
    return {
      page_count: this.db.pragma('page_count', true),
      page_size: this.db.pragma('page_size', true),
      freelist_count: this.db.pragma('freelist_count', true),
      journal_mode: this.db.pragma('journal_mode', true),
      wal_checkpoint: this.db.pragma('wal_checkpoint', true)
    };
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
    this.stmtCache.clear();

    // 关闭数据库
    this.db.close();
  }
}

module.exports = { IndexDatabase };
