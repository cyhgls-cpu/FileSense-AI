/**
 * sqlite-vec 向量搜索模块
 * 纯JavaScript实现的向量相似度搜索，无需外部依赖
 * 替代sqlite-vss，Electron打包更丝滑
 */

const sqlite3 = require('sqlite3');

class SQLiteVec {
  constructor(db) {
    this.db = db;
    this.dimensions = 384; // 默认维度(bge-micro-v2)
  }

  /**
   * 初始化向量扩展
   * 创建必要的表和索引
   */
  async init() {
    const sql = `
      -- 向量元数据表
      CREATE TABLE IF NOT EXISTS vec_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT UNIQUE NOT NULL,
        dimensions INTEGER NOT NULL,
        distance_metric TEXT DEFAULT 'cosine', -- cosine, euclidean, dot
        created_at REAL DEFAULT (strftime('%s', 'now'))
      );

      -- 向量分片表（用于大型数据集）
      CREATE TABLE IF NOT EXISTS vec_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_id INTEGER NOT NULL,
        end_id INTEGER NOT NULL,
        centroid BLOB, -- 分片中心点
        UNIQUE(table_name, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_vec_chunks_table ON vec_chunks(table_name);

      -- 向量统计表
      CREATE TABLE IF NOT EXISTS vec_stats (
        table_name TEXT PRIMARY KEY,
        total_vectors INTEGER DEFAULT 0,
        last_optimized REAL,
        avg_query_time REAL
      );
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 创建向量表
   * @param {string} tableName - 表名
   * @param {number} dimensions - 向量维度
   * @param {Object} options - 配置选项
   */
  async createVectorTable(tableName, dimensions = 384, options = {}) {
    const { distanceMetric = 'cosine', withMetadata = true } = options;

    // 记录元数据
    await new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO vec_metadata (table_name, dimensions, distance_metric)
         VALUES (?, ?, ?)`,
        [tableName, dimensions, distanceMetric],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 创建主表
    const sql = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rowid INTEGER, -- 关联外部表
        vector BLOB NOT NULL, -- 二进制存储的Float32Array
        magnitude REAL, -- 预计算的向量模长（用于余弦相似度优化）
        ${withMetadata ? 'metadata TEXT,' : ''}
        created_at REAL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_${tableName}_rowid ON ${tableName}(rowid);
      CREATE INDEX IF NOT EXISTS idx_${tableName}_magnitude ON ${tableName}(magnitude);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 插入向量
   * @param {string} tableName - 表名
   * @param {Float32Array} vector - 向量数据
   * @param {Object} options - 选项
   */
  async insertVector(tableName, vector, options = {}) {
    const { rowid, metadata } = options;
    const dimensions = vector.length;

    // 计算向量模长（用于余弦相似度优化）
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));

    // 转换为Buffer存储
    const vectorBuffer = Buffer.from(vector.buffer);

    const sql = `
      INSERT INTO ${tableName} (rowid, vector, magnitude, metadata)
      VALUES (?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(
        sql,
        [rowid || null, vectorBuffer, magnitude, metadata ? JSON.stringify(metadata) : null],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  /**
   * 批量插入向量
   */
  async insertVectorsBatch(tableName, vectors) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        const stmt = this.db.prepare(`
          INSERT INTO ${tableName} (rowid, vector, magnitude, metadata)
          VALUES (?, ?, ?, ?)
        `);

        for (const { vector, rowid, metadata } of vectors) {
          const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
          const vectorBuffer = Buffer.from(vector.buffer);
          stmt.run(rowid || null, vectorBuffer, magnitude, metadata ? JSON.stringify(metadata) : null);
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
   * 相似度搜索 - 核心功能
   * @param {string} tableName - 表名
   * @param {Float32Array} queryVector - 查询向量
   * @param {number} k - 返回结果数量
   * @param {Object} options - 搜索选项
   */
  async search(tableName, queryVector, k = 10, options = {}) {
    const { threshold = 0.7, metric = 'cosine', filter = null } = options;

    // 获取表配置
    const config = await this._getTableConfig(tableName);
    const distanceMetric = metric || config.distance_metric || 'cosine';

    // 计算查询向量的模长
    const queryMagnitude = Math.sqrt(queryVector.reduce((sum, v) => sum + v * v, 0));

    let sql, params;

    if (distanceMetric === 'cosine') {
      // 余弦相似度 = dot / (|a| * |b|)
      // 预计算magnitude优化性能
      sql = `
        SELECT
          id,
          rowid,
          metadata,
          (dot_product / (magnitude * ?)) as similarity
        FROM (
          SELECT
            id,
            rowid,
            metadata,
            magnitude,
            (${this._dotProductSQL('vector', queryVector)}) as dot_product
          FROM ${tableName}
          ${filter ? `WHERE ${filter}` : ''}
        )
        WHERE dot_product / (magnitude * ?) >= ?
        ORDER BY similarity DESC
        LIMIT ?
      `;
      params = [queryMagnitude, queryMagnitude, threshold, k];
    } else if (distanceMetric === 'euclidean') {
      // 欧氏距离
      sql = `
        SELECT
          id,
          rowid,
          metadata,
          SQRT(${this._euclideanDistanceSQL('vector', queryVector)}) as distance,
          1 / (1 + SQRT(${this._euclideanDistanceSQL('vector', queryVector)})) as similarity
        FROM ${tableName}
        ${filter ? `WHERE ${filter}` : ''}
        ORDER BY distance ASC
        LIMIT ?
      `;
      params = [k];
    } else {
      // 点积
      sql = `
        SELECT
          id,
          rowid,
          metadata,
          (${this._dotProductSQL('vector', queryVector)}) as dot_product
        FROM ${tableName}
        ${filter ? `WHERE ${filter}` : ''}
        ORDER BY dot_product DESC
        LIMIT ?
      `;
      params = [k];
    }

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        // 解析结果
        const results = rows.map(row => ({
          id: row.id,
          rowid: row.rowid,
          similarity: row.similarity || row.dot_product || 0,
          distance: row.distance,
          metadata: row.metadata ? JSON.parse(row.metadata) : null
        }));

        resolve(results);
      });
    });
  }

  /**
   * 生成点积计算的SQL片段
   */
  _dotProductSQL(column, vector) {
    const terms = [];
    for (let i = 0; i < vector.length; i++) {
      // 使用substr提取4字节并转换为float
      terms.push(`(
        CAST(
          ((CAST(substr(${column}, ${i * 4 + 1}, 1) AS INTEGER) << 0) |
           (CAST(substr(${column}, ${i * 4 + 2}, 1) AS INTEGER) << 8) |
           (CAST(substr(${column}, ${i * 4 + 3}, 1) AS INTEGER) << 16) |
           (CAST(substr(${column}, ${i * 4 + 4}, 1) AS INTEGER) << 24))
          AS REAL) / 1000000000.0 * ${vector[i].toFixed(10)}
      )`);
    }
    return terms.join(' + ');
  }

  /**
   * 生成欧氏距离计算的SQL片段
   */
  _euclideanDistanceSQL(column, vector) {
    const terms = [];
    for (let i = 0; i < vector.length; i++) {
      terms.push(`POWER(
        CAST(
          ((CAST(substr(${column}, ${i * 4 + 1}, 1) AS INTEGER) << 0) |
           (CAST(substr(${column}, ${i * 4 + 2}, 1) AS INTEGER) << 8) |
           (CAST(substr(${column}, ${i * 4 + 3}, 1) AS INTEGER) << 16) |
           (CAST(substr(${column}, ${i * 4 + 4}, 1) AS INTEGER) << 24))
          AS REAL) / 1000000000.0 - ${vector[i].toFixed(10)}, 2
      )`);
    }
    return terms.join(' + ');
  }

  /**
   * 获取表配置
   */
  async _getTableConfig(tableName) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM vec_metadata WHERE table_name = ?',
        [tableName],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        }
      );
    });
  }

  /**
   * 删除向量
   */
  async deleteVector(tableName, id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM ${tableName} WHERE id = ?`,
        [id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 删除关联的向量
   */
  async deleteVectorsByRowid(tableName, rowid) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM ${tableName} WHERE rowid = ?`,
        [rowid],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 获取表统计信息
   */
  async getStats(tableName) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT COUNT(*) as count, AVG(magnitude) as avg_magnitude FROM ${tableName}`,
        (err, row) => {
          if (err) reject(err);
          else resolve({
            vectorCount: row.count,
            averageMagnitude: row.avg_magnitude
          });
        }
      );
    });
  }

  /**
   * 删除向量表
   */
  async dropTable(tableName) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(`DROP TABLE IF EXISTS ${tableName}`);
        this.db.run(`DELETE FROM vec_metadata WHERE table_name = ?`, [tableName]);
        this.db.run(`DELETE FROM vec_stats WHERE table_name = ?`, [tableName], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
}

/**
 * 优化的向量搜索 - 使用分片索引（大规模数据集）
 */
class PartitionedVectorIndex {
  constructor(sqliteVec, tableName, partitionSize = 10000) {
    this.vec = sqliteVec;
    this.tableName = tableName;
    this.partitionSize = partitionSize;
    this.partitions = new Map();
  }

  /**
   * 构建分片索引
   */
  async buildIndex() {
    // 获取所有向量并分片
    const vectors = await new Promise((resolve, reject) => {
      this.vec.db.all(
        `SELECT id, vector FROM ${this.tableName}`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // 计算分片中心点
    const numPartitions = Math.ceil(vectors.length / this.partitionSize);

    for (let i = 0; i < numPartitions; i++) {
      const start = i * this.partitionSize;
      const end = Math.min((i + 1) * this.partitionSize, vectors.length);
      const partitionVectors = vectors.slice(start, end);

      // 计算中心点
      const centroid = this._calculateCentroid(partitionVectors);

      // 保存分片信息
      await new Promise((resolve, reject) => {
        this.vec.db.run(
          `INSERT OR REPLACE INTO vec_chunks
           (table_name, chunk_index, start_id, end_id, centroid)
           VALUES (?, ?, ?, ?, ?)`,
          [this.tableName, i, partitionVectors[0].id, partitionVectors[partitionVectors.length - 1].id,
           Buffer.from(centroid.buffer)],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }
  }

  /**
   * 计算中心点
   */
  _calculateCentroid(vectors) {
    const dimensions = vectors[0].vector.length / 4; // Float32 = 4 bytes
    const centroid = new Float32Array(dimensions);

    for (const v of vectors) {
      const vec = new Float32Array(v.vector.buffer, v.vector.byteOffset, dimensions);
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += vec[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= vectors.length;
    }

    return centroid;
  }

  /**
   * 使用分片索引加速搜索
   */
  async search(queryVector, k = 10) {
    // 获取所有分片中心点
    const chunks = await new Promise((resolve, reject) => {
      this.vec.db.all(
        `SELECT * FROM vec_chunks WHERE table_name = ?`,
        [this.tableName],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // 计算与每个分片的距离，选择最近的分片
    const chunkDistances = chunks.map(chunk => {
      const centroid = new Float32Array(chunk.centroid.buffer, chunk.centroid.byteOffset,
        chunk.centroid.length / 4);
      return {
        index: chunk.chunk_index,
        distance: this._cosineDistance(queryVector, centroid)
      };
    });

    chunkDistances.sort((a, b) => a.distance - b.distance);

    // 只搜索最近的分片（可配置搜索多个分片）
    const targetChunk = chunks.find(c => c.chunk_index === chunkDistances[0].index);

    // 在目标分片内搜索
    return new Promise((resolve, reject) => {
      this.vec.db.all(
        `SELECT * FROM ${this.tableName}
         WHERE id >= ? AND id <= ?`,
        [targetChunk.start_id, targetChunk.end_id],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          // 计算相似度并排序
          const results = rows.map(row => {
            const vec = new Float32Array(row.vector.buffer, row.vector.byteOffset,
              row.vector.length / 4);
            return {
              ...row,
              similarity: this._cosineSimilarity(queryVector, vec)
            };
          });

          results.sort((a, b) => b.similarity - a.similarity);
          resolve(results.slice(0, k));
        }
      );
    });
  }

  _cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  _cosineDistance(a, b) {
    return 1 - this._cosineSimilarity(a, b);
  }
}

module.exports = {
  SQLiteVec,
  PartitionedVectorIndex
};
