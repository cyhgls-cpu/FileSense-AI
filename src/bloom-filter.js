/**
 * 布隆过滤器 (Bloom Filter)
 * 用于快速判断文件哈希是否存在于集合中
 * 特点：
 * - 内存占用极小（几 MB 可映射上千万文件）
 * - O(1) 时间复杂度查询
 * - 可能有误判（False Positive），但不会漏判
 */

class BloomFilter {
  /**
   * @param {number} expectedItems - 预期元素数量
   * @param {number} falsePositiveRate - 可接受的误判率 (0.01 = 1%)
   */
  constructor(expectedItems = 1000000, falsePositiveRate = 0.01) {
    this.expectedItems = expectedItems;
    this.falsePositiveRate = falsePositiveRate;
    
    // 计算最优的位数组大小和哈希函数数量
    this.bitSize = this._calculateBitSize(expectedItems, falsePositiveRate);
    this.hashCount = this._calculateHashCount(this.bitSize, expectedItems);
    
    // 初始化位数组
    this.bitArray = new Uint8Array(Math.ceil(this.bitSize / 8));
    this.itemCount = 0;
    
    console.log(`布隆过滤器初始化:`);
    console.log(`  - 预期元素：${expectedItems.toLocaleString()}`);
    console.log(`  - 位数组大小：${(this.bitSize / 8 / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  - 哈希函数数量：${this.hashCount}`);
    console.log(`  - 误判率：${(falsePositiveRate * 100).toFixed(2)}%`);
  }

  /**
   * 计算最优位数组大小
   * m = -(n * ln(p)) / (ln(2)^2)
   */
  _calculateBitSize(n, p) {
    return Math.ceil(-(n * Math.log(p)) / (Math.log(2) ** 2));
  }

  /**
   * 计算最优哈希函数数量
   * k = (m/n) * ln(2)
   */
  _calculateHashCount(m, n) {
    return Math.max(1, Math.round((m / n) * Math.log(2)));
  }

  /**
   * 生成多个哈希值（使用双重哈希模拟）
   */
  _getHashValues(item) {
    const hash1 = this._hash1(item);
    const hash2 = this._hash2(item);
    
    const hashes = [];
    for (let i = 0; i < this.hashCount; i++) {
      const combinedHash = (hash1 + i * hash2) % this.bitSize;
      hashes.push(combinedHash);
    }
    
    return hashes;
  }

  /**
   * 第一个哈希函数 (FNV-1a)
   */
  _hash1(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return Math.abs(hash);
  }

  /**
   * 第二个哈希函数 (djb2)
   */
  _hash2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return Math.abs(hash);
  }

  /**
   * 添加元素到过滤器
   */
  add(item) {
    const hashes = this._getHashValues(item);
    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      this.bitArray[byteIndex] |= (1 << bitIndex);
    }
    this.itemCount++;
  }

  /**
   * 检查元素是否可能存在
   * @returns {boolean} true=可能存在，false=一定不存在
   */
  mightContain(item) {
    const hashes = this._getHashValues(item);
    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      if ((this.bitArray[byteIndex] & (1 << bitIndex)) === 0) {
        return false; // 一定不存在
      }
    }
    return true; // 可能存在（有误判可能）
  }

  /**
   * 批量添加元素
   */
  addBatch(items) {
    for (const item of items) {
      this.add(item);
    }
  }

  /**
   * 批量检查
   */
  filterPossible(items) {
    return items.filter(item => this.mightContain(item));
  }

  /**
   * 获取当前填充率
   */
  getFillRate() {
    let setBits = 0;
    for (const byte of this.bitArray) {
      for (let i = 0; i < 8; i++) {
        if ((byte & (1 << i)) !== 0) {
          setBits++;
        }
      }
    }
    return (setBits / this.bitSize * 100).toFixed(2) + '%';
  }

  /**
   * 获取实际误判率估算
   * p ≈ (1 - e^(-kn/m))^k
   */
  getEstimatedFalsePositiveRate() {
    const k = this.hashCount;
    const n = this.itemCount;
    const m = this.bitSize;
    
    const rate = Math.pow(1 - Math.exp(-k * n / m), k);
    return (rate * 100).toFixed(4) + '%';
  }

  /**
   * 序列化过滤器
   */
  serialize() {
    return {
      expectedItems: this.expectedItems,
      falsePositiveRate: this.falsePositiveRate,
      bitSize: this.bitSize,
      hashCount: this.hashCount,
      itemCount: this.itemCount,
      bitArray: Array.from(this.bitArray)
    };
  }

  /**
   * 反序列化过滤器
   */
  static deserialize(data) {
    const filter = new BloomFilter(data.expectedItems, data.falsePositiveRate);
    filter.bitSize = data.bitSize;
    filter.hashCount = data.hashCount;
    filter.itemCount = data.itemCount;
    filter.bitArray = new Uint8Array(data.bitArray);
    return filter;
  }

  /**
   * 重置过滤器
   */
  reset() {
    this.bitArray.fill(0);
    this.itemCount = 0;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      itemCount: this.itemCount,
      bitSize: this.bitSize,
      memoryUsage: (this.bitArray.length / 1024 / 1024).toFixed(2) + 'MB',
      fillRate: this.getFillRate(),
      estimatedFalsePositiveRate: this.getEstimatedFalsePositiveRate()
    };
  }
}

module.exports = { BloomFilter };
