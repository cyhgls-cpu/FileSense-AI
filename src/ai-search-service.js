/**
 * AI 智能搜索服务 (V1.5+)
 *
 * 功能：
 * 1. 自然语言过滤搜索 - 将用户输入转化为向量，执行近似最近邻搜索
 * 2. 视觉容差匹配 - 基于 CLIP 向量的图片相似度搜索
 * 3. 跨模态检索 - 用文字搜图片、用图片搜相似图片
 */

const { EventEmitter } = require('events');

class AISearchService extends EventEmitter {
  constructor(vectorDb, modelManager) {
    super();
    this.vectorDb = vectorDb;
    this.modelManager = modelManager;

    // 搜索配置
    this.config = {
      defaultTopK: 20,
      visualThreshold: 0.92,      // 视觉相似度阈值
      semanticThreshold: 0.85,    // 语义相似度阈值
      maxResults: 100             // 最大返回结果数
    };
  }

  /**
   * ============================================
   * 1. 自然语言过滤搜索
   * ============================================
   */

  /**
   * 自然语言搜索
   * @param {string} query - 用户输入的自然语言，如"财务报表"
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} - 匹配的文件列表
   */
  async naturalLanguageSearch(query, options = {}) {
    const { modelType = 'EMBEDDING', topK = this.config.defaultTopK } = options;

    this.emit('search:start', { query, type: 'natural-language' });

    try {
      // 1. 将查询文本转化为向量（通过本地 Embedding 模型）
      const queryVector = await this._textToVector(query, modelType);

      // 2. 执行近似最近邻搜索 (ANN)
      const results = await this._approximateNearestNeighbor(
        queryVector,
        modelType,
        topK
      );

      // 3. 格式化结果
      const formatted = results.map(r => ({
        path: r.filePath,
        similarity: r.similarity,
        relevance: this._calculateRelevance(r.similarity),
        matchedBy: 'semantic'
      }));

      this.emit('search:complete', { query, results: formatted });

      return formatted;

    } catch (err) {
      this.emit('search:error', { query, error: err.message });
      throw err;
    }
  }

  /**
   * 将文本转化为向量
   */
  async _textToVector(text, modelType) {
    // 检查模型是否加载
    const model = this.modelManager.models.get(modelType);
    if (!model || !model.loaded) {
      throw new Error(`${modelType} 模型未加载，请先下载并加载模型`);
    }

    // TODO: 实际调用 ONNX 模型进行推理
    // 目前返回模拟向量
    console.log(`[AI Search] 将文本转化为向量: "${text.substring(0, 50)}..."`);

    const dimensions = modelType === 'CLIP' ? 512 : 384;
    return new Float32Array(dimensions).map(() => Math.random() - 0.5);
  }

  /**
   * 近似最近邻搜索 (ANN)
   * 使用简单的线性搜索，后续可优化为 HNSW
   */
  async _approximateNearestNeighbor(queryVector, modelType, topK) {
    // 获取该类型的所有向量
    const allVectors = await this._getAllVectors(modelType);

    // 计算相似度并排序
    const scored = allVectors.map(item => ({
      filePath: item.filePath,
      similarity: this._cosineSimilarity(queryVector, item.vector)
    }));

    // 按相似度降序排序，取前 K 个
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * ============================================
   * 2. 视觉容差匹配
   * ============================================
   */

  /**
   * 视觉相似图片搜索
   * @param {string} imagePath - 查询图片路径
   * @param {Object} options - 搜索选项
   */
  async visualSimilaritySearch(imagePath, options = {}) {
    const {
      threshold = this.config.visualThreshold,
      topK = this.config.defaultTopK,
      includeSelf = false
    } = options;

    this.emit('search:start', { path: imagePath, type: 'visual-similarity' });

    try {
      // 1. 提取查询图片的 CLIP 向量
      const queryVector = await this._imageToVector(imagePath);

      // 2. 搜索相似向量
      const results = await this.vectorDb.searchSimilar(
        queryVector,
        'CLIP',
        topK * 2,  // 多取一些，过滤后再返回
        threshold
      );

      // 3. 过滤和格式化
      let filtered = results;
      if (!includeSelf) {
        filtered = results.filter(r => r.filePath !== imagePath);
      }

      const formatted = filtered.slice(0, topK).map(r => ({
        path: r.filePath,
        similarity: r.similarity,
        visualScore: Math.round(r.similarity * 100),
        matchedBy: 'visual',
        tolerance: this._getVisualToleranceLevel(r.similarity)
      }));

      this.emit('search:complete', { path: imagePath, results: formatted });

      return formatted;

    } catch (err) {
      this.emit('search:error', { path: imagePath, error: err.message });
      throw err;
    }
  }

  /**
   * 将图片转化为向量
   */
  async _imageToVector(imagePath) {
    const model = this.modelManager.models.get('CLIP');
    if (!model || !model.loaded) {
      throw new Error('CLIP 模型未加载，请先下载并加载模型');
    }

    // TODO: 实际调用 CLIP 模型进行推理
    console.log(`[AI Search] 提取图片向量: ${imagePath}`);

    return new Float32Array(512).map(() => Math.random() - 0.5);
  }

  /**
   * 获取视觉容差级别
   */
  _getVisualToleranceLevel(similarity) {
    if (similarity >= 0.98) return 'identical';      // 几乎相同
    if (similarity >= 0.95) return 'near-duplicate'; // 近似重复（连拍）
    if (similarity >= 0.92) return 'similar';        // 相似（裁剪/滤镜）
    return 'related';                                 // 相关
  }

  /**
   * ============================================
   * 3. 跨模态检索
   * ============================================
   */

  /**
   * 跨模态搜索 - 用文字搜图片
   * @param {string} textQuery - 文字描述，如"海边的日落"
   * @param {Object} options - 搜索选项
   */
  async crossModalSearch(textQuery, options = {}) {
    const { topK = this.config.defaultTopK } = options;

    this.emit('search:start', { query: textQuery, type: 'cross-modal' });

    try {
      // 1. 将文本转化为 CLIP 向量
      const textVector = await this._textToVector(textQuery, 'CLIP');

      // 2. 在图片向量中搜索
      const results = await this.vectorDb.searchSimilar(
        textVector,
        'CLIP',
        topK,
        this.config.semanticThreshold
      );

      const formatted = results.map(r => ({
        path: r.filePath,
        similarity: r.similarity,
        matchedBy: 'cross-modal',
        query: textQuery
      }));

      this.emit('search:complete', { query: textQuery, results: formatted });

      return formatted;

    } catch (err) {
      this.emit('search:error', { query: textQuery, error: err.message });
      throw err;
    }
  }

  /**
   * 综合智能搜索
   * 结合多种搜索方式，返回最相关的结果
   */
  async intelligentSearch(query, options = {}) {
    const results = {
      query,
      byPath: [],        // 路径匹配
      byName: [],        // 文件名匹配
      bySemantic: [],    // 语义匹配
      byVisual: [],      // 视觉匹配
      combined: []       // 综合排序结果
    };

    // 1. 路径和文件名匹配（传统方式）
    results.byPath = await this._searchByPath(query);
    results.byName = await this._searchByName(query);

    // 2. 语义搜索（如果有 Embedding 模型）
    try {
      results.bySemantic = await this.naturalLanguageSearch(query, { topK: 10 });
    } catch (err) {
      console.log('[AI Search] 语义搜索不可用:', err.message);
    }

    // 3. 如果是图片相关查询，尝试跨模态搜索
    if (this._isImageRelatedQuery(query)) {
      try {
        results.byVisual = await this.crossModalSearch(query, { topK: 10 });
      } catch (err) {
        console.log('[AI Search] 跨模态搜索不可用:', err.message);
      }
    }

    // 4. 综合排序（去重 + 加权）
    results.combined = this._mergeAndRankResults(results);

    return results;
  }

  /**
   * 判断是否为图片相关查询
   */
  _isImageRelatedQuery(query) {
    const imageKeywords = ['图片', '照片', '截图', '图像', 'jpg', 'png', 'photo', 'image'];
    return imageKeywords.some(kw => query.toLowerCase().includes(kw));
  }

  /**
   * 路径搜索（模糊匹配）
   */
  async _searchByPath(query) {
    // TODO: 实现基于 SQLite LIKE 的路径搜索
    return [];
  }

  /**
   * 文件名搜索
   */
  async _searchByName(query) {
    // TODO: 实现基于 SQLite 的文件名搜索
    return [];
  }

  /**
   * 合并并排序结果
   */
  _mergeAndRankResults(results) {
    const allResults = new Map();

    // 添加各类结果，赋予不同权重
    const addResults = (items, weight) => {
      items.forEach(item => {
        const existing = allResults.get(item.path);
        if (existing) {
          existing.score += (item.similarity || 0.5) * weight;
        } else {
          allResults.set(item.path, {
            ...item,
            score: (item.similarity || 0.5) * weight
          });
        }
      });
    };

    addResults(results.byPath, 1.0);
    addResults(results.byName, 0.8);
    addResults(results.bySemantic, 1.2);
    addResults(results.byVisual, 1.5);

    // 按分数排序
    return Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxResults);
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
      SELECT file_path, vector FROM vector_features
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
          vector: new Float32Array(row.vector.buffer)
        }));

        resolve(vectors);
      });
    });
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
   * 计算相关性等级
   */
  _calculateRelevance(similarity) {
    if (similarity >= 0.95) return { level: 'high', label: '高度相关', color: '#27ae60' };
    if (similarity >= 0.85) return { level: 'medium', label: '相关', color: '#f39c12' };
    return { level: 'low', label: '可能相关', color: '#95a5a6' };
  }
}

module.exports = { AISearchService };
