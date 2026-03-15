/**
 * 安全文件操作模块
 * 所有文件删除操作都移动到回收站，永不硬删除
 * 集成操作日志系统，支持撤销
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { shell } = require('electron');
const { getOperationLogger } = require('./operation-logger');

class SafeFileOperations {
  constructor() {
    this.logger = getOperationLogger();
    this.dryRunMode = false;
  }

  /**
   * 设置干跑模式
   */
  setDryRun(enabled) {
    this.dryRunMode = enabled;
    console.log(`[SafeFileOps] 干跑模式: ${enabled ? '开启' : '关闭'}`);
  }

  /**
   * 安全删除文件（移动到回收站）
   * 永远不会执行硬删除
   */
  async deleteFile(filePath, options = {}) {
    const { logOperation = true, batchId = null, metadata = {} } = options;

    // 验证文件存在
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 获取文件信息用于日志
    const stats = await fs.stat(filePath);
    const fileInfo = {
      size: stats.size,
      ...metadata
    };

    // 干跑模式：只记录，不执行
    if (this.dryRunMode) {
      console.log(`[SafeFileOps] [DRY-RUN] 将删除: ${filePath}`);
      if (logOperation) {
        await this.logger.logOperation('delete', filePath, null, {
          fileSize: stats.size,
          metadata: { ...fileInfo, dryRun: true },
          batchId
        });
      }
      return { success: true, dryRun: true, path: filePath };
    }

    // 记录操作
    let operationId = null;
    if (logOperation) {
      operationId = await this.logger.logOperation('delete', filePath, null, {
        fileSize: stats.size,
        metadata: fileInfo,
        batchId
      });
    }

    try {
      // 使用 Electron 的 shell.trashItem 移动到回收站
      await shell.trashItem(filePath);
      console.log(`[SafeFileOps] 文件已移至回收站: ${filePath}`);

      // 标记操作完成
      if (operationId) {
        await this.logger.completeOperation(operationId);
      }

      return { success: true, path: filePath, operationId };
    } catch (err) {
      console.error(`[SafeFileOps] 删除失败: ${filePath}`, err);

      // 标记操作失败
      if (operationId) {
        await this.logger.completeOperation(operationId, err.message);
      }

      throw new Error(`无法删除文件 "${path.basename(filePath)}": ${err.message}`);
    }
  }

  /**
   * 安全移动文件
   */
  async moveFile(sourcePath, targetPath, options = {}) {
    const { logOperation = true, batchId = null, metadata = {} } = options;

    // 验证源文件存在
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`源文件不存在: ${sourcePath}`);
    }

    // 确保目标目录存在
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    // 检查目标是否已存在
    try {
      await fs.access(targetPath);
      throw new Error(`目标位置已存在文件: ${targetPath}`);
    } catch (err) {
      if (!err.message.includes('目标位置已存在')) throw err;
    }

    // 获取文件信息
    const stats = await fs.stat(sourcePath);
    const fileInfo = {
      size: stats.size,
      ...metadata
    };

    // 干跑模式
    if (this.dryRunMode) {
      console.log(`[SafeFileOps] [DRY-RUN] 将移动: ${sourcePath} -> ${targetPath}`);
      if (logOperation) {
        await this.logger.logOperation('move', sourcePath, targetPath, {
          fileSize: stats.size,
          metadata: { ...fileInfo, dryRun: true },
          batchId
        });
      }
      return { success: true, dryRun: true, sourcePath, targetPath };
    }

    // 记录操作
    let operationId = null;
    if (logOperation) {
      operationId = await this.logger.logOperation('move', sourcePath, targetPath, {
        fileSize: stats.size,
        metadata: fileInfo,
        batchId
      });
    }

    try {
      // 执行移动
      await fs.rename(sourcePath, targetPath);
      console.log(`[SafeFileOps] 文件已移动: ${sourcePath} -> ${targetPath}`);

      // 标记操作完成
      if (operationId) {
        await this.logger.completeOperation(operationId);
      }

      return { success: true, sourcePath, targetPath, operationId };
    } catch (err) {
      console.error(`[SafeFileOps] 移动失败: ${sourcePath}`, err);

      // 标记操作失败
      if (operationId) {
        await this.logger.completeOperation(operationId, err.message);
      }

      throw new Error(`无法移动文件 "${path.basename(sourcePath)}": ${err.message}`);
    }
  }

  /**
   * 安全重命名文件
   */
  async renameFile(filePath, newName, options = {}) {
    const { logOperation = true, batchId = null, metadata = {} } = options;

    const dir = path.dirname(filePath);
    const newPath = path.join(dir, newName);

    // 验证文件存在
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 检查新名称是否已存在
    try {
      await fs.access(newPath);
      throw new Error(`文件名 "${newName}" 已存在`);
    } catch (err) {
      if (!err.message.includes('已存在')) throw err;
    }

    // 获取文件信息
    const stats = await fs.stat(filePath);
    const fileInfo = {
      size: stats.size,
      originalName: path.basename(filePath),
      newName,
      ...metadata
    };

    // 干跑模式
    if (this.dryRunMode) {
      console.log(`[SafeFileOps] [DRY-RUN] 将重命名: ${filePath} -> ${newName}`);
      if (logOperation) {
        await this.logger.logOperation('rename', filePath, newPath, {
          fileSize: stats.size,
          metadata: { ...fileInfo, dryRun: true },
          batchId
        });
      }
      return { success: true, dryRun: true, filePath, newName };
    }

    // 记录操作
    let operationId = null;
    if (logOperation) {
      operationId = await this.logger.logOperation('rename', filePath, newPath, {
        fileSize: stats.size,
        metadata: fileInfo,
        batchId
      });
    }

    try {
      await fs.rename(filePath, newPath);
      console.log(`[SafeFileOps] 文件已重命名: ${path.basename(filePath)} -> ${newName}`);

      // 标记操作完成
      if (operationId) {
        await this.logger.completeOperation(operationId);
      }

      return { success: true, filePath, newPath, newName, operationId };
    } catch (err) {
      console.error(`[SafeFileOps] 重命名失败: ${filePath}`, err);

      // 标记操作失败
      if (operationId) {
        await this.logger.completeOperation(operationId, err.message);
      }

      throw new Error(`无法重命名文件 "${path.basename(filePath)}": ${err.message}`);
    }
  }

  /**
   * 安全复制文件
   */
  async copyFile(sourcePath, targetPath, options = {}) {
    const { logOperation = true, batchId = null, metadata = {} } = options;

    // 验证源文件存在
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`源文件不存在: ${sourcePath}`);
    }

    // 确保目标目录存在
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    // 获取文件信息
    const stats = await fs.stat(sourcePath);
    const fileInfo = {
      size: stats.size,
      ...metadata
    };

    // 干跑模式
    if (this.dryRunMode) {
      console.log(`[SafeFileOps] [DRY-RUN] 将复制: ${sourcePath} -> ${targetPath}`);
      if (logOperation) {
        await this.logger.logOperation('copy', sourcePath, targetPath, {
          fileSize: stats.size,
          metadata: { ...fileInfo, dryRun: true },
          batchId
        });
      }
      return { success: true, dryRun: true, sourcePath, targetPath };
    }

    // 记录操作
    let operationId = null;
    if (logOperation) {
      operationId = await this.logger.logOperation('copy', sourcePath, targetPath, {
        fileSize: stats.size,
        metadata: fileInfo,
        batchId
      });
    }

    try {
      await fs.copyFile(sourcePath, targetPath);
      console.log(`[SafeFileOps] 文件已复制: ${sourcePath} -> ${targetPath}`);

      // 标记操作完成
      if (operationId) {
        await this.logger.completeOperation(operationId);
      }

      return { success: true, sourcePath, targetPath, operationId };
    } catch (err) {
      console.error(`[SafeFileOps] 复制失败: ${sourcePath}`, err);

      // 标记操作失败
      if (operationId) {
        await this.logger.completeOperation(operationId, err.message);
      }

      throw new Error(`无法复制文件 "${path.basename(sourcePath)}": ${err.message}`);
    }
  }

  /**
   * 批量执行文件操作
   */
  async executeBatch(operations, description = '批量操作') {
    const batchId = await this.logger.startBatch('batch', description, {
      dryRun: this.dryRunMode
    });

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const op of operations) {
      try {
        let result;
        switch (op.type) {
          case 'delete':
            result = await this.deleteFile(op.path, { batchId, metadata: op.metadata });
            break;
          case 'move':
            result = await this.moveFile(op.source, op.target, { batchId, metadata: op.metadata });
            break;
          case 'rename':
            result = await this.renameFile(op.path, op.newName, { batchId, metadata: op.metadata });
            break;
          case 'copy':
            result = await this.copyFile(op.source, op.target, { batchId, metadata: op.metadata });
            break;
          default:
            throw new Error(`未知操作类型: ${op.type}`);
        }
        results.push({ ...result, type: op.type });
        successCount++;
      } catch (err) {
        results.push({ success: false, error: err.message, type: op.type });
        failCount++;
      }
    }

    // 完成批次
    const status = failCount === 0 ? 'completed' : (successCount === 0 ? 'failed' : 'partial');
    await this.logger.completeBatch(batchId, status);

    return {
      batchId,
      dryRun: this.dryRunMode,
      total: operations.length,
      success: successCount,
      failed: failCount,
      results
    };
  }

  /**
   * 生成操作预览报告
   */
  generatePreviewReport(batchResult) {
    const { total, success, failed, dryRun, results } = batchResult;

    let report = `📋 操作预览报告\n`;
    report += `${'='.repeat(50)}\n\n`;
    report += `模式: ${dryRun ? '干跑（预览）' : '实际执行'}\n`;
    report += `总计: ${total} 个操作\n`;
    report += `成功: ${success} 个\n`;
    report += `失败: ${failed} 个\n\n`;

    // 按类型分组
    const byType = {};
    results.forEach(r => {
      if (!byType[r.type]) byType[r.type] = [];
      byType[r.type].push(r);
    });

    for (const [type, items] of Object.entries(byType)) {
      report += `\n【${this._getOperationTypeName(type)}】\n`;
      items.forEach((item, idx) => {
        const icon = item.success ? (dryRun ? '🔍' : '✅') : '❌';
        report += `  ${icon} ${item.path || item.sourcePath || item.source || `#${idx + 1}`}\n`;
        if (item.targetPath || item.target) {
          report += `     -> ${item.targetPath || item.target}\n`;
        }
        if (item.error) {
          report += `     错误: ${item.error}\n`;
        }
      });
    }

    return report;
  }

  _getOperationTypeName(type) {
    const names = {
      delete: '删除文件',
      move: '移动文件',
      rename: '重命名文件',
      copy: '复制文件'
    };
    return names[type] || type;
  }

  /**
   * 撤销最近的批次
   */
  async undoLastBatch() {
    const recentBatches = await this.logger.getRecentBatches(1);
    if (recentBatches.length === 0) {
      throw new Error('没有可撤销的操作');
    }

    const batch = recentBatches[0];
    if (batch.dry_run) {
      throw new Error('干跑模式的操作无法撤销');
    }

    return await this.logger.undoBatch(batch.batch_id);
  }

  /**
   * 获取操作历史
   */
  async getOperationHistory(limit = 20) {
    return await this.logger.getRecentBatches(limit);
  }
}

// 单例模式
let instance = null;

function getSafeFileOperations() {
  if (!instance) {
    instance = new SafeFileOperations();
  }
  return instance;
}

module.exports = {
  SafeFileOperations,
  getSafeFileOperations
};
