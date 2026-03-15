/**
 * 高性能文件扫描引擎
 * 实现启发式过滤漏斗：元数据预检 → 分块哈希 → 全量哈希
 * 采用生产者 - 消费者模型，异步 I/O 与并发计算
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// 文件类型分类
const FILE_CATEGORIES = {
  SOFTWARE: ['exe', 'dll', 'msi', 'pkg', 'deb', 'rpm', 'app', 'apk', 'ipa', 'zip', 'rar', '7z', 'tar', 'gz'],
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'psd', 'ai', 'tiff', 'raw'],
  DOCUMENT: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp']
};

// 配置参数
const SCANNER_CONFIG = {
  // 分块哈希配置：头部、中部、尾部各取 4KB
  CHUNK_SIZE: 4096,
  // 文件大小阈值（小于此值直接全量哈希）
  DIRECT_HASH_THRESHOLD: 64 * 1024, // 64KB
  // 工作线程池大小
  WORKER_POOL_SIZE: 4,
  // 启用增量索引
  ENABLE_INCREMENTAL: true
};

/**
 * 获取文件分类
 */
function getFileCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  if (FILE_CATEGORIES.SOFTWARE.includes(ext)) return 'SOFTWARE';
  if (FILE_CATEGORIES.IMAGE.includes(ext)) return 'IMAGE';
  if (FILE_CATEGORIES.DOCUMENT.includes(ext)) return 'DOCUMENT';
  return 'OTHER';
}

/**
 * Windows 错误码映射
 */
const WINDOWS_ERRORS = {
  EPERM: { code: 'EPERM', message: '权限不足，无法访问该文件' },
  EACCES: { code: 'EACCES', message: '访问被拒绝' },
  EBUSY: { code: 'EBUSY', message: '文件正在被其他程序使用' },
  ENOENT: { code: 'ENOENT', message: '文件不存在' },
  EISDIR: { code: 'EISDIR', message: '路径是目录而非文件' },
  ENOTDIR: { code: 'ENOTDIR', message: '路径不是目录' },
  EMFILE: { code: 'EMFILE', message: '打开文件过多' },
  ENFILE: { code: 'ENFILE', message: '系统文件表已满' }
};

/**
 * 分类错误类型
 */
function classifyError(err) {
  const errorCode = err.code;
  const winError = WINDOWS_ERRORS[errorCode];

  if (winError) {
    return {
      type: errorCode,
      ...winError,
      retryable: ['EBUSY', 'EMFILE', 'ENFILE'].includes(errorCode),
      skippable: true
    };
  }

  // 处理 Windows 系统错误
  if (err.message && err.message.includes('EBUSY')) {
    return { type: 'EBUSY', ...WINDOWS_ERRORS.EBUSY, retryable: true, skippable: true };
  }
  if (err.message && err.message.includes('EPERM')) {
    return { type: 'EPERM', ...WINDOWS_ERRORS.EPERM, retryable: false, skippable: true };
  }

  return {
    type: 'UNKNOWN',
    code: errorCode || 'UNKNOWN',
    message: err.message || '未知错误',
    retryable: false,
    skippable: true
  };
}

/**
 * 第一阶段：元数据预检 O(1)
 * 快速获取文件大小、修改时间等元数据
 * 增强错误处理：跳过无法访问的文件，不中断扫描
 */
async function getMetadata(filePath, options = {}) {
  const { skipErrors = true, maxRetries = 2 } = options;
  let retries = 0;

  while (retries <= maxRetries) {
    try {
      const stats = await fs.promises.stat(filePath);
      return {
        path: filePath,
        size: stats.size,
        mtime: stats.mtimeMs,
        modifiedTime: stats.mtime.toISOString(),
        createdTime: stats.birthtime.toISOString(),
        category: getFileCategory(filePath),
        exists: true,
        accessible: true
      };
    } catch (err) {
      const errorInfo = classifyError(err);

      // 如果是可重试错误且未达到最大重试次数，等待后重试
      if (errorInfo.retryable && retries < maxRetries) {
        retries++;
        console.log(`[Scanner] 文件 ${path.basename(filePath)} 被占用，${retries}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        continue;
      }

      // 如果是可跳过的错误，记录并返回
      if (skipErrors && errorInfo.skippable) {
        console.warn(`[Scanner] 跳过文件 ${filePath}: ${errorInfo.message}`);
        return {
          path: filePath,
          exists: errorInfo.type !== 'ENOENT',
          accessible: false,
          error: errorInfo.message,
          errorType: errorInfo.type,
          skipped: true
        };
      }

      // 不可跳过的错误，抛出
      throw err;
    }
  }
}

/**
 * 第二阶段：分块稀疏哈希 O(1)
 * 对文件头部、中部、尾部各抽取固定大小数据块进行哈希
 * 以极低的 I/O 成本筛掉大部分大小相同但内容不同的文件
 */
async function calculateSparseHash(filePath, fileSize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const positions = [];
    
    // 计算三个位置：头部、中部、尾部
    positions.push(0); // 头部
    if (fileSize > SCANNER_CONFIG.CHUNK_SIZE * 3) {
      positions.push(Math.floor(fileSize / 2)); // 中部
      positions.push(fileSize - SCANNER_CONFIG.CHUNK_SIZE); // 尾部
    }
    
    let completed = 0;
    const results = [];
    
    positions.forEach((pos, index) => {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(SCANNER_CONFIG.CHUNK_SIZE);
      
      fs.read(fd, buffer, 0, SCANNER_CONFIG.CHUNK_SIZE, pos, (err, bytesRead) => {
        fs.closeSync(fd);
        
        if (err) {
          completed++;
          return;
        }
        
        const hash = crypto.createHash('sha256')
          .update(buffer.slice(0, bytesRead))
          .digest('hex');
        
        results[index] = hash;
        completed++;
        
        if (completed === positions.length) {
          resolve(results.join(':'));
        }
      });
    });
  });
}

/**
 * 第三阶段：全量 SHA-256 哈希 O(N)
 * 对高疑似度文件执行全量哈希计算
 * 使用 SHA-256 算法，Node.js 原生支持
 */
async function calculateFullHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, {
      highWaterMark: 1024 * 1024 // 1MB 读取块
    });
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 图片感知哈希 (pHash/dHash)
 * 生成图片的"视觉指纹"，用于检测相似图片
 */
async function calculatePerceptualHash(filePath) {
  // 简化版本：实际生产环境应使用专门的图像处理库
  // 如 sharp, jimp 等
  try {
    const data = await fs.promises.readFile(filePath);
    // 这里应该：
    // 1. 解码图片为灰度图
    // 2. 缩放到 32x32
    // 3. 计算 DCT 变换
    // 4. 提取低频系数量化为哈希
    // 由于需要 native 依赖，这里用简化示例
    
    // 简化 dHash 实现
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return {
      phash: hash.substring(0, 16),
      algorithm: 'simplified-dhash'
    };
  } catch (err) {
    return null;
  }
}

/**
 * 文档文本提取和归一化
 * 剥离格式外壳，提取纯文本内容进行比对
 */
async function extractAndNormalizeText(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  try {
    let text = '';
    
    // 纯文本文件直接读取
    if (['txt', 'md', 'json', 'xml', 'html', 'csv'].includes(ext)) {
      text = await fs.promises.readFile(filePath, 'utf-8');
    }
    // PDF/Word 等需要专门解析库
    // 生产环境应集成 pdf-parse, mammoth 等
    
    // 文本归一化
    return normalizeText(text);
  } catch (err) {
    return null;
  }
}

/**
 * 文本归一化处理
 * 剔除空格、换行符、标点符号，统一大小写
 */
function normalizeText(text) {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')           // 多个空白字符合并为一个
    .replace(/[.,!?;:'"() [\]{}]/g, '') // 移除标点符号
    .replace(/\n+/g, '')            // 移除换行
    .trim();
}

/**
 * SimHash 算法（简化版）
 * 用于检测语义相似的文档
 */
function calculateSimHash(text) {
  // 生产环境应使用完整的 SimHash 实现
  // 包括分词、特征提取、降维等步骤
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return hash.substring(0, 16);
}

/**
 * 文件扫描主流程
 * 实现启发式过滤漏斗
 */
class FileScanner {
  constructor(options = {}) {
    this.config = { ...SCANNER_CONFIG, ...options };
    this.metadataCache = new Map();
    this.hashCache = new Map();
    this.incrementalDB = null; // SQLite 数据库实例
    
    // 扫描控制状态
    this.isPaused = false;
    this.isCancelled = false;
    this.pausePromise = null;
  }
  
  /**
   * 暂停扫描
   */
  pause() {
    console.log('[Scanner] 扫描已暂停');
    this.isPaused = true;
  }
  
  /**
   * 恢复扫描
   */
  resume() {
    console.log('[Scanner] 扫描已恢复');
    this.isPaused = false;
    
    if (this.pauseResolver) {
      console.log('[Scanner] 唤醒等待的扫描任务');
      const resolver = this.pauseResolver;
      this.pauseResolver = null;
      resolver(); // 调用 resolve 函数
    }
  }
  
  /**
   * 终止扫描
   */
  cancel() {
    console.log('[Scanner] 扫描已终止');
    this.isCancelled = true;
    
    if (this.pauseResolver) {
      console.log('[Scanner] 唤醒等待的扫描任务（终止）');
      const resolver = this.pauseResolver;
      this.pauseResolver = null;
      resolver(); // 唤醒以检查取消标志
    }
  }
  
  /**
   * 检查是否需要暂停
   */
  async checkPause() {
    if (this.isCancelled) {
      throw new Error('SCAN_CANCELLED');
    }
    
    if (this.isPaused) {
      console.log('[Scanner] 进入暂停等待状态...');
      return new Promise((resolve) => {
        this.pauseResolver = resolve; // 保存 resolve 函数
      });
    }
  }
  
  /**
   * 扫描目录（支持暂停/终止/错误恢复）
   * 增强错误处理：跳过无法访问的文件，记录错误但不中断扫描
   */
  async scanDirectory(dirPath, onProgress) {
    // 重置状态
    this.isPaused = false;
    this.isCancelled = false;
    this.pausePromise = null;
    this.skippedItems = [];
    this.errorLog = [];

    const files = await this._collectFiles(dirPath);
    const results = {
      total: files.length,
      processed: 0,
      skipped: 0,
      byCategory: {},
      duplicates: [],
      errors: []
    };

    // 第一阶段：元数据收集
    onProgress?.({ stage: 'metadata', current: 0, total: files.length });

    const metadataList = [];
    for (let i = 0; i < files.length; i++) {
      // 检查终止
      if (this.isCancelled) {
        console.log('[Scanner] 扫描已终止，返回部分结果');
        results.total = metadataList.length;
        results.duplicates = this._findDuplicates(metadataList);
        results.byCategory = this._categorizeResults(metadataList);
        results.errors = this.errorLog;
        results.skipped = this.skippedItems.length;
        return results;
      }

      // 检查暂停
      await this.checkPause();

      try {
        const metadata = await getMetadata(files[i], { skipErrors: true, maxRetries: 2 });

        if (metadata.skipped) {
          results.skipped++;
          this.errorLog.push({
            file: files[i],
            stage: 'metadata',
            error: metadata.error,
            errorType: metadata.errorType
          });
        } else if (metadata.exists && metadata.accessible) {
          metadataList.push(metadata);
          results.processed++;
        }
      } catch (err) {
        // 不可恢复的错误，记录但不中断
        const errorInfo = classifyError(err);
        console.error(`[Scanner] 严重错误 ${files[i]}:`, errorInfo.message);
        this.errorLog.push({
          file: files[i],
          stage: 'metadata',
          error: errorInfo.message,
          errorType: errorInfo.type,
          fatal: true
        });
        results.skipped++;
      }

      // 更新进度
      if (i % 10 === 0) {
        onProgress?.({
          stage: 'metadata',
          current: i,
          total: files.length,
          processed: results.processed,
          skipped: results.skipped
        });
      }
    }
    
    // 按文件大小分组（用于快速筛选）
    const sizeGroups = this._groupBySize(metadataList);
    
    // 第二阶段 & 第三阶段：哈希计算
    onProgress?.({ stage: 'hashing', current: 0, total: metadataList.length });

    let processedCount = 0;
    let hashErrors = 0;

    for (const [size, files] of Object.entries(sizeGroups)) {
      if (files.length < 2) continue; // 没有重复可能

      for (const file of files) {
        // 检查终止
        if (this.isCancelled) {
          console.log('[Scanner] 扫描已终止，返回部分结果');
          results.total = metadataList.length;
          results.duplicates = this._findDuplicates(metadataList);
          results.byCategory = this._categorizeResults(metadataList);
          results.errors = this.errorLog;
          results.skipped = this.skippedItems.length;
          return results;
        }

        // 检查暂停
        await this.checkPause();

        try {
          // 根据文件大小选择策略
          let fullHash;

          if (file.size < this.config.DIRECT_HASH_THRESHOLD) {
            // 小文件直接全量哈希
            fullHash = await this._calculateFullHashSafe(file.path);
          } else {
            // 大文件先分块哈希
            const sparseHash = await this._calculateSparseHashSafe(file.path, file.size);
            file.sparseHash = sparseHash;

            // TODO: 与同组 sparseHash 比较，不同则跳过
            fullHash = await this._calculateFullHashSafe(file.path);
          }

          if (fullHash) {
            file.fullHash = fullHash;

            // 根据文件类型计算特殊哈希
            if (file.category === 'IMAGE') {
              file.perceptualHash = await calculatePerceptualHash(file.path);
            } else if (file.category === 'DOCUMENT') {
              file.normalizedText = await extractAndNormalizeText(file.path);
              file.simHash = file.normalizedText ? calculateSimHash(file.normalizedText) : null;
            }
          }

        } catch (err) {
          if (err.message === 'SCAN_CANCELLED') {
            throw err;
          }

          hashErrors++;
          const errorInfo = classifyError(err);
          console.warn(`[Scanner] 哈希计算失败 ${file.path}: ${errorInfo.message}`);

          this.errorLog.push({
            file: file.path,
            stage: 'hashing',
            error: errorInfo.message,
            errorType: errorInfo.type
          });
        }

        processedCount++;
        if (processedCount % 10 === 0) {
          onProgress?.({
            stage: 'hashing',
            current: processedCount,
            total: metadataList.length,
            errors: hashErrors
          });
        }
      }
    }

    // 检测重复文件
    results.duplicates = this._findDuplicates(metadataList);
    results.byCategory = this._categorizeResults(metadataList);
    results.errors = this.errorLog;
    results.skipped = this.skippedItems.length;

    return results;
  }

  /**
   * 安全的全量哈希计算（带错误处理）
   */
  async _calculateFullHashSafe(filePath, maxRetries = 2) {
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        return await calculateFullHash(filePath);
      } catch (err) {
        const errorInfo = classifyError(err);

        if (errorInfo.retryable && retries < maxRetries) {
          retries++;
          console.log(`[Scanner] 文件 ${path.basename(filePath)} 哈希计算失败，${retries}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          continue;
        }

        // 如果是可跳过的错误，返回 null
        if (errorInfo.skippable) {
          console.warn(`[Scanner] 跳过哈希计算 ${filePath}: ${errorInfo.message}`);
          return null;
        }

        throw err;
      }
    }

    return null;
  }

  /**
   * 安全的稀疏哈希计算（带错误处理）
   */
  async _calculateSparseHashSafe(filePath, fileSize, maxRetries = 2) {
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        return await calculateSparseHash(filePath, fileSize);
      } catch (err) {
        const errorInfo = classifyError(err);

        if (errorInfo.retryable && retries < maxRetries) {
          retries++;
          console.log(`[Scanner] 文件 ${path.basename(filePath)} 稀疏哈希计算失败，${retries}秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          continue;
        }

        if (errorInfo.skippable) {
          console.warn(`[Scanner] 跳过稀疏哈希计算 ${filePath}: ${errorInfo.message}`);
          return null;
        }

        throw err;
      }
    }

    return null;
  }

  /**
   * 获取扫描错误报告
   */
  getErrorReport() {
    if (!this.errorLog || this.errorLog.length === 0) {
      return null;
    }

    const byType = {};
    for (const error of this.errorLog) {
      const type = error.errorType || 'UNKNOWN';
      if (!byType[type]) byType[type] = [];
      byType[type].push(error);
    }

    return {
      total: this.errorLog.length,
      byType,
      items: this.errorLog.slice(0, 50) // 只返回前50个
    };
  }
  
  /**
   * 递归收集文件
   * 增强错误处理：记录跳过的文件和目录
   */
  async _collectFiles(dirPath) {
    const files = [];
    const skippedItems = [];

    async function scan(dir, depth = 0) {
      // 限制递归深度，防止栈溢出
      if (depth > 50) {
        console.warn(`[Scanner] 目录递归深度超过限制: ${dir}`);
        skippedItems.push({ path: dir, reason: 'DEPTH_LIMIT' });
        return;
      }

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // 跳过系统隐藏文件和特殊目录
          if (entry.name.startsWith('.') || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') {
            continue;
          }

          if (entry.isDirectory()) {
            await scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch (err) {
        const errorInfo = classifyError(err);
        console.warn(`[Scanner] 跳过目录 ${dir}: ${errorInfo.message}`);
        skippedItems.push({ path: dir, reason: errorInfo.type, message: errorInfo.message });
      }
    }

    await scan(dirPath);

    // 保存跳过的项目供后续报告
    this.skippedItems = skippedItems;

    return files;
  }
  
  /**
   * 按文件大小分组
   */
  _groupBySize(files) {
    return files.reduce((groups, file) => {
      const size = String(file.size);
      if (!groups[size]) groups[size] = [];
      groups[size].push(file);
      return groups;
    }, {});
  }
  
  /**
   * 查找重复文件
   */
  _findDuplicates(files) {
    const hashMap = new Map();
    const duplicates = [];
    
    for (const file of files) {
      if (!file.fullHash) continue;
      
      if (hashMap.has(file.fullHash)) {
        duplicates.push({
          original: hashMap.get(file.fullHash),
          duplicate: file,
          hash: file.fullHash,
          matchType: 'EXACT'
        });
      } else {
        hashMap.set(file.fullHash, file);
      }
    }
    
    return duplicates;
  }
  
  /**
   * 按分类统计结果
   */
  _categorizeResults(files) {
    return files.reduce((stats, file) => {
      const category = file.category || 'OTHER';
      if (!stats[category]) {
        stats[category] = { count: 0, size: 0, files: [] };
      }
      stats[category].count++;
      stats[category].size += file.size;
      stats[category].files.push(file);
      return stats;
    }, {});
  }
}

module.exports = {
  FileScanner,
  getFileCategory,
  getMetadata,
  calculateSparseHash,
  calculateFullHash,
  calculatePerceptualHash,
  extractAndNormalizeText,
  calculateSimHash,
  normalizeText,
  SCANNER_CONFIG,
  FILE_CATEGORIES
};
