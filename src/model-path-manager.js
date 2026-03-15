/**
 * 模型路径管理器
 * 负责管理模型文件的存储路径，遵循操作系统标准
 * - Windows: %APPDATA%/SmartFileOrganizer/models
 * - macOS: ~/Library/Application Support/SmartFileOrganizer/models
 * - Linux: ~/.config/SmartFileOrganizer/models
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ModelPathManager {
  constructor() {
    this.appName = 'SmartFileOrganizer';
    this.modelsDirName = 'models';
    this.tempDirName = 'temp';
    this.cacheDirName = 'cache';
  }

  /**
   * 获取应用数据根目录
   */
  getAppDataPath() {
    // 在 Electron 主进程中使用 app.getPath
    // 在渲染进程或 Node 脚本中使用环境变量
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), this.appName);
    }

    // 备用方案：使用环境变量
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    const platform = process.platform;

    if (platform === 'win32') {
      return path.join(process.env.APPDATA || homeDir, this.appName);
    } else if (platform === 'darwin') {
      return path.join(homeDir, 'Library', 'Application Support', this.appName);
    } else {
      return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), this.appName);
    }
  }

  /**
   * 获取模型存储目录
   */
  getModelsDir() {
    const modelsDir = path.join(this.getAppDataPath(), this.modelsDirName);
    this._ensureDirExists(modelsDir);
    return modelsDir;
  }

  /**
   * 获取临时下载目录
   */
  getTempDir() {
    const tempDir = path.join(this.getAppDataPath(), this.tempDirName);
    this._ensureDirExists(tempDir);
    return tempDir;
  }

  /**
   * 获取缓存目录
   */
  getCacheDir() {
    const cacheDir = path.join(this.getAppDataPath(), this.cacheDirName);
    this._ensureDirExists(cacheDir);
    return cacheDir;
  }

  /**
   * 获取指定模型的完整路径
   */
  getModelPath(modelName) {
    return path.join(this.getModelsDir(), modelName);
  }

  /**
   * 获取模型临时下载路径
   */
  getTempDownloadPath(modelName) {
    return path.join(this.getTempDir(), `${modelName}.tmp`);
  }

  /**
   * 获取模型校验文件路径
   */
  getChecksumPath(modelName) {
    return path.join(this.getModelsDir(), `${modelName}.sha256`);
  }

  /**
   * 确保目录存在
   */
  _ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * 获取存储统计信息
   */
  getStorageStats() {
    const modelsDir = this.getModelsDir();
    const stats = {
      totalSize: 0,
      modelCount: 0,
      models: []
    };

    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);
      for (const file of files) {
        const filePath = path.join(modelsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && !file.endsWith('.sha256') && !file.endsWith('.tmp')) {
          stats.totalSize += stat.size;
          stats.modelCount++;
          stats.models.push({
            name: file,
            size: stat.size,
            modified: stat.mtime
          });
        }
      }
    }

    return stats;
  }

  /**
   * 清理临时文件
   */
  cleanupTempFiles() {
    const tempDir = this.getTempDir();
    if (!fs.existsSync(tempDir)) return;

    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat = fs.statSync(filePath);
      // 删除超过1天的临时文件
      if (now - stat.mtime.getTime() > oneDay) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[ModelPathManager] 清理临时文件: ${file}`);
        } catch (err) {
          console.error(`[ModelPathManager] 清理临时文件失败: ${file}`, err);
        }
      }
    }
  }

  /**
   * 验证模型文件完整性
   */
  verifyModelIntegrity(modelName, expectedChecksum = null) {
    const modelPath = this.getModelPath(modelName);
    const checksumPath = this.getChecksumPath(modelName);

    if (!fs.existsSync(modelPath)) {
      return { valid: false, error: '模型文件不存在' };
    }

    // 如果有预期的校验和，进行验证
    if (expectedChecksum) {
      const crypto = require('crypto');
      const fileBuffer = fs.readFileSync(modelPath);
      const actualChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      if (actualChecksum !== expectedChecksum.toLowerCase()) {
        return {
          valid: false,
          error: '校验和不匹配',
          expected: expectedChecksum,
          actual: actualChecksum
        };
      }
    }

    // 检查是否有保存的校验和文件
    if (fs.existsSync(checksumPath)) {
      const savedChecksum = fs.readFileSync(checksumPath, 'utf8').trim();
      const crypto = require('crypto');
      const fileBuffer = fs.readFileSync(modelPath);
      const actualChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      if (savedChecksum !== actualChecksum) {
        return {
          valid: false,
          error: '校验和不匹配',
          expected: savedChecksum,
          actual: actualChecksum
        };
      }
    }

    return { valid: true };
  }

  /**
   * 保存模型校验和
   */
  saveModelChecksum(modelName) {
    const modelPath = this.getModelPath(modelName);
    const checksumPath = this.getChecksumPath(modelName);

    if (!fs.existsSync(modelPath)) {
      return false;
    }

    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(modelPath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    fs.writeFileSync(checksumPath, checksum);
    return true;
  }
}

// 单例模式
let instance = null;

function getModelPathManager() {
  if (!instance) {
    instance = new ModelPathManager();
  }
  return instance;
}

module.exports = {
  ModelPathManager,
  getModelPathManager
};
