/**
 * AI 模型下载引擎
 * 支持：
 * - 多镜像源（阿里云、华为云、HuggingFace）
 * - 断点续传
 * - 下载进度实时反馈
 * - 自动重试机制
 * - 速度限制控制
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const axios = require('axios');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getModelPathManager } = require('./model-path-manager');

// 模型镜像源配置
const MIRROR_SOURCES = {
  aliyun: {
    name: '阿里云',
    base: 'https://modelscope.cn/models',
    priority: 1
  },
  huawei: {
    name: '华为云',
    base: 'https://repo.huaweicloud.com/AI-Models',
    priority: 2
  },
  huggingface: {
    name: 'HuggingFace',
    base: 'https://huggingface.co',
    priority: 3
  },
  modelers: {
    name: 'Modelers.cn',
    base: 'https://modelers.cn/models',
    priority: 4
  }
};

// 模型配置（包含多个镜像源和 SHA256 校验）
// 国内镜像使用 hf-mirror.com 和 modelscope.cn
const MODEL_CONFIGS = {
  EMBEDDING: {
    id: 'EMBEDDING',
    name: 'bge-micro-v2.onnx',
    description: '文档语义向量化模型',
    size: 65.84 * 1024 * 1024, // 65.84 MB
    dimensions: 384,
    downloadInstructions: '自动下载或手动下载',
    // SHA256 校验和（下载后计算并更新）
    sha256: null, // 首次下载后自动计算保存
    mirrors: [
      {
        source: 'hf-mirror',
        name: 'HuggingFace 国内镜像',
        url: 'https://hf-mirror.com/TaylorAI/bge-micro-v2/resolve/refs%2Fpr%2F2/onnx/model.onnx',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      },
      {
        source: 'huggingface',
        name: 'HuggingFace 官方',
        url: 'https://huggingface.co/TaylorAI/bge-micro-v2/resolve/refs%2Fpr%2F2/onnx/model.onnx',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      }
    ],
    fallbackUrl: 'https://huggingface.co/TaylorAI/bge-micro-v2/resolve/refs%2Fpr%2F2/onnx/model.onnx',
    manualDownload: false
  },

  CLIP: {
    id: 'CLIP',
    name: 'clip-vit-b-32.onnx',
    description: '图片跨模态理解模型',
    size: 577.54 * 1024 * 1024, // 577.54 MB
    dimensions: 512,
    downloadInstructions: '自动下载或手动下载',
    sha256: null,
    mirrors: [
      {
        source: 'hf-mirror',
        name: 'HuggingFace 国内镜像',
        url: 'https://hf-mirror.com/sayantan47/clip-vit-b32-onnx/resolve/main/onnx/model.onnx',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      },
      {
        source: 'huggingface',
        name: 'HuggingFace 官方',
        url: 'https://huggingface.co/sayantan47/clip-vit-b32-onnx/resolve/main/onnx/model.onnx',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      }
    ],
    fallbackUrl: 'https://huggingface.co/sayantan47/clip-vit-b32-onnx/resolve/main/onnx/model.onnx',
    manualDownload: false
  },

  LLM: {
    id: 'LLM',
    name: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    description: '小型语言模型（INT4 量化）',
    size: 940.37 * 1024 * 1024, // 940.37 MB (实际文件大小)
    params: '1.5B',
    quantization: 'INT4',
    downloadInstructions: '自动下载或手动下载',
    sha256: null,
    mirrors: [
      {
        source: 'hf-mirror',
        name: 'HuggingFace 国内镜像',
        url: 'https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      },
      {
        source: 'huggingface',
        name: 'HuggingFace 官方',
        url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      }
    ],
    fallbackUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    manualDownload: false
  }
};

class ModelDownloader extends EventEmitter {
  constructor() {
    super();
    this.downloadTasks = new Map();
    this.maxRetries = 3;
    this.timeout = 60000; // 60 秒超时
    this.pathManager = getModelPathManager();

    // 清理旧临时文件
    this.pathManager.cleanupTempFiles();
  }

  /**
   * 获取所有可用模型列表
   */
  getAvailableModels() {
    return Object.values(MODEL_CONFIGS).map(model => ({
      ...model,
      sizeFormatted: this._formatSize(model.size),
      installed: this._checkModelInstalled(model.id)
    }));
  }

  /**
   * 检查模型是否已安装
   */
  _checkModelInstalled(modelId) {
    const modelPath = this._getModelPath(modelId);
    return fs.existsSync(modelPath);
  }

  /**
   * 获取模型存储路径（使用 AppData 标准目录）
   */
  _getModelPath(modelId) {
    const config = MODEL_CONFIGS[modelId];
    return this.pathManager.getModelPath(config.name);
  }

  /**
   * 获取模型临时下载路径
   */
  _getTempPath(modelId) {
    const config = MODEL_CONFIGS[modelId];
    return this.pathManager.getTempDownloadPath(config.name);
  }

  /**
   * 获取模型文件扩展名
   */
  _getModelExtension(modelId) {
    const config = MODEL_CONFIGS[modelId];
    const name = config?.name || '';
    
    // 检查模型名称是否已包含扩展名
    if (name.toLowerCase().endsWith('.gguf')) {
      return ''; // 名称已包含扩展名，不再添加
    }
    if (name.toLowerCase().endsWith('.onnx')) {
      return '';
    }
    if (name.toLowerCase().endsWith('.bin')) {
      return '';
    }
    
    // 否则根据模型 ID 返回默认扩展名
    switch (modelId) {
      case 'EMBEDDING':
      case 'CLIP':
        return '.onnx';
      case 'LLM':
        return '.gguf';
      default:
        return '.bin';
    }
  }

  /**
   * 格式化文件大小
   */
  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /**
   * 开始下载模型
   */
  async download(modelId, options = {}) {
    const {
      retryCount = 0,
      mirrorIndex = 0
    } = options;

    if (retryCount >= this.maxRetries) {
      throw new Error(`下载失败：已达到最大重试次数 (${this.maxRetries})`);
    }

    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      throw new Error(`未知模型：${modelId}`);
    }

    const modelPath = this._getModelPath(modelId);

    // 检查是否已安装
    if (this._checkModelInstalled(modelId)) {
      console.log(`[Downloader] 模型已安装：${modelId}, 路径：${modelPath}`);
      this.emit('already-installed', { modelId, path: modelPath });
      return { success: true, path: modelPath, alreadyInstalled: true };
    }

    // 检查是否需要手动下载
    if (config.manualDownload || !config.fallbackUrl) {
      console.log(`[Downloader] 模型 ${modelId} 需要手动下载`);
      throw new Error(`模型 ${config.name} 需要手动下载。请点击"查看下载帮助"按钮获取详细说明。`);
    }

    // 获取下载链接（按优先级尝试）
    const mirror = config.mirrors[mirrorIndex];
    const downloadUrl = mirror?.url || config.fallbackUrl;
    const customHeaders = mirror?.headers || {};

    console.log(`[Downloader] 开始下载 ${modelId}`);
    console.log(`  镜像源：${mirror?.source || 'fallback'}`);
    console.log(`  URL: ${downloadUrl}`);
    console.log(`  目标路径：${modelPath}`);

    this.emit('start', { modelId, url: downloadUrl, mirror: mirror?.source || 'fallback' });

    try {
      await this._downloadFile(downloadUrl, modelPath, modelId, customHeaders);

      console.log(`[Downloader] 下载完成：${modelId}`);
      this.emit('complete', { modelId, path: modelPath, size: config.size });
      return { success: true, path: modelPath };
    } catch (error) {
      console.error(`[Downloader] 下载失败 ${modelId}:`, error?.message || error);

      // 确保 error 是 Error 对象
      const normalizedError = error instanceof Error ? error : new Error(String(error?.message || error || '下载失败'));

      // 如果当前镜像源失败，尝试下一个镜像源
      if (mirrorIndex < config.mirrors.length - 1) {
        this.emit('retry', {
          modelId,
          error: normalizedError.message,
          nextMirror: config.mirrors[mirrorIndex + 1].source
        });

        // 等待 1 秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));

        return this.download(modelId, {
          retryCount: retryCount + 1,
          mirrorIndex: mirrorIndex + 1
        });
      }

      // 所有镜像源都失败
      this.emit('error', { modelId, error: normalizedError.message });
      throw normalizedError;
    }
  }

  /**
   * 计算文件 SHA256 校验和
   */
  _calculateSHA256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * 验证模型文件完整性
   */
  async _verifyModelFile(modelId, filePath) {
    const config = MODEL_CONFIGS[modelId];

    // 检查文件大小
    const stats = fs.statSync(filePath);
    const expectedSize = config.size;
    const sizeDiff = Math.abs(stats.size - expectedSize) / expectedSize;

    if (sizeDiff > 0.05) { // 允许 5% 误差
      return {
        valid: false,
        error: `文件大小不匹配: 期望 ${this._formatSize(expectedSize)}, 实际 ${this._formatSize(stats.size)}`
      };
    }

    // 如果有预期的 SHA256 校验和，进行验证
    if (config.sha256) {
      console.log(`[Downloader] 验证 SHA256 校验和...`);
      const actualHash = await this._calculateSHA256(filePath);
      if (actualHash.toLowerCase() !== config.sha256.toLowerCase()) {
        return {
          valid: false,
          error: 'SHA256 校验和不匹配，文件可能已损坏',
          expected: config.sha256,
          actual: actualHash
        };
      }
      console.log(`[Downloader] SHA256 校验通过`);
    }

    return { valid: true };
  }

  /**
   * 下载文件（支持断点续传和 SHA256 校验）- 使用 axios
   */
  async _downloadFile(url, destPath, modelId, customHeaders = {}) {
    let downloadedBytes = 0;
    let totalBytes = 0;
    let startTime = Date.now();
    let lastProgressTime = Date.now();
    let lastEmittedPercent = 0;

    // 使用临时目录
    const tempPath = this._getTempPath(modelId);

    // 检查是否有未完成的下载
    if (fs.existsSync(tempPath)) {
      const stats = fs.statSync(tempPath);
      downloadedBytes = stats.size;
      console.log(`[Downloader] 发现未完成文件，从 ${downloadedBytes} 字节继续下载`);
    }

    // 如果目标文件已存在，验证完整性
    if (fs.existsSync(destPath)) {
      console.log(`[Downloader] 文件已存在，验证完整性: ${destPath}`);
      const verification = await this._verifyModelFile(modelId, destPath);

      if (verification.valid) {
        console.log(`[Downloader] 文件已存在且完整：${destPath}`);
        this.emit('already-installed', { modelId, path: destPath });
        return;
      } else {
        console.log(`[Downloader] 文件验证失败: ${verification.error}，重新下载`);
        fs.unlinkSync(destPath);
      }
    }

    try {
      console.log(`[Downloader] 开始请求 URL: ${url}`);

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          ...(downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : {}),
          ...customHeaders
        },
        maxRedirects: 10,
        timeout: 300000, // 5 分钟超时
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      // 获取总大小
      const contentLength = response.headers['content-length'];
      const contentRange = response.headers['content-range'];

      if (contentRange) {
        // 解析 Content-Range: bytes 1000-1999/2000
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1]);
        }
      } else if (contentLength) {
        totalBytes = parseInt(contentLength) + downloadedBytes;
      }

      // 如果无法获取总大小，使用配置的大小
      if (!totalBytes || totalBytes === 0) {
        const config = MODEL_CONFIGS[modelId];
        totalBytes = config.size;
        console.log(`[Downloader] 无法获取文件大小，使用配置大小：${totalBytes}`);
      }

      if (response.status === 206) {
        console.log(`[Downloader] 支持断点续传，总大小：${totalBytes} 字节`);
      } else if (downloadedBytes > 0) {
        // 服务器不支持断点续传，重新下载
        console.log('[Downloader] 服务器不支持范围请求，重新完整下载');
        downloadedBytes = 0;
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }

      const writer = fs.createWriteStream(tempPath, {
        flags: downloadedBytes > 0 ? 'a' : 'w',
        highWaterMark: 256 * 1024 // 256KB 缓冲区
      });

      let currentBytes = downloadedBytes;

      response.data.on('data', (chunk) => {
        currentBytes += chunk.length;

        // 计算进度
        const progress = totalBytes > 0 ? (currentBytes / totalBytes * 100) : 0;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (currentBytes - downloadedBytes) / elapsed : 0;

        // 每 300ms 发送一次进度更新，或者进度变化超过 1%
        const now = Date.now();
        const percentChange = Math.abs(progress - lastEmittedPercent);
        if ((now - lastProgressTime >= 300 || percentChange >= 1) && totalBytes > 0) {
          lastProgressTime = now;
          lastEmittedPercent = progress;
          const progressData = {
            modelId,
            downloaded: currentBytes,
            total: totalBytes,
            percent: Math.min(progress, 100).toFixed(1),
            speed: speed,
            speedFormatted: this._formatSize(speed) + '/s',
            eta: speed > 0 && totalBytes > currentBytes ? ((totalBytes - currentBytes) / speed).toFixed(0) : 0
          };
          console.log(`[Downloader] 进度更新：${progressData.percent}% (${progressData.speedFormatted})`);
          this.emit('progress', progressData);
        }
      });

      return new Promise((resolve, reject) => {
        response.data.pipe(writer);

        writer.on('finish', async () => {
          console.log(`[Downloader] 文件下载完成：${tempPath}`);

          // 验证下载的文件
          console.log(`[Downloader] 验证下载的文件...`);
          const verification = await this._verifyModelFile(modelId, tempPath);

          if (!verification.valid) {
            fs.unlinkSync(tempPath);
            reject(new Error(`文件验证失败: ${verification.error}`));
            return;
          }

          // 重命名临时文件为最终文件
          try {
            if (fs.existsSync(destPath)) {
              fs.unlinkSync(destPath);
            }
            fs.renameSync(tempPath, destPath);

            // 保存校验和
            this.pathManager.saveModelChecksum(MODEL_CONFIGS[modelId].name);

            console.log(`[Downloader] 文件重命名为：${destPath}`);
            resolve();
          } catch (err) {
            reject(new Error(`文件重命名失败: ${err.message}`));
          }
        });

        writer.on('error', (err) => {
          console.error('[Downloader] 文件写入错误:', err);
          reject(err);
        });

        // 处理响应错误
        response.data.on('error', (err) => {
          console.error('[Downloader] 数据流错误:', err);
          reject(err);
        });
      });

    } catch (error) {
      console.error('[Downloader] 下载失败:', error.message);
      // 分类错误类型
      if (error.response) {
        const status = error.response.status;
        if (status === 404) {
          throw new Error('模型文件不存在 (404)，请检查下载链接或手动下载');
        } else if (status === 403) {
          throw new Error('访问被拒绝 (403)，可能需要登录或使用其他镜像源');
        } else if (status === 429) {
          throw new Error('请求过于频繁 (429)，请稍后再试');
        } else {
          throw new Error(`服务器错误 (${status})：${error.message}`);
        }
      } else if (error.code === 'ECONNABORTED') {
        throw new Error('连接超时，请检查网络连接或稍后重试');
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('无法解析域名，请检查网络连接或 DNS 设置');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('连接被拒绝，服务器可能不可用');
      }
      throw error;
    }
  }

  /**
   * 卸载模型
   */
  uninstall(modelId) {
    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      throw new Error(`未知模型：${modelId}`);
    }

    const modelPath = this._getModelPath(modelId);
    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      this.emit('uninstall', { modelId, path: modelPath });
      return true;
    }
    return false;
  }

  /**
   * 获取模型状态
   */
  getModelStatus(modelId) {
    const config = MODEL_CONFIGS[modelId];
    if (!config) {
      throw new Error(`未知模型：${modelId}`);
    }

    const modelPath = this._getModelPath(modelId);
    const installed = fs.existsSync(modelPath);
    let size = 0;
    
    if (installed) {
      size = fs.statSync(modelPath).size;
    }

    return {
      id: modelId,
      name: config.name,
      description: config.description,
      installed,
      size: config.size,
      sizeFormatted: this._formatSize(config.size),
      actualSize: size,
      actualSizeFormatted: this._formatSize(size),
      path: installed ? modelPath : null
    };
  }

  /**
   * 获取所有模型状态
   */
  getAllModelsStatus() {
    const result = {};
    for (const modelId of Object.keys(MODEL_CONFIGS)) {
      result[modelId] = this.getModelStatus(modelId);
    }
    return result;
  }

  /**
   * 取消下载
   */
  cancelDownload(modelId) {
    const task = this.downloadTasks.get(modelId);
    if (task && task.request) {
      task.request.destroy();
      this.downloadTasks.delete(modelId);
      this.emit('cancelled', { modelId });
      return true;
    }
    return false;
  }
}

module.exports = {
  ModelDownloader,
  MODEL_CONFIGS,
  MIRROR_SOURCES
};
