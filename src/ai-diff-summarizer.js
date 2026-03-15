/**
 * AI 局部差异摘要服务 (V2.0)
 *
 * 功能：
 * 1. 智能文档对比 - 使用 Myers Diff + 本地 LLM
 * 2. 差异摘要生成 - 用一句话总结核心区别
 * 3. 上下文窗口优化 - 处理大文档的分块策略
 */

const { EventEmitter } = require('events');

class AIDiffSummarizer extends EventEmitter {
  constructor(modelManager) {
    super();
    this.modelManager = modelManager;

    // LLM 配置
    this.config = {
      maxContextLength: 4096,      // 上下文窗口限制
      maxDiffChunks: 3,            // 最大差异块数
      summaryMaxLength: 200,       // 摘要最大长度
      temperature: 0.3             // 低温度，更确定性
    };
  }

  /**
   * ============================================
   * 1. 核心 API：智能文档对比
   * ============================================
   */

  /**
   * 对比两个文档并生成 AI 摘要
   * @param {string} fileA - 文档 A 路径
   * @param {string} fileB - 文档 B 路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} - 对比结果
   */
  async compareDocuments(fileA, fileB, options = {}) {
    this.emit('compare:start', { fileA, fileB });

    try {
      // 1. 提取文本内容
      const [textA, textB] = await Promise.all([
        this._extractText(fileA),
        this._extractText(fileB)
      ]);

      // 2. 使用 Myers Diff 算法找出差异
      const diffResult = this._myersDiff(textA, textB);

      // 3. 提取关键差异段落
      const keyDiffs = this._extractKeyDifferences(diffResult);

      // 4. 使用 LLM 生成摘要
      const summary = await this._generateSummary(fileA, fileB, keyDiffs);

      const result = {
        fileA,
        fileB,
        similarity: this._calculateSimilarity(diffResult),
        diffStats: {
          added: diffResult.added,
          removed: diffResult.removed,
          unchanged: diffResult.unchanged
        },
        keyDifferences: keyDiffs,
        aiSummary: summary,
        formattedDiff: this._formatDiffForDisplay(diffResult)
      };

      this.emit('compare:complete', result);
      return result;

    } catch (err) {
      this.emit('compare:error', { fileA, fileB, error: err.message });
      throw err;
    }
  }

  /**
   * 批量对比一组相似文档
   */
  async compareDocumentGroup(files, options = {}) {
    const results = [];

    // 以第一个文件为基准，与其他文件对比
    const baseFile = files[0];

    for (let i = 1; i < files.length; i++) {
      const result = await this.compareDocuments(baseFile, files[i], options);
      results.push(result);
    }

    // 生成组内总结
    const groupSummary = this._generateGroupSummary(results);

    return {
      baseFile,
      comparisons: results,
      groupSummary,
      recommendations: this._generateRecommendations(results)
    };
  }

  /**
   * ============================================
   * 2. Myers Diff 算法实现
   * ============================================
   */

  /**
   * Myers Diff 算法 - 找出两个文本的最短编辑脚本
   */
  _myersDiff(textA, textB) {
    const linesA = textA.split('\n');
    const linesB = textB.split('\n');

    const n = linesA.length;
    const m = linesB.length;

    // 特殊情况处理
    if (n === 0) return { added: m, removed: 0, unchanged: 0, edits: [] };
    if (m === 0) return { added: 0, removed: n, unchanged: 0, edits: [] };

    const max = n + m;
    const v = new Array(2 * max + 1).fill(0);
    const trace = [];

    // 搜索最短编辑路径
    for (let d = 0; d <= max; d++) {
      trace.push([...v]);

      for (let k = -d; k <= d; k += 2) {
        let x;

        if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
          x = v[k + 1 + max];
        } else {
          x = v[k - 1 + max] + 1;
        }

        let y = x - k;

        // 对角线移动（匹配的行）
        while (x < n && y < m && linesA[x] === linesB[y]) {
          x++;
          y++;
        }

        v[k + max] = x;

        if (x >= n && y >= m) {
          // 找到最短路径
          return this._backtrack(trace, linesA, linesB, d, k, max);
        }
      }
    }

    return { added: 0, removed: 0, unchanged: 0, edits: [] };
  }

  /**
   * 回溯构建编辑脚本
   */
  _backtrack(trace, linesA, linesB, d, k, max) {
    const edits = [];
    let x = linesA.length;
    let y = linesB.length;

    for (; d >= 0; d--) {
      const v = trace[d];
      const prevK = (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]))
        ? k + 1
        : k - 1;
      const prevX = v[prevK + max];
      const prevY = prevX - prevK;

      // 对角线移动（匹配）
      while (x > prevX && y > prevY) {
        edits.unshift({
          type: 'unchanged',
          lineA: linesA[x - 1],
          lineB: linesB[y - 1],
          indexA: x - 1,
          indexB: y - 1
        });
        x--;
        y--;
      }

      if (d === 0) break;

      // 水平移动（删除）
      if (x > prevX) {
        edits.unshift({
          type: 'removed',
          line: linesA[x - 1],
          index: x - 1
        });
        x--;
      }
      // 垂直移动（添加）
      else if (y > prevY) {
        edits.unshift({
          type: 'added',
          line: linesB[y - 1],
          index: y - 1
        });
        y--;
      }

      k = prevK;
    }

    // 统计
    const stats = {
      added: edits.filter(e => e.type === 'added').length,
      removed: edits.filter(e => e.type === 'removed').length,
      unchanged: edits.filter(e => e.type === 'unchanged').length,
      edits
    };

    return stats;
  }

  /**
   * ============================================
   * 3. 差异处理与摘要生成
   * ============================================
   */

  /**
   * 提取关键差异
   */
  _extractKeyDifferences(diffResult) {
    const { edits } = diffResult;
    const chunks = [];
    let currentChunk = null;

    // 将连续的差异分组
    for (const edit of edits) {
      if (edit.type === 'unchanged') {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = null;
        }
      } else {
        if (!currentChunk) {
          currentChunk = {
            type: edit.type === 'added' ? 'insertion' : 'deletion',
            lines: [],
            context: this._getContext(edits, edit)
          };
        }
        currentChunk.lines.push(edit.line || edit.lineA || edit.lineB);
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // 只保留最重要的几个差异块
    return chunks
      .sort((a, b) => b.lines.length - a.lines.length)
      .slice(0, this.config.maxDiffChunks);
  }

  /**
   * 获取差异的上下文
   */
  _getContext(edits, targetEdit) {
    const index = edits.indexOf(targetEdit);
    const contextLines = [];

    // 获取前后各 2 行作为上下文
    for (let i = Math.max(0, index - 2); i < Math.min(edits.length, index + 3); i++) {
      if (edits[i].type === 'unchanged') {
        contextLines.push(edits[i].lineA || edits[i].line);
      }
    }

    return contextLines;
  }

  /**
   * 使用 LLM 生成摘要
   */
  async _generateSummary(fileA, fileB, keyDiffs) {
    // 检查 LLM 模型是否可用
    const llmModel = this.modelManager.models.get('LLM');
    if (!llmModel || !llmModel.loaded) {
      return this._generateFallbackSummary(keyDiffs);
    }

    // 构建 Prompt
    const prompt = this._buildPrompt(fileA, fileB, keyDiffs);

    // 检查 Prompt 长度
    if (prompt.length > this.config.maxContextLength) {
      // 截断差异内容
      const truncatedDiffs = keyDiffs.map(d => ({
        ...d,
        lines: d.lines.slice(0, 5) // 只保留前 5 行
      }));
      return this._generateSummary(fileA, fileB, truncatedDiffs);
    }

    try {
      // TODO: 实际调用 LLM
      // const response = await llmModel.instance.generate(prompt);
      // return response.trim();

      // 模拟响应
      console.log('[AI Diff] Prompt:', prompt.substring(0, 200) + '...');
      return this._simulateLLMResponse(keyDiffs);

    } catch (err) {
      console.error('[AI Diff] LLM 生成失败:', err);
      return this._generateFallbackSummary(keyDiffs);
    }
  }

  /**
   * 构建 Prompt
   */
  _buildPrompt(fileA, fileB, keyDiffs) {
    const diffDescription = keyDiffs.map((diff, idx) => {
      const type = diff.type === 'insertion' ? '新增' : '删除';
      const content = diff.lines.join('\n');
      return `差异 ${idx + 1} (${type}):\n${content}`;
    }).join('\n\n');

    return `请用一句话向非专业人士总结以下两份文档的核心区别：

文档 A: ${path.basename(fileA)}
文档 B: ${path.basename(fileB)}

关键差异：
${diffDescription}

请用一句话总结（不超过 100 字）：`;
  }

  /**
   * 生成备用摘要（LLM 不可用时）
   */
  _generateFallbackSummary(keyDiffs) {
    const insertions = keyDiffs.filter(d => d.type === 'insertion');
    const deletions = keyDiffs.filter(d => d.type === 'deletion');

    const parts = [];

    if (insertions.length > 0) {
      const lines = insertions.reduce((sum, d) => sum + d.lines.length, 0);
      parts.push(`新增了约 ${lines} 行内容`);
    }

    if (deletions.length > 0) {
      const lines = deletions.reduce((sum, d) => sum + d.lines.length, 0);
      parts.push(`删除了约 ${lines} 行内容`);
    }

    if (parts.length === 0) {
      return '两份文档内容基本相同';
    }

    return parts.join('，') + '。';
  }

  /**
   * 模拟 LLM 响应（开发测试用）
   */
  _simulateLLMResponse(keyDiffs) {
    const scenarios = [
      '版本 B 相比版本 A 增加了免责声明和违约金条款',
      '新版本补充了数据表格和参考文献部分',
      '文档 B 删除了过时的联系方式，更新了公司地址',
      '修订版增加了执行摘要，优化了章节结构',
      '版本 A 比版本 B 多了附录部分的详细说明'
    ];

    // 根据差异类型选择最相关的描述
    const hasInsertions = keyDiffs.some(d => d.type === 'insertion');
    const hasDeletions = keyDiffs.some(d => d.type === 'deletion');

    if (hasInsertions && hasDeletions) {
      return scenarios[0];
    } else if (hasInsertions) {
      return scenarios[1];
    } else if (hasDeletions) {
      return scenarios[2];
    }

    return scenarios[Math.floor(Math.random() * scenarios.length)];
  }

  /**
   * ============================================
   * 4. 辅助功能
   * ============================================
   */

  /**
   * 提取文档文本
   */
  async _extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // 根据文件类型选择提取方式
    switch (ext) {
      case '.txt':
      case '.md':
        return fs.readFileSync(filePath, 'utf-8');

      case '.pdf':
        // TODO: 使用 pdf-parse 提取文本
        return `[PDF 内容: ${path.basename(filePath)}]`;

      case '.doc':
      case '.docx':
        // TODO: 使用 mammoth 提取文本
        return `[Word 内容: ${path.basename(filePath)}]`;

      default:
        return `[无法提取 ${ext} 文件的文本内容]`;
    }
  }

  /**
   * 计算相似度
   */
  _calculateSimilarity(diffResult) {
    const total = diffResult.added + diffResult.removed + diffResult.unchanged;
    if (total === 0) return 1.0;

    return diffResult.unchanged / total;
  }

  /**
   * 格式化差异用于显示
   */
  _formatDiffForDisplay(diffResult) {
    const lines = [];

    for (const edit of diffResult.edits) {
      switch (edit.type) {
        case 'added':
          lines.push(`+ ${edit.line}`);
          break;
        case 'removed':
          lines.push(`- ${edit.line}`);
          break;
        case 'unchanged':
          lines.push(`  ${edit.lineA}`);
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成组内总结
   */
  _generateGroupSummary(comparisons) {
    const avgSimilarity = comparisons.reduce((sum, c) => sum + c.similarity, 0)
      / comparisons.length;

    const totalAdded = comparisons.reduce((sum, c) => sum + c.diffStats.added, 0);
    const totalRemoved = comparisons.reduce((sum, c) => sum + c.diffStats.removed, 0);

    return {
      averageSimilarity: avgSimilarity,
      totalChanges: {
        added: totalAdded,
        removed: totalRemoved
      },
      description: `这组文档平均相似度为 ${(avgSimilarity * 100).toFixed(1)}%，` +
        `共新增 ${totalAdded} 行，删除 ${totalRemoved} 行。`
    };
  }

  /**
   * 生成保留建议
   */
  _generateRecommendations(comparisons) {
    // 按相似度排序，推荐保留最完整的版本
    const sorted = [...comparisons].sort((a, b) => b.similarity - a.similarity);

    return {
      keep: sorted[0]?.fileB,  // 与基准文件最相似的
      reasons: ['内容最完整', '与基准版本差异最小']
    };
  }

  /**
   * ============================================
   * 5. 相似文件合并建议 (Qwen增强)
   * ============================================
   */

  /**
   * 分析相似但不相同的文档，生成合并建议
   * 适用于：合同版本、代码片段、多版本稿件
   */
  async analyzeForMerge(fileA, fileB, options = {}) {
    this.emit('merge:analysis:start', { fileA, fileB });

    try {
      // 1. 提取文本
      const [textA, textB] = await Promise.all([
        this._extractText(fileA),
        this._extractText(fileB)
      ]);

      // 2. 计算相似度
      const similarity = this._calculateTextSimilarity(textA, textB);

      // 3. 如果相似度不够高，直接返回
      if (similarity < 0.5) {
        return {
          canMerge: false,
          reason: '文档差异过大，不建议自动合并',
          similarity
        };
      }

      // 4. 使用Myers Diff找出差异
      const diffResult = this._myersDiff(textA, textB);

      // 5. 提取关键差异
      const keyDiffs = this._extractKeyDifferences(diffResult);

      // 6. 使用LLM生成合并建议
      const mergeAdvice = await this._generateMergeAdvice(fileA, fileB, keyDiffs, similarity);

      // 7. 生成合并后的内容预览
      const mergedPreview = this._generateMergedPreview(textA, textB, diffResult, mergeAdvice);

      const result = {
        canMerge: similarity > 0.7,
        similarity,
        diffStats: {
          added: diffResult.added,
          removed: diffResult.removed,
          unchanged: diffResult.unchanged
        },
        keyDifferences: keyDiffs,
        mergeAdvice,
        mergedPreview,
        recommendations: this._generateMergeRecommendations(keyDiffs, similarity)
      };

      this.emit('merge:analysis:complete', result);
      return result;

    } catch (err) {
      this.emit('merge:analysis:error', { fileA, fileB, error: err.message });
      throw err;
    }
  }

  /**
   * 批量分析文档组，找出最佳合并策略
   */
  async analyzeDocumentGroupForMerge(files, options = {}) {
    if (files.length < 2) {
      return { error: '至少需要2个文件才能分析合并' };
    }

    // 以内容最完整的文件为基准
    const fileContents = await Promise.all(
      files.map(async f => ({
        path: f,
        content: await this._extractText(f),
        size: (await fs.promises.stat(f)).size
      }))
    );

    // 选择最长的文件作为基准（假设最完整）
    const baseFile = fileContents.reduce((max, f) =>
      f.content.length > max.content.length ? f : max
    );

    // 分析每个文件与基准的差异
    const analyses = [];
    for (const file of fileContents) {
      if (file.path === baseFile.path) continue;

      const analysis = await this.analyzeForMerge(baseFile.path, file.path, options);
      analyses.push({
        file: file.path,
        ...analysis
      });
    }

    // 生成组级合并建议
    const groupAdvice = this._generateGroupMergeAdvice(baseFile, fileContents, analyses);

    return {
      baseFile: baseFile.path,
      analyses,
      groupAdvice,
      suggestedAction: this._suggestGroupAction(analyses)
    };
  }

  /**
   * 计算文本相似度（基于编辑距离）
   */
  _calculateTextSimilarity(textA, textB) {
    const maxLength = Math.max(textA.length, textB.length);
    if (maxLength === 0) return 1.0;

    const distance = this._levenshteinDistance(textA, textB);
    return 1 - distance / maxLength;
  }

  /**
   * Levenshtein距离（编辑距离）
   */
  _levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // 替换
            matrix[i][j - 1] + 1,     // 插入
            matrix[i - 1][j] + 1      // 删除
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * 生成合并建议（使用LLM）
   */
  async _generateMergeAdvice(fileA, fileB, keyDiffs, similarity) {
    const llmModel = this.modelManager?.models?.get('LLM');

    const diffSummary = keyDiffs.map((diff, idx) => {
      const type = diff.type === 'insertion' ? '新增内容' : '删除内容';
      const preview = diff.lines.slice(0, 3).join('; ');
      return `${idx + 1}. ${type}: "${preview.substring(0, 100)}..."`;
    }).join('\n');

    const prompt = `分析以下两份文档的差异，给出合并建议：

文档A: ${path.basename(fileA)}
文档B: ${path.basename(fileB)}
相似度: ${(similarity * 100).toFixed(1)}%

关键差异:
${diffSummary}

请提供:
1. 一句话总结两份文档的关系
2. 应该保留哪份为主（A或B）
3. 建议从另一份文档提取什么内容补充
4. 合并时的注意事项

用JSON格式返回: {"summary": "...", "keepPrimary": "A|B", "extractFromOther": "...", "cautions": "..."}`;

    // 如果LLM可用，使用它
    if (llmModel?.loaded) {
      try {
        // const response = await llmModel.instance.generate(prompt);
        // return JSON.parse(response);
        return this._simulateMergeAdvice(keyDiffs, similarity);
      } catch (err) {
        console.warn('[AI Diff] LLM生成合并建议失败，使用fallback:', err);
      }
    }

    return this._generateFallbackMergeAdvice(keyDiffs, similarity);
  }

  /**
   * 生成Fallback合并建议
   */
  _generateFallbackMergeAdvice(keyDiffs, similarity) {
    const insertions = keyDiffs.filter(d => d.type === 'insertion');
    const deletions = keyDiffs.filter(d => d.type === 'deletion');

    let keepPrimary = similarity > 0.8 ? 'B' : 'A';
    let extractFromOther = '';

    if (insertions.length > 0) {
      const totalLines = insertions.reduce((sum, d) => sum + d.lines.length, 0);
      extractFromOther = `建议提取新增的 ${totalLines} 行内容`;
    }

    return {
      summary: `两份文档相似度${(similarity * 100).toFixed(1)}%，${insertions.length > 0 ? 'B文档有新增内容' : '内容基本一致'}`,
      keepPrimary,
      extractFromOther,
      cautions: '请人工审核合并结果，确保逻辑一致性'
    };
  }

  /**
   * 模拟LLM合并建议
   */
  _simulateMergeAdvice(keyDiffs, similarity) {
    const scenarios = [
      {
        summary: '文档B是文档A的修订版，增加了免责声明和更新日期',
        keepPrimary: 'B',
        extractFromOther: '无需提取，B已包含全部内容',
        cautions: '注意检查新增条款的法律效力'
      },
      {
        summary: '文档A比文档B更完整，但B补充了数据表格',
        keepPrimary: 'A',
        extractFromOther: '提取B中的数据表格和图表',
        cautions: '确保表格数据格式兼容'
      },
      {
        summary: '两份文档是平行版本，各有补充',
        keepPrimary: 'A',
        extractFromOther: '提取B中的第3节和第5节内容',
        cautions: '需要人工整合重复章节'
      }
    ];

    if (similarity > 0.9) {
      return scenarios[0];
    } else if (similarity > 0.7) {
      return scenarios[1];
    }
    return scenarios[2];
  }

  /**
   * 生成合并后的内容预览
   */
  _generateMergedPreview(textA, textB, diffResult, mergeAdvice) {
    // 简单的三路合并预览
    const lines = [];
    let inConflict = false;

    for (const edit of diffResult.edits.slice(0, 50)) { // 限制预览长度
      switch (edit.type) {
        case 'unchanged':
          if (inConflict) {
            lines.push('>>>>>>> END');
            inConflict = false;
          }
          lines.push(edit.lineA);
          break;

        case 'added':
          if (!inConflict) {
            lines.push('<<<<<<< 新增内容');
            inConflict = true;
          }
          lines.push('+ ' + edit.line);
          break;

        case 'removed':
          if (!inConflict) {
            lines.push('<<<<<<< 删除内容');
            inConflict = true;
          }
          lines.push('- ' + edit.line);
          break;
      }
    }

    if (inConflict) {
      lines.push('>>>>>>> END');
    }

    return {
      preview: lines.join('\n'),
      isTruncated: diffResult.edits.length > 50,
      totalLines: diffResult.edits.length
    };
  }

  /**
   * 生成合并建议
   */
  _generateMergeRecommendations(keyDiffs, similarity) {
    const recommendations = [];

    if (similarity > 0.9) {
      recommendations.push({
        action: 'replace',
        description: '直接用新版本替换旧版本',
        confidence: 'high'
      });
    } else if (similarity > 0.7) {
      recommendations.push({
        action: 'merge',
        description: '合并两份文档的差异',
        confidence: 'medium'
      });
    } else {
      recommendations.push({
        action: 'manual',
        description: '差异较大，建议人工审核后手动合并',
        confidence: 'low'
      });
    }

    // 根据差异类型给出具体建议
    const hasMajorInsertions = keyDiffs.some(d =>
      d.type === 'insertion' && d.lines.length > 10
    );

    if (hasMajorInsertions) {
      recommendations.push({
        action: 'review',
        description: '检测到大量新增内容，建议仔细审查',
        confidence: 'medium'
      });
    }

    return recommendations;
  }

  /**
   * 生成组级合并建议
   */
  _generateGroupMergeAdvice(baseFile, allFiles, analyses) {
    const avgSimilarity = analyses.reduce((sum, a) => sum + a.similarity, 0) / analyses.length;

    const additions = analyses.map(a => a.diffStats.added);
    const maxAdditions = Math.max(...additions);
    const mostComplete = analyses.find(a => a.diffStats.added === maxAdditions);

    return {
      baseDocument: baseFile.path,
      averageSimilarity: avgSimilarity,
      mostCompleteVersion: mostComplete?.file,
      strategy: avgSimilarity > 0.8 ? 'incremental' : 'manual',
      description: `以"${path.basename(baseFile.path)}"为基准，` +
        `平均相似度${(avgSimilarity * 100).toFixed(1)}%。` +
        `${mostComplete ? '"' + path.basename(mostComplete.file) + '"内容最完整，建议作为主要参考' : ''}`
    };
  }

  /**
   * 建议组级操作
   */
  _suggestGroupAction(analyses) {
    const avgSimilarity = analyses.reduce((sum, a) => sum + a.similarity, 0) / analyses.length;

    if (avgSimilarity > 0.85) {
      return {
        action: 'auto-merge',
        description: '文档高度相似，可以自动合并',
        steps: ['选择最完整的版本作为主文档', '自动提取其他版本的差异', '生成合并后的最终版本']
      };
    } else if (avgSimilarity > 0.6) {
      return {
        action: 'guided-merge',
        description: '需要引导式合并',
        steps: ['逐一查看每份文档的差异', '选择要保留的内容', '人工确认合并结果']
      };
    } else {
      return {
        action: 'organize-only',
        description: '差异过大，建议仅整理不合并',
        steps: ['为每份文档创建版本标签', '建立版本间的引用关系', '保留所有版本供参考']
      };
    }
  }
}

module.exports = { AIDiffSummarizer };
