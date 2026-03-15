/**
 * 操作日志系统
 * 记录所有文件操作，支持撤销功能
 * 使用 SQLite 存储操作历史
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');

class OperationLogger extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.maxUndoSteps = 50; // 最大撤销步数
    this.init();
  }

  /**
   * 初始化数据库
   */
  init() {
    const dbPath = this._getDbPath();
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('[OperationLogger] 数据库连接失败:', err);
        return;
      }
      console.log('[OperationLogger] 数据库已连接');
      this._createTables();
    });
  }

  /**
   * 获取数据库路径
   */
  _getDbPath() {
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'operations.db');
    }
    // 备用方案
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    return path.join(homeDir, '.smart-file-organizer', 'operations.db');
  }

  /**
   * 创建数据表
   */
  _createTables() {
    const createOperationsTable = `
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT UNIQUE NOT NULL,
        operation_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        source_path TEXT,
        target_path TEXT,
        file_size INTEGER,
        file_hash TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        error_message TEXT
      )
    `;

    const createBatchTable = `
      CREATE TABLE IF NOT EXISTS operation_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT UNIQUE NOT NULL,
        operation_type TEXT NOT NULL,
        description TEXT,
        total_operations INTEGER DEFAULT 0,
        completed_operations INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        dry_run BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )
    `;

    const createBatchItemsTable = `
      CREATE TABLE IF NOT EXISTS batch_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES operation_batches(batch_id),
        FOREIGN KEY (operation_id) REFERENCES operation_logs(operation_id)
      )
    `;

    this.db.run(createOperationsTable);
    this.db.run(createBatchTable);
    this.db.run(createBatchItemsTable, (err) => {
      if (err) {
        console.error('[OperationLogger] 创建表失败:', err);
      } else {
        console.log('[OperationLogger] 数据表已创建');
      }
    });
  }

  /**
   * 开始一个批量操作批次
   */
  async startBatch(operationType, description, options = {}) {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { dryRun = false } = options;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO operation_batches (batch_id, operation_type, description, dry_run)
        VALUES (?, ?, ?, ?)
      `;
      this.db.run(sql, [batchId, operationType, description, dryRun ? 1 : 0], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(batchId);
        }
      });
    });
  }

  /**
   * 记录单个操作
   */
  async logOperation(operationType, sourcePath, targetPath, options = {}) {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const {
      fileSize = 0,
      fileHash = null,
      metadata = {},
      batchId = null
    } = options;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO operation_logs
        (operation_id, operation_type, source_path, target_path, file_size, file_hash, metadata, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(sql, [
        operationId,
        operationType,
        sourcePath,
        targetPath,
        fileSize,
        fileHash,
        JSON.stringify(metadata),
        'pending'
      ], function(err) {
        if (err) {
          reject(err);
          return;
        }

        // 如果属于某个批次，添加到批次项
        if (batchId) {
          const batchSql = `
            INSERT INTO batch_items (batch_id, operation_id, sequence)
            VALUES (?, ?, (SELECT COUNT(*) FROM batch_items WHERE batch_id = ?))
          `;
          this.db.run(batchSql, [batchId, operationId, batchId]);
        }

        resolve(operationId);
      }.bind(this));
    });
  }

  /**
   * 标记操作为完成
   */
  async completeOperation(operationId, error = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE operation_logs
        SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ?
        WHERE operation_id = ?
      `;
      this.db.run(sql, [error ? 'failed' : 'completed', error, operationId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 完成批次
   */
  async completeBatch(batchId, status = 'completed') {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE operation_batches
        SET status = ?, completed_at = CURRENT_TIMESTAMP,
            completed_operations = (SELECT COUNT(*) FROM operation_logs
                                   JOIN batch_items ON operation_logs.operation_id = batch_items.operation_id
                                   WHERE batch_items.batch_id = ? AND operation_logs.status = 'completed')
        WHERE batch_id = ?
      `;
      this.db.run(sql, [status, batchId, batchId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 获取最近的批量操作（用于撤销）
   */
  async getRecentBatches(limit = 10) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM operation_batches
        WHERE status = 'completed'
        ORDER BY created_at DESC
        LIMIT ?
      `;
      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 获取批次中的所有操作
   */
  async getBatchOperations(batchId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT ol.* FROM operation_logs ol
        JOIN batch_items bi ON ol.operation_id = bi.operation_id
        WHERE bi.batch_id = ?
        ORDER BY bi.sequence DESC
      `;
      this.db.all(sql, [batchId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // 解析 metadata
          rows.forEach(row => {
            try {
              row.metadata = JSON.parse(row.metadata || '{}');
            } catch {
              row.metadata = {};
            }
          });
          resolve(rows);
        }
      });
    });
  }

  /**
   * 撤销一个批次的所有操作
   */
  async undoBatch(batchId) {
    const operations = await this.getBatchOperations(batchId);
    const undoResults = [];

    for (const op of operations) {
      try {
        const result = await this._undoOperation(op);
        undoResults.push({ operationId: op.operation_id, success: result });
      } catch (err) {
        undoResults.push({ operationId: op.operation_id, success: false, error: err.message });
      }
    }

    // 标记批次为已撤销
    await this.completeBatch(batchId, 'undone');

    this.emit('batch-undone', { batchId, results: undoResults });
    return undoResults;
  }

  /**
   * 执行单个操作的撤销
   */
  async _undoOperation(operation) {
    const fs = require('fs').promises;
    const path = require('path');

    switch (operation.operation_type) {
      case 'move':
        // 撤销移动：将文件移回原位置
        if (operation.target_path && operation.source_path) {
          await fs.access(operation.target_path);
          await fs.mkdir(path.dirname(operation.source_path), { recursive: true });
          await fs.rename(operation.target_path, operation.source_path);
          return true;
        }
        break;

      case 'rename':
        // 撤销重命名：恢复原名
        if (operation.target_path && operation.source_path) {
          await fs.access(operation.target_path);
          await fs.rename(operation.target_path, operation.source_path);
          return true;
        }
        break;

      case 'delete':
        // 删除操作无法真正撤销（文件已在回收站）
        // 记录警告
        console.warn(`[OperationLogger] 删除操作无法撤销: ${operation.source_path}`);
        return false;

      case 'copy':
        // 撤销复制：删除复制的文件
        if (operation.target_path) {
          await fs.access(operation.target_path);
          await fs.unlink(operation.target_path);
          return true;
        }
        break;

      default:
        console.warn(`[OperationLogger] 未知操作类型: ${operation.operation_type}`);
        return false;
    }

    return false;
  }

  /**
   * 获取操作统计
   */
  async getStatistics() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT
          operation_type,
          status,
          COUNT(*) as count,
          SUM(file_size) as total_size
        FROM operation_logs
        GROUP BY operation_type, status
      `;
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 清理旧的操作记录
   */
  async cleanupOldOperations(daysToKeep = 30) {
    return new Promise((resolve, reject) => {
      const sql = `
        DELETE FROM operation_logs
        WHERE created_at < datetime('now', '-${daysToKeep} days')
        AND status IN ('completed', 'failed', 'undone')
      `;
      this.db.run(sql, function(err) {
        if (err) {
          reject(err);
        } else {
          console.log(`[OperationLogger] 清理了 ${this.changes} 条旧记录`);
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('[OperationLogger] 关闭数据库失败:', err);
        } else {
          console.log('[OperationLogger] 数据库已关闭');
        }
      });
    }
  }
}

// 单例模式
let instance = null;

function getOperationLogger() {
  if (!instance) {
    instance = new OperationLogger();
  }
  return instance;
}

module.exports = {
  OperationLogger,
  getOperationLogger
};
