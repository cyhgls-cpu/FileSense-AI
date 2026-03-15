/**
 * SQLite3 兼容层
 * 使用 better-sqlite3 提供 sqlite3 兼容的 API
 */

const Database = require('better-sqlite3');

class SQLite3Compat {
  constructor(path, mode, callback) {
    try {
      this.db = new Database(path);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }

  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(params);
      const context = {
        lastID: result.lastInsertRowid,
        changes: result.changes
      };
      if (callback) callback.call(context, null);
      return this;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(params);
      if (callback) callback(null, row);
      return this;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(params);
      if (callback) callback(null, rows);
      return this;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }

  exec(sql, callback) {
    try {
      this.db.exec(sql);
      if (callback) callback(null);
      return this;
    } catch (err) {
      if (callback) callback(err);
      throw err;
    }
  }

  close(callback) {
    try {
      this.db.close();
      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  }

  on(event, callback) {
    // better-sqlite3 是同步的，不需要事件监听
    if (event === 'open') {
      callback();
    }
    return this;
  }
}

// 模拟 sqlite3 模块
module.exports = {
  verbose: () => ({
    Database: SQLite3Compat
  }),
  Database: SQLite3Compat
};
