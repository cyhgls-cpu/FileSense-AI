/**
 * 批量事务写入器
 * 优化 SQLite 数据库写入性能
 * 关键策略：
 * - 批量攒批，定期提交
 * - 预编译 SQL 语句
 * - 异步队列处理
 */

const sqlite3 = require('sqlite3').verbose();

class BatchWriter {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.batchSize = options.batchSize || 10000; // 每 1 万条提交一次
    this.flushInterval = options.flushInterval || 5000; // 每 5 秒强制刷新
    
    this.db = null;
    this.insertStmt = null;
    this.pending = [];
    this.transactionActive = false;
    this.flushTimer = null;
    
    this.stats = {
      totalWritten: 0,
      batchCount: 0,
      avgBatchTime: 0
    };
  }

  /**
   * 初始化数据库连接
   */
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // 优化 SQLite 配置
        this._optimizeDatabase();
        
        // 预编译 INSERT 语句
        const sql = `
          INSERT OR REPLACE INTO file_index 
          (file_path, file_size, mtime, category, extension, sparse_hash, full_hash, 
           perceptual_hash, sim_hash, scan_time, is_valid)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), 1)
        `;
        
        this.insertStmt = this.db.prepare(sql);
        
        // 启动定时刷新
        this._startFlushTimer();
        
        console.log(`批量写入器初始化完成`);
        console.log(`  - 批次大小：${this.batchSize} 条`);
        console.log(`  - 刷新间隔：${this.flushInterval / 1000} 秒`);
        
        resolve();
      });
    });
  }

  /**
   * 优化 SQLite 配置
   */
  _optimizeDatabase() {
    const optimizations = [
      'PRAGMA journal_mode = WAL',           // WAL 模式提升并发
      'PRAGMA synchronous = NORMAL',         // 平衡性能和安全性
      'PRAGMA cache_size = -64000',          // 64MB 缓存
      'PRAGMA temp_store = MEMORY',          // 临时表存内存
      'PRAGMA mmap_size = 268435456',        // 256MB 内存映射
      'PRAGMA page_size = 4096'              // 4KB 页大小
    ];

    for (const pragma of optimizations) {
      this.db.exec(pragma, (err) => {
        if (err) console.warn(`优化失败 ${pragma}:`, err.message);
      });
    }
  }

  /**
   * 启动定时刷新
   */
  _startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushTimer = setInterval(() => {
      if (this.pending.length > 0) {
        this.flush();
      }
    }, this.flushInterval);
  }

  /**
   * 添加记录到待写队列
   */
  write(record) {
    this.pending.push(record);
    
    // 达到批次大小时立即刷新
    if (this.pending.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * 批量写入数据库
   */
  async flush() {
    if (this.pending.length === 0 || this.transactionActive) {
      return;
    }

    const batch = [...this.pending];
    this.pending = [];
    this.transactionActive = true;

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      try {
        this.db.serialize(() => {
          this.db.exec('BEGIN TRANSACTION', (err) => {
            if (err) {
              this.transactionActive = false;
              // 恢复 pending 数据
              this.pending.unshift(...batch);
              reject(err);
              return;
            }

            // 批量插入
            for (const record of batch) {
              this.insertStmt.run(
                record.path,
                record.size,
                record.mtime,
                record.category,
                record.extension,
                record.sparseHash || null,
                record.fullHash || null,
                record.perceptualHash ? record.perceptualHash.phash : null,
                record.simHash || null,
                (err) => {
                  if (err) {
                    console.error(`插入失败 ${record.path}:`, err.message);
                  }
                }
              );
            }

            this.db.exec('COMMIT', (err) => {
              this.transactionActive = false;
              
              if (err) {
                this.db.exec('ROLLBACK', () => {
                  // 恢复 pending 数据
                  this.pending.unshift(...batch);
                  reject(err);
                });
                return;
              }

              // 更新统计
              const elapsed = Date.now() - startTime;
              this.stats.totalWritten += batch.length;
              this.stats.batchCount++;
              this.stats.avgBatchTime = 
                (this.stats.avgBatchTime * (this.stats.batchCount - 1) + elapsed) / this.stats.batchCount;

              console.log(`批量写入完成：${batch.length} 条，耗时 ${elapsed.toFixed(0)}ms, ` +
                         `平均 ${(this.stats.avgBatchTime / batch.length).toFixed(2)}ms/条`);

              resolve();
            });
          });
        });
      } catch (err) {
        this.transactionActive = false;
        this.pending.unshift(...batch);
        reject(err);
      }
    });
  }

  /**
   * 关闭写入器
   */
  async close() {
    // 停止定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新剩余数据
    if (this.pending.length > 0) {
      await this.flush();
    }

    // 关闭数据库
    return new Promise((resolve, reject) => {
      if (this.insertStmt) {
        this.insertStmt.finalize((err) => {
          if (err) reject(err);
        });
      }

      this.db.close((err) => {
        if (err) reject(err);
        else {
          console.log(`批量写入器关闭，共写入 ${this.stats.totalWritten.toLocaleString()} 条记录`);
          resolve();
        }
      });
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      pendingCount: this.pending.length,
      transactionActive: this.transactionActive
    };
  }
}

module.exports = { BatchWriter };
