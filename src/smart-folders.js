/**
 * 语义智能文件夹 (Dynamic Smart Folders)
 * 使用自然语言创建虚拟文件分类
 * 核心技术：Embedding向量 + 余弦相似度匹配
 */

const path = require('path');
const { EventEmitter } = require('events');

class SmartFolderManager extends EventEmitter {
  constructor(db, aiEngine) {
    super();
    this.db = db;
    this.aiEngine = aiEngine;
    this.folderCache = new Map(); // 缓存文件夹匹配结果
  }

  /**
   * 初始化数据库表
   */
  async init() {
    const sql = `
      CREATE TABLE IF NOT EXISTS smart_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        query_text TEXT NOT NULL,        -- 原始自然语言查询
        query_vector BLOB,               -- 查询向量缓存
        match_threshold REAL DEFAULT 0.75,
        auto_refresh INTEGER DEFAULT 1,  -- 是否自动刷新
        created_at REAL DEFAULT (strftime('%s', 'now')),
        updated_at REAL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS smart_folder_matches (
        folder_id INTEGER NOT NULL,
        file_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        similarity REAL NOT NULL,
        matched_at REAL DEFAULT (strftime('%s', 'now')),
        is_sticky INTEGER DEFAULT 0,     -- 是否手动固定
        PRIMARY KEY (folder_id, file_id),
        FOREIGN KEY (folder_id) REFERENCES smart_folders(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_smart_folder_matches_folder ON smart_folder_matches(folder_id, similarity);
      CREATE INDEX IF NOT EXISTS idx_smart_folder_matches_file ON smart_folder_matches(file_path);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 创建智能文件夹
   * @param {string} name - 文件夹名称
   * @param {string} queryText - 自然语言查询（如"2023年报销的PDF和发票"）
   * @param {Object} options - 配置选项
   */
  async createFolder(name, queryText, options = {}) {
    const { threshold = 0.75, description = '', autoRefresh = true } = options;

    // 1. 将查询文本转为向量
    const queryVector = await this._textToVector(queryText);

    // 2. 保存到数据库
    const folderId = await new Promise((resolve, reject) => {
      const vectorBuffer = Buffer.from(queryVector.buffer);
      this.db.run(
        `INSERT INTO smart_folders (name, description, query_text, query_vector, match_threshold, auto_refresh)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, description, queryText, vectorBuffer, threshold, autoRefresh ? 1 : 0],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // 3. 立即执行一次匹配
    await this.refreshFolder(folderId);

    this.emit('folder:created', { id: folderId, name, queryText });

    return {
      id: folderId,
      name,
      queryText,
      threshold,
      matchCount: await this.getMatchCount(folderId)
    };
  }

  /**
   * 刷新智能文件夹的匹配结果
   */
  async refreshFolder(folderId) {
    const folder = await this._getFolderById(folderId);
    if (!folder) throw new Error('文件夹不存在');

    // 获取查询向量
    const queryVector = new Float32Array(
      folder.query_vector.buffer,
      folder.query_vector.byteOffset,
      folder.query_vector.length / 4
    );

    // 获取所有已索引的文件向量
    const fileVectors = await this._getAllFileVectors();

    // 计算相似度
    const matches = [];
    for (const file of fileVectors) {
      const similarity = this._cosineSimilarity(queryVector, file.vector);
      if (similarity >= folder.match_threshold) {
        matches.push({
          folderId,
          fileId: file.id,
          filePath: file.path,
          similarity
        });
      }
    }

    // 按相似度排序
    matches.sort((a, b) => b.similarity - a.similarity);

    // 保存匹配结果（保留sticky的项目）
    await this._saveMatches(folderId, matches);

    this.emit('folder:refreshed', { folderId, matchCount: matches.length });

    return matches;
  }

  /**
   * 获取文件夹内容
   */
  async getFolderContents(folderId, options = {}) {
    const { minSimilarity = 0.7, limit = 1000, offset = 0 } = options;

    const sql = `
      SELECT
        m.file_id,
        m.file_path,
        m.similarity,
        m.is_sticky,
        f.file_size,
        f.mtime,
        f.category,
        f.extension
      FROM smart_folder_matches m
      LEFT JOIN file_index f ON m.file_path = f.file_path
      WHERE m.folder_id = ? AND m.similarity >= ?
      ORDER BY m.is_sticky DESC, m.similarity DESC
      LIMIT ? OFFSET ?
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [folderId, minSimilarity, limit, offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 固定/取消固定文件到文件夹
   */
  async toggleSticky(folderId, fileId, isSticky) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE smart_folder_matches SET is_sticky = ? WHERE folder_id = ? AND file_id = ?`,
        [isSticky ? 1 : 0, folderId, fileId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 从文件夹中移除文件
   */
  async removeFileFromFolder(folderId, fileId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM smart_folder_matches WHERE folder_id = ? AND file_id = ?`,
        [folderId, fileId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 更新文件夹查询
   */
  async updateFolderQuery(folderId, newQueryText, newThreshold) {
    const queryVector = await this._textToVector(newQueryText);
    const vectorBuffer = Buffer.from(queryVector.buffer);

    await new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE smart_folders
         SET query_text = ?, query_vector = ?, match_threshold = ?, updated_at = strftime('%s', 'now')
         WHERE id = ?`,
        [newQueryText, vectorBuffer, newThreshold, folderId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 重新匹配
    await this.refreshFolder(folderId);

    this.emit('folder:updated', { folderId, queryText: newQueryText });
  }

  /**
   * 删除智能文件夹
   */
  async deleteFolder(folderId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM smart_folders WHERE id = ?`,
        [folderId],
        (err) => {
          if (err) reject(err);
          else {
            this.folderCache.delete(folderId);
            this.emit('folder:deleted', { folderId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * 获取所有智能文件夹
   */
  async getAllFolders() {
    const sql = `
      SELECT
        f.*,
        COUNT(m.file_id) as match_count
      FROM smart_folders f
      LEFT JOIN smart_folder_matches m ON f.id = m.folder_id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 获取文件夹详情
   */
  async getFolderById(folderId) {
    const folder = await this._getFolderById(folderId);
    if (!folder) return null;

    const matchCount = await this.getMatchCount(folderId);

    return {
      ...folder,
      matchCount
    };
  }

  /**
   * 获取匹配数量
   */
  async getMatchCount(folderId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count FROM smart_folder_matches WHERE folder_id = ?`,
        [folderId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        }
      );
    });
  }

  /**
   * 搜索文件所属的文件夹
   */
  async findFoldersForFile(filePath) {
    const sql = `
      SELECT
        f.id,
        f.name,
        f.query_text,
        m.similarity
      FROM smart_folder_matches m
      JOIN smart_folders f ON m.folder_id = f.id
      WHERE m.file_path = ?
      ORDER BY m.similarity DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [filePath], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * 批量刷新所有自动刷新文件夹
   */
  async refreshAllFolders() {
    const folders = await new Promise((resolve, reject) => {
      this.db.all(
        `SELECT id FROM smart_folders WHERE auto_refresh = 1`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    for (const folder of folders) {
      try {
        await this.refreshFolder(folder.id);
      } catch (err) {
        console.error(`刷新文件夹 ${folder.id} 失败:`, err);
      }
    }

    this.emit('folders:all-refreshed', { count: folders.length });
  }

  /**
   * 将文本转为向量（使用AI引擎）
   */
  async _textToVector(text) {
    if (this.aiEngine && this.aiEngine.textToVector) {
      return await this.aiEngine.textToVector(text);
    }

    // 简单的fallback：使用词袋模型生成伪向量
    return this._simpleTextVector(text);
  }

  /**
   * 简单的文本向量化（fallback）
   */
  _simpleTextVector(text, dimensions = 384) {
    const vector = new Float32Array(dimensions);
    const words = text.toLowerCase().split(/\s+/);

    // 使用简单的哈希将词映射到维度
    for (const word of words) {
      for (let i = 0; i < word.length; i++) {
        const idx = (word.charCodeAt(i) + i * 31) % dimensions;
        vector[idx] += 1;
      }
    }

    // 归一化
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  /**
   * 获取所有文件向量
   */
  async _getAllFileVectors() {
    const sql = `
      SELECT
        f.id,
        f.file_path as path,
        v.vector
      FROM file_vectors v
      JOIN file_index f ON v.file_id = f.id
      WHERE v.model_type = 'embedding'
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const vectors = rows.map(row => ({
          id: row.id,
          path: row.path,
          vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.length / 4)
        }));

        resolve(vectors);
      });
    });
  }

  /**
   * 计算余弦相似度
   */
  _cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 获取文件夹（内部）
   */
  _getFolderById(folderId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM smart_folders WHERE id = ?`,
        [folderId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  /**
   * 保存匹配结果
   */
  async _saveMatches(folderId, matches) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        // 删除旧的非sticky匹配
        this.db.run(
          `DELETE FROM smart_folder_matches WHERE folder_id = ? AND is_sticky = 0`,
          [folderId]
        );

        // 插入新匹配
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO smart_folder_matches
           (folder_id, file_id, file_path, similarity, is_sticky)
           VALUES (?, ?, ?, ?, COALESCE(
             (SELECT is_sticky FROM smart_folder_matches WHERE folder_id = ? AND file_id = ?),
             0
           ))`
        );

        for (const match of matches) {
          stmt.run(
            match.folderId,
            match.fileId,
            match.filePath,
            match.similarity,
            match.folderId,
            match.fileId
          );
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
   * 导出文件夹为物理目录（创建符号链接）
   */
  async exportFolderToFilesystem(folderId, targetDir, options = {}) {
    const fs = require('fs').promises;
    const path = require('path');

    const { createSymlinks = true, copyFiles = false } = options;

    // 获取文件夹内容
    const files = await this.getFolderContents(folderId);

    // 创建目标目录
    const folder = await this._getFolderById(folderId);
    const exportDir = path.join(targetDir, this._sanitizeFilename(folder.name));
    await fs.mkdir(exportDir, { recursive: true });

    for (const file of files) {
      const targetPath = path.join(exportDir, path.basename(file.file_path));

      try {
        if (copyFiles) {
          await fs.copyFile(file.file_path, targetPath);
        } else if (createSymlinks) {
          await fs.symlink(file.file_path, targetPath);
        }
      } catch (err) {
        console.error(`导出文件失败 ${file.file_path}:`, err);
      }
    }

    return exportDir;
  }

  /**
   * 清理文件名
   */
  _sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
  }
}

module.exports = { SmartFolderManager };
