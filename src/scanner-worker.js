/**
 * 文件扫描工作线程
 * 实现生产者 - 消费者模型，CPU 密集型计算在 Worker 中执行
 */

const { isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!isMainThread) {
  // Worker 线程逻辑
  parentPort.on('message', async (task) => {
    try {
      const result = await processTask(task);
      parentPort.postMessage({ taskId: task.id, result, error: null });
    } catch (err) {
      parentPort.postMessage({ taskId: task.id, result: null, error: err.message });
    }
  });
}

/**
 * 处理扫描任务
 */
async function processTask(task) {
  switch (task.type) {
    case 'METADATA':
      return getMetadata(task.filePath);
    
    case 'SPARSE_HASH':
      return calculateSparseHash(task.filePath, task.fileSize);
    
    case 'FULL_HASH':
      return calculateFullHash(task.filePath);
    
    case 'PERCEPTUAL_HASH':
      return calculatePerceptualHash(task.filePath);
    
    case 'DOCUMENT_TEXT':
      return extractDocumentText(task.filePath);
    
    default:
      throw new Error(`未知任务类型：${task.type}`);
  }
}

/**
 * 获取文件元数据
 */
async function getMetadata(filePath) {
  const stats = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  return {
    path: filePath,
    size: stats.size,
    mtime: stats.mtimeMs,
    category: categorizeFile(ext),
    extension: ext
  };
}

/**
 * 文件分类
 */
function categorizeFile(ext) {
  const SOFTWARE = ['exe', 'dll', 'msi', 'pkg', 'deb', 'rpm', 'app', 'apk', 'ipa', 'zip', 'rar', '7z', 'tar', 'gz'];
  const IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'psd', 'ai', 'tiff', 'raw'];
  const DOCUMENT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp'];
  
  if (SOFTWARE.includes(ext)) return 'SOFTWARE';
  if (IMAGE.includes(ext)) return 'IMAGE';
  if (DOCUMENT.includes(ext)) return 'DOCUMENT';
  return 'OTHER';
}

/**
 * 分块稀疏哈希
 */
async function calculateSparseHash(filePath, fileSize) {
  const CHUNK_SIZE = 4096;
  const positions = [0]; // 头部
  
  if (fileSize > CHUNK_SIZE * 3) {
    positions.push(Math.floor(fileSize / 2)); // 中部
    positions.push(fileSize - CHUNK_SIZE); // 尾部
  }
  
  const hashes = [];
  
  for (const pos of positions) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      await fd.read(buffer, 0, CHUNK_SIZE, pos);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      hashes.push(hash);
    } finally {
      await fd.close();
    }
  }
  
  return hashes.join(':');
}

/**
 * 全量 BLAKE3 哈希（使用 sha256 模拟，生产环境应用 blake3）
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
 * 图片感知哈希（简化版）
 */
async function calculatePerceptualHash(filePath) {
  try {
    const data = await fs.promises.readFile(filePath);
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
 * 提取文档文本（简化版）
 */
async function extractDocumentText(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  
  try {
    let text = '';
    
    if (['txt', 'md', 'json', 'xml', 'html', 'csv'].includes(ext)) {
      text = await fs.promises.readFile(filePath, 'utf-8');
    }
    
    // 归一化
    return normalizeText(text);
  } catch (err) {
    return null;
  }
}

/**
 * 文本归一化
 */
function normalizeText(text) {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"() [\]{}]/g, '')
    .replace(/\n+/g, '')
    .trim();
}
