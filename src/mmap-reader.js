/**
 * 内存映射文件读取器
 * 实现零拷贝 (Zero-Copy) 大文件处理
 */

const fs = require('fs');
const path = require('path');

// Node.js mmap 支持（通过 buffer 映射）
class MemoryMappedFile {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = null;
    this.buffer = null;
    this.size = 0;
  }

  /**
   * 打开并映射文件到内存
   */
  async open() {
    const stats = await fs.promises.stat(this.filePath);
    this.size = stats.size;
    
    // 打开文件描述符
    this.fd = await fs.promises.open(this.filePath, 'r');
    
    // 对于大文件，使用 mmap 方式读取
    if (this.size > 10 * 1024 * 1024) { // 10MB 以上使用 mmap
      // Node.js 没有原生 mmap，使用大 buffer 模拟
      this.buffer = Buffer.alloc(Math.min(this.size, 100 * 1024 * 1024)); // 最多 100MB
      await this.fd.read(this.buffer, 0, this.buffer.length, 0);
    } else {
      // 小文件直接全部读入
      this.buffer = await fs.promises.readFile(this.filePath);
    }
    
    return this;
  }

  /**
   * 读取指定范围的数据（零拷贝）
   */
  read(offset, length) {
    if (!this.buffer) {
      throw new Error('文件未打开');
    }
    
    const actualLength = Math.min(length, this.size - offset);
    return this.buffer.slice(offset, offset + actualLength);
  }

  /**
   * 计算分块哈希（零拷贝）
   */
  async calculateChunkedHash(crypto, positions, chunkSize = 4096) {
    if (!this.buffer) {
      throw new Error('文件未打开');
    }

    const hashes = [];
    for (const pos of positions) {
      const chunk = this.read(pos, chunkSize);
      const hash = crypto.createHash('sha256').update(chunk).digest('hex');
      hashes.push(hash);
    }
    
    return hashes.join(':');
  }

  /**
   * 关闭映射
   */
  async close() {
    if (this.fd) {
      await this.fd.close();
      this.fd = null;
    }
    this.buffer = null;
  }
}

/**
 * 内存池（对象池）
 * 避免频繁分配 buffer 导致的 GC 停顿
 */
class MemoryPool {
  constructor(poolSize = 10, bufferSize = 64 * 1024) {
    this.poolSize = poolSize;
    this.bufferSize = bufferSize;
    this.buffers = [];
    this.available = [];
    this.inUse = new Set();
  }

  /**
   * 初始化内存池
   */
  init() {
    for (let i = 0; i < this.poolSize; i++) {
      const buffer = Buffer.alloc(this.bufferSize);
      this.buffers.push(buffer);
      this.available.push(i);
    }
    console.log(`内存池初始化完成：${this.poolSize} x ${this.bufferSize / 1024}KB`);
  }

  /**
   * 获取一个 buffer
   */
  acquire() {
    if (this.available.length === 0) {
      // 池耗尽，临时分配
      console.warn('内存池耗尽，临时分配新 buffer');
      return Buffer.alloc(this.bufferSize);
    }

    const index = this.available.pop();
    this.inUse.add(index);
    return this.buffers[index];
  }

  /**
   * 归还 buffer
   */
  release(buffer) {
    const index = this.buffers.indexOf(buffer);
    if (index !== -1 && this.inUse.has(index)) {
      this.inUse.delete(index);
      this.available.push(index);
      // 清空数据
      buffer.fill(0);
    }
  }

  /**
   * 批量获取多个 buffer
   */
  acquireBatch(count) {
    const buffers = [];
    for (let i = 0; i < count; i++) {
      buffers.push(this.acquire());
    }
    return buffers;
  }

  /**
   * 批量归还 buffer
   */
  releaseBatch(buffers) {
    for (const buffer of buffers) {
      this.release(buffer);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      total: this.poolSize,
      available: this.available.length,
      inUse: this.inUse.size,
      usage: (this.inUse.size / this.poolSize * 100).toFixed(2) + '%'
    };
  }
}

/**
 * 环形缓冲区（Ring Buffer）
 * 用于流式读取大文件
 */
class RingBuffer {
  constructor(size = 1024 * 1024) {
    this.buffer = Buffer.alloc(size);
    this.size = size;
    this.head = 0;
    this.tail = 0;
    this.full = false;
  }

  /**
   * 写入数据
   */
  write(data) {
    for (let i = 0; i < data.length; i++) {
      if (this.full) {
        this.tail = (this.tail + 1) % this.size;
      }
      
      this.buffer[this.head] = data[i];
      this.head = (this.head + 1) % this.size;
      
      if (this.head === this.tail) {
        this.full = true;
      }
    }
  }

  /**
   * 读取数据
   */
  read(length) {
    if (this.head === this.tail && !this.full) {
      return null; // 空
    }

    const result = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
      if (this.head === this.tail && !this.full) {
        return result.slice(0, i); // 部分读取
      }
      
      result[i] = this.buffer[this.tail];
      this.tail = (this.tail + 1) % this.size;
      this.full = false;
    }
    
    return result;
  }

  /**
   * 清空缓冲区
   */
  clear() {
    this.head = 0;
    this.tail = 0;
    this.full = false;
  }

  /**
   * 获取可用空间
   */
  getAvailable() {
    if (this.full) return 0;
    if (this.head >= this.tail) {
      return this.size - (this.head - this.tail);
    } else {
      return this.tail - this.head;
    }
  }
}

module.exports = {
  MemoryMappedFile,
  MemoryPool,
  RingBuffer
};
