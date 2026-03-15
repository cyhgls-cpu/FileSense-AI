/**
 * 智能聚类服务 (V1.5+)
 *
 * 功能：
 * 1. DBSCAN 无监督聚类 - 自动将相似文件归纳为逻辑组
 * 2. 动态阈值聚类 - 不需要预先指定聚类数量
 * 3. 多维度聚类 - 支持语义聚类、视觉聚类、混合聚类
 */

const { EventEmitter } = require('events');

class SmartClustering extends EventEmitter {
  constructor(vectorDb) {
    super();
    this.vectorDb = vectorDb;

    // DBSCAN 默认参数
    this.config = {
      eps: 0.15,              // 邻域半径（余弦距离）
      minPts: 2,              // 最小点数（形成簇的最小文件数）
      distanceMetric: 'cosine' // 距离度量方式
    };
  }

  /**
   * ============================================
   * 1. DBSCAN 核心算法
   * ============================================
   */

  /**
   * 执行 DBSCAN 聚类
   * @param {Array} points - 数据点数组，每个点包含 { id, vector, metadata }
   * @param {Object} options - 聚类选项
   * @returns {Object} - 聚类结果
   */
  dbscan(points, options = {}) {
    const eps = options.eps || this.config.eps;
    const minPts = options.minPts || this.config.minPts;

    const clusters = [];           // 发现的簇
    const visited = new Set();     // 已访问的点
    const noise = new Set();       // 噪声点（不属于任何簇）
    const pointMap = new Map();    // ID -> 点 映射

    // 构建点映射
    points.forEach(p => pointMap.set(p.id, p));

    for (const point of points) {
      if (visited.has(point.id)) continue;

      visited.add(point.id);

      // 找到邻域内的所有点
      const neighbors = this._getNeighbors(point, points, eps);

      if (neighbors.length < minPts) {
        // 标记为噪声点（可能是孤立文件）
        noise.add(point.id);
      } else {
        // 发现新簇
        const cluster = this._expandCluster(
          point,
          neighbors,
          points,
          eps,
          minPts,
          visited
        );
        clusters.push(cluster);
      }
    }

    // 后处理：尝试将噪声点分配到最近的簇
    const reassigned = this._reassignNoisePoints(
      Array.from(noise).map(id => pointMap.get(id)),
      clusters,
      eps * 1.5  // 放宽阈值
    );

    return {
      clusters: clusters.map((c, idx) => ({
        id: `cluster-${idx + 1}`,
        points: c,
        size: c.length,
        center: this._calculateCenter(c),
        density: c.length / (eps * eps) // 简单密度估计
      })),
      noise: reassigned.remaining.map(id => pointMap.get(id)),
      reassigned: reassigned.assigned,
      totalPoints: points.length,
      clusterCount: clusters.length,
      noiseCount: reassigned.remaining.length
    };
  }

  /**
   * 扩展簇
   */
  _expandCluster(corePoint, neighbors, allPoints, eps, minPts, visited) {
    const cluster = [corePoint];
    const queue = [...neighbors];
    const inCluster = new Set([corePoint.id]);

    let i = 0;
    while (i < queue.length) {
      const point = queue[i++];

      if (!visited.has(point.id)) {
        visited.add(point.id);

        const pointNeighbors = this._getNeighbors(point, allPoints, eps);

        if (pointNeighbors.length >= minPts) {
          // 核心点，扩展邻域
          for (const nb of pointNeighbors) {
            if (!inCluster.has(nb.id)) {
              queue.push(nb);
            }
          }
        }
      }

      if (!inCluster.has(point.id)) {
        cluster.push(point);
        inCluster.add(point.id);
      }
    }

    return cluster;
  }

  /**
   * 获取邻域内的点
   */
  _getNeighbors(centerPoint, allPoints, eps) {
    return allPoints.filter(p => {
      if (p.id === centerPoint.id) return false;
      const distance = this._calculateDistance(centerPoint.vector, p.vector);
      return distance <= eps;
    });
  }

  /**
   * 计算向量距离
   */
  _calculateDistance(a, b) {
    // 余弦距离 = 1 - 余弦相似度
    const similarity = this._cosineSimilarity(a, b);
    return 1 - similarity;
  }

  /**
   * 计算余弦相似度
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 计算簇中心
   */
  _calculateCenter(cluster) {
    if (cluster.length === 0) return null;

    const dimensions = cluster[0].vector.length;
    const center = new Float32Array(dimensions).fill(0);

    for (const point of cluster) {
      for (let i = 0; i < dimensions; i++) {
        center[i] += point.vector[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      center[i] /= cluster.length;
    }

    return center;
  }

  /**
   * 尝试将噪声点重新分配到最近的簇
   */
  _reassignNoisePoints(noisePoints, clusters, threshold) {
    const assigned = [];
    const remaining = [];

    for (const point of noisePoints) {
      let bestCluster = null;
      let bestDistance = Infinity;

      for (let i = 0; i < clusters.length; i++) {
        const center = this._calculateCenter(clusters[i]);
        if (center) {
          const distance = this._calculateDistance(
            { vector: point.vector },
            { vector: center }
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCluster = i;
          }
        }
      }

      if (bestCluster !== null && bestDistance <= threshold) {
        clusters[bestCluster].push(point);
        assigned.push({
          pointId: point.id,
          clusterId: bestCluster,
          distance: bestDistance
        });
      } else {
        remaining.push(point.id);
      }
    }

    return { assigned, remaining };
  }

  /**
   * ============================================
   * 2. 文件聚类 API
   * ============================================
   */

  /**
   * 对相似文件进行智能聚类
   * @param {string} modelType - 模型类型 (EMBEDDING|CLIP)
   * @param {Object} options - 聚类选项
   */
  async clusterSimilarFiles(modelType, options = {}) {
    const {
      eps = this.config.eps,
      minPts = this.config.minPts,
      minClusterSize = 2
    } = options;

    this.emit('clustering:start', { modelType, eps, minPts });

    try {
      // 1. 获取所有向量
      const vectors = await this._getAllVectors(modelType);

      if (vectors.length < minPts) {
        return {
          clusters: [],
          noise: vectors,
          message: '向量数量不足，无法进行聚类'
        };
      }

      // 2. 准备数据点
      const points = vectors.map((v, idx) => ({
        id: v.filePath,
        vector: v.vector,
        metadata: {
          index: idx,
          path: v.filePath
        }
      }));

      // 3. 执行 DBSCAN
      const result = this.dbscan(points, { eps, minPts });

      // 4. 过滤小簇
      const significantClusters = result.clusters.filter(
        c => c.size >= minClusterSize
      );

      // 5. 为每个簇生成描述
      const enrichedClusters = await this._enrichClusters(
        significantClusters,
        modelType
      );

      this.emit('clustering:complete', {
        clusterCount: enrichedClusters.length,
        totalFiles: result.totalPoints
      });

      return {
        clusters: enrichedClusters,
        noise: result.noise,
        stats: {
          totalFiles: result.totalPoints,
          clusterCount: enrichedClusters.length,
          noiseCount: result.noise.length,
          avgClusterSize: enrichedClusters.length > 0
            ? enrichedClusters.reduce((sum, c) => sum + c.size, 0) / enrichedClusters.length
            : 0
        }
      };

    } catch (err) {
      this.emit('clustering:error', { error: err.message });
      throw err;
    }
  }

  /**
   * 混合聚类 - 结合语义和视觉特征
   */
  async hybridClustering(options = {}) {
    const { eps = 0.2, minPts = 2 } = options;

    this.emit('clustering:start', { type: 'hybrid' });

    try {
      // 1. 获取两种向量
      const [embeddingVectors, clipVectors] = await Promise.all([
        this._getAllVectors('EMBEDDING').catch(() => []),
        this._getAllVectors('CLIP').catch(() => [])
      ]);

      // 2. 合并向量（拼接或加权）
      const mergedPoints = this._mergeVectors(
        embeddingVectors,
        clipVectors
      );

      if (mergedPoints.length < minPts) {
        return { clusters: [], noise: mergedPoints };
      }

      // 3. 执行聚类
      const result = this.dbscan(mergedPoints, { eps, minPts });

      // 4. 标记聚类类型
      const typedClusters = result.clusters.map(cluster => ({
        ...cluster,
        type: this._determineClusterType(cluster),
        description: this._generateClusterDescription(cluster)
      }));

      return {
        clusters: typedClusters,
        noise: result.noise,
        stats: result.stats
      };

    } catch (err) {
      this.emit('clustering:error', { error: err.message });
      throw err;
    }
  }

  /**
   * ============================================
   * 3. 聚类增强与描述
   * ============================================
   */

  /**
   * 为簇添加元数据
   */
  async _enrichClusters(clusters, modelType) {
    return clusters.map(cluster => ({
      ...cluster,
      type: modelType === 'CLIP' ? 'visual' : 'semantic',
      description: this._generateClusterDescription(cluster),
      representative: this._findRepresentative(cluster),
      compactness: this._calculateCompactness(cluster)
    }));
  }

  /**
   * 生成簇描述
   */
  _generateClusterDescription(cluster) {
    const size = cluster.size;
    const paths = cluster.points.map(p => p.metadata.path);

    // 提取共同特征
    const commonPrefix = this._findCommonPrefix(paths);
    const extensions = this._extractExtensions(paths);

    if (cluster.type === 'visual') {
      if (size >= 10) {
        return `📸 连拍照片组 (${size}张) - ${commonPrefix || '相似场景'}`;
      }
      return `🖼️ 相似图片组 (${size}张)`;
    }

    if (cluster.type === 'semantic') {
      if (extensions.includes('.pdf') && extensions.includes('.doc')) {
        return `📄 文档多版本组 (${size}个) - ${commonPrefix || '内容相似'}`;
      }
      return `📑 语义相似文档组 (${size}个)`;
    }

    return `📁 相似文件组 (${size}个)`;
  }

  /**
   * 查找代表性文件（最靠近中心的）
   */
  _findRepresentative(cluster) {
    const center = cluster.center;
    if (!center) return cluster.points[0];

    let bestPoint = cluster.points[0];
    let bestDistance = Infinity;

    for (const point of cluster.points) {
      const distance = this._calculateDistance(
        { vector: point.vector },
        { vector: center }
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = point;
      }
    }

    return bestPoint;
  }

  /**
   * 计算簇紧密度
   */
  _calculateCompactness(cluster) {
    const center = cluster.center;
    if (!center || cluster.points.length < 2) return 1.0;

    let totalDistance = 0;
    for (const point of cluster.points) {
      totalDistance += this._calculateDistance(
        { vector: point.vector },
        { vector: center }
      );
    }

    const avgDistance = totalDistance / cluster.points.length;
    // 紧密度 = 1 - 平均距离（归一化）
    return Math.max(0, 1 - avgDistance);
  }

  /**
   * 确定簇类型
   */
  _determineClusterType(cluster) {
    const paths = cluster.points.map(p => p.metadata?.path || p.id);
    const extensions = this._extractExtensions(paths);

    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const docExts = ['.pdf', '.doc', '.docx', '.txt', '.md'];

    const hasImages = extensions.some(e => imageExts.includes(e));
    const hasDocs = extensions.some(e => docExts.includes(e));

    if (hasImages && !hasDocs) return 'image-group';
    if (hasDocs && !hasImages) return 'document-group';
    return 'mixed-group';
  }

  /**
   * ============================================
   * 工具方法
   * ============================================
   */

  /**
   * 获取所有向量
   */
  async _getAllVectors(modelType) {
    const sql = `
      SELECT file_path, vector, dimensions
      FROM vector_features
      WHERE model_type = ? AND is_valid = 1
    `;

    return new Promise((resolve, reject) => {
      this.vectorDb.db.all(sql, [modelType], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const vectors = rows.map(row => ({
          filePath: row.file_path,
          vector: new Float32Array(row.vector.buffer),
          dimensions: row.dimensions
        }));

        resolve(vectors);
      });
    });
  }

  /**
   * 合并语义和视觉向量
   */
  _mergeVectors(embeddingVectors, clipVectors) {
    const merged = new Map();

    // 添加语义向量
    for (const v of embeddingVectors) {
      merged.set(v.filePath, {
        id: v.filePath,
        vector: v.vector,
        hasEmbedding: true,
        hasClip: false
      });
    }

    // 添加/合并视觉向量
    for (const v of clipVectors) {
      if (merged.has(v.filePath)) {
        // 合并向量（简单拼接或加权平均）
        const existing = merged.get(v.filePath);
        existing.vector = this._combineVectors(existing.vector, v.vector);
        existing.hasClip = true;
      } else {
        merged.set(v.filePath, {
          id: v.filePath,
          vector: v.vector,
          hasEmbedding: false,
          hasClip: true
        });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * 组合两个向量（加权平均）
   */
  _combineVectors(v1, v2, weight1 = 0.5, weight2 = 0.5) {
    // 归一化到相同维度（简化处理）
    const targetDim = Math.max(v1.length, v2.length);
    const result = new Float32Array(targetDim);

    for (let i = 0; i < targetDim; i++) {
      const val1 = i < v1.length ? v1[i] : 0;
      const val2 = i < v2.length ? v2[i] : 0;
      result[i] = val1 * weight1 + val2 * weight2;
    }

    return result;
  }

  /**
   * 查找共同前缀
   */
  _findCommonPrefix(paths) {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0].substring(0, paths[0].lastIndexOf('/') + 1);

    let prefix = '';
    const first = paths[0];

    for (let i = 0; i < first.length; i++) {
      const char = first[i];
      if (paths.every(p => p[i] === char)) {
        prefix += char;
      } else {
        break;
      }
    }

    // 截断到最后一个 /
    const lastSlash = prefix.lastIndexOf('/');
    return lastSlash > 0 ? prefix.substring(0, lastSlash) : prefix;
  }

  /**
   * 提取文件扩展名
   */
  _extractExtensions(paths) {
    const exts = new Set();
    for (const path of paths) {
      const match = path.match(/\.[^/.]+$/);
      if (match) exts.add(match[0].toLowerCase());
    }
    return Array.from(exts);
  }
}

module.exports = { SmartClustering };
