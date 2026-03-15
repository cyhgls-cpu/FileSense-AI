/**
 * 启发式留存评分模型 (V1.5+)
 *
 * 功能：
 * 1. 多维度加权评分 - 路径、质量、时间、命名规范等
 * 2. 智能推荐保留 - 自动标记"建议保留"的文件
 * 3. 批量决策支持 - 一键清理建议删除的文件
 */

const path = require('path');
const fs = require('fs');

class RetentionScoring {
  constructor(options = {}) {
    // 评分权重配置（可自定义）
    this.weights = {
      path: options.pathWeight || 0.25,        // 路径权重
      quality: options.qualityWeight || 0.30,  // 质量权重
      time: options.timeWeight || 0.25,        // 时间权重
      naming: options.namingWeight || 0.10,    // 命名规范权重
      metadata: options.metadataWeight || 0.10 // 元数据完整度权重
    };

    // 路径优先级配置
    this.pathPriorities = {
      high: [                                      // 高优先级路径
        /\/Desktop\//i,
        /\/Documents\//i,
        /\/Projects\//i,
        /\/Work\//i
      ],
      low: [                                        // 低优先级路径
        /\/Downloads\//i,
        /\/Temp\//i,
        /\/Cache\//i,
        /\.tmp$/i,
        /\/Trash\//i,
        /\/RecycleBin\//i
      ]
    };

    // 命名规范正则
    this.namingPatterns = {
      excellent: [                                  // 优秀的命名
        /\d{4}[-_]\d{2}[-_]\d{2}/,                  // 包含日期 2024-01-01
        /v\d+\.\d+/,                                 // 包含版本号 v1.0
        /final|正式|定稿/i,                          // 标记为最终版
        /[\u4e00-\u9fa5]+/                            // 包含中文描述
      ],
      poor: [                                       // 较差的命名
        /copy|副本|复件/i,
        /\(\d+\)$/,                                  // 以数字结尾 (1), (2)
        /^[a-zA-Z0-9]{1,8}$/,                        // 过短的随机名
        /temp|tmp|临时/i
      ]
    };
  }

  /**
   * ============================================
   * 1. 核心评分 API
   * ============================================
   */

  /**
   * 计算文件的留存评分
   * @param {string} filePath - 文件路径
   * @param {Object} metadata - 文件元数据
   * @param {Object} context - 上下文信息（如同组其他文件）
   * @returns {Object} - 评分结果
   */
  calculateScore(filePath, metadata = {}, context = {}) {
    const scores = {
      path: this._scorePath(filePath),
      quality: this._scoreQuality(metadata),
      time: this._scoreTime(metadata),
      naming: this._scoreNaming(filePath),
      metadata: this._scoreMetadata(metadata)
    };

    // 计算加权总分
    let totalScore = 0;
    for (const [dimension, score] of Object.entries(scores)) {
      totalScore += score * this.weights[dimension];
    }

    // 归一化到 0-100
    totalScore = Math.round(totalScore * 100);

    // 确定推荐等级
    const recommendation = this._getRecommendation(totalScore, context);

    return {
      filePath,
      totalScore,
      scores,
      recommendation,
      reasons: this._generateReasons(scores, recommendation)
    };
  }

  /**
   * 批量评分 - 对一组相似文件进行评分并排序
   * @param {Array} files - 文件列表 [{ path, metadata }]
   * @returns {Array} - 按评分排序的结果
   */
  scoreBatch(files) {
    // 计算每个文件的评分
    const scored = files.map(file =>
      this.calculateScore(file.path, file.metadata, { groupSize: files.length })
    );

    // 按总分降序排序
    scored.sort((a, b) => b.totalScore - a.totalScore);

    // 标记建议保留的文件（每组最高分）
    if (scored.length > 0) {
      scored[0].recommendation = 'keep-canonical';
      scored[0].isCanonical = true;
    }

    // 标记建议删除的文件（低分）
    scored.forEach((item, idx) => {
      if (idx > 0 && item.totalScore < 60) {
        item.recommendation = 'delete';
        item.shouldDelete = true;
      }
    });

    return scored;
  }

  /**
   * 生成清理建议
   * @param {Array} similarGroups - 相似文件组
   * @returns {Object} - 清理建议
   */
  generateCleanupPlan(similarGroups) {
    const plan = {
      groups: [],
      summary: {
        totalGroups: similarGroups.length,
        totalFiles: 0,
        recommendedKeep: 0,
        recommendedDelete: 0,
        potentialSpaceSaved: 0
      }
    };

    for (const group of similarGroups) {
      const scored = this.scoreBatch(group.files);
      const keepFiles = scored.filter(s => s.recommendation === 'keep-canonical');
      const deleteFiles = scored.filter(s => s.shouldDelete);

      plan.groups.push({
        id: group.id,
        description: group.description,
        files: scored,
        keep: keepFiles,
        delete: deleteFiles,
        spaceToSave: deleteFiles.reduce((sum, f) => sum + (f.metadata?.size || 0), 0)
      });

      plan.summary.totalFiles += group.files.length;
      plan.summary.recommendedKeep += keepFiles.length;
      plan.summary.recommendedDelete += deleteFiles.length;
      plan.summary.potentialSpaceSaved += deleteFiles.reduce(
        (sum, f) => sum + (f.metadata?.size || 0), 0
      );
    }

    return plan;
  }

  /**
   * ============================================
   * 2. 各维度评分算法
   * ============================================
   */

  /**
   * 路径评分
   * 核心目录 > 普通目录 > 临时目录
   */
  _scorePath(filePath) {
    let score = 0.5; // 基础分

    // 检查高优先级路径
    for (const pattern of this.pathPriorities.high) {
      if (pattern.test(filePath)) {
        score = 1.0;
        break;
      }
    }

    // 检查低优先级路径
    for (const pattern of this.pathPriorities.low) {
      if (pattern.test(filePath)) {
        score = 0.2;
        break;
      }
    }

    // 路径深度惩罚（过深的路径可能不太重要）
    const depth = filePath.split(/[\/\\]/).length;
    if (depth > 8) {
      score *= 0.9;
    }

    return Math.min(1.0, score);
  }

  /**
   * 质量评分
   * 分辨率、文件大小、完整性等
   */
  _scoreQuality(metadata) {
    let score = 0.5;

    // 图片质量评分
    if (metadata.width && metadata.height) {
      const pixels = metadata.width * metadata.height;
      if (pixels >= 3840 * 2160) score = 1.0;      // 4K
      else if (pixels >= 1920 * 1080) score = 0.9; // 1080p
      else if (pixels >= 1280 * 720) score = 0.7;  // 720p
      else if (pixels >= 640 * 480) score = 0.5;   // SD
      else score = 0.3;                             // 低分辨率
    }

    // 文档质量评分（页数、内容量）
    if (metadata.pageCount) {
      if (metadata.pageCount >= 10) score = Math.max(score, 0.8);
    }

    // 文件大小（在合理范围内，越大通常越完整）
    if (metadata.size) {
      const sizeMB = metadata.size / (1024 * 1024);
      if (sizeMB > 100) score *= 0.9; // 过大的文件可能有问题
    }

    // 完整性检查
    if (metadata.isCorrupted) {
      score = 0.1;
    }

    return Math.min(1.0, score);
  }

  /**
   * 时间评分
   * 最新的文件通常更有价值
   */
  _scoreTime(metadata) {
    let score = 0.5;

    if (!metadata.mtime) return score;

    const fileTime = new Date(metadata.mtime);
    const now = new Date();
    const daysDiff = (now - fileTime) / (1000 * 60 * 60 * 24);

    if (daysDiff < 7) {
      score = 1.0; // 最近一周
    } else if (daysDiff < 30) {
      score = 0.9; // 最近一月
    } else if (daysDiff < 90) {
      score = 0.8; // 最近三月
    } else if (daysDiff < 365) {
      score = 0.6; // 最近一年
    } else {
      score = 0.4; // 超过一年
    }

    // 工作时间创建的文件（可能更正式）
    const hour = fileTime.getHours();
    if (hour >= 9 && hour <= 18) {
      score *= 1.05;
    }

    return Math.min(1.0, score);
  }

  /**
   * 命名规范评分
   */
  _scoreNaming(filePath) {
    const filename = path.basename(filePath);
    let score = 0.5;

    // 检查优秀命名模式
    for (const pattern of this.namingPatterns.excellent) {
      if (pattern.test(filename)) {
        score = 1.0;
        break;
      }
    }

    // 检查差命名模式
    for (const pattern of this.namingPatterns.poor) {
      if (pattern.test(filename)) {
        score = 0.2;
        break;
      }
    }

    // 文件名长度（适中为佳）
    const nameLength = path.basename(filename, path.extname(filename)).length;
    if (nameLength >= 10 && nameLength <= 50) {
      score *= 1.1;
    } else if (nameLength < 5) {
      score *= 0.7;
    }

    return Math.min(1.0, score);
  }

  /**
   * 元数据完整度评分
   */
  _scoreMetadata(metadata) {
    let score = 0.5;
    let hasFields = 0;
    let totalFields = 0;

    const importantFields = [
      'size', 'mtime', 'width', 'height',
      'author', 'title', 'created', 'pageCount'
    ];

    for (const field of importantFields) {
      totalFields++;
      if (metadata[field] !== undefined && metadata[field] !== null) {
        hasFields++;
      }
    }

    score = hasFields / totalFields;

    // EXIF 数据（图片）
    if (metadata.exif) {
      score = Math.min(1.0, score + 0.2);
    }

    return score;
  }

  /**
   * ============================================
   * 3. 推荐决策
   * ============================================
   */

  /**
   * 根据评分获取推荐
   */
  _getRecommendation(score, context = {}) {
    if (score >= 85) {
      return {
        action: 'keep',
        level: 'highly-recommended',
        label: '⭐ 强烈推荐保留',
        icon: '⭐',
        color: '#27ae60',
        description: '该文件在多个维度表现优秀，建议作为保留版本'
      };
    }

    if (score >= 70) {
      return {
        action: 'keep',
        level: 'recommended',
        label: '✓ 建议保留',
        icon: '✓',
        color: '#2ecc71',
        description: '该文件表现良好，可以考虑保留'
      };
    }

    if (score >= 50) {
      return {
        action: 'review',
        level: 'neutral',
        label: '? 需要审核',
        icon: '?',
        color: '#f39c12',
        description: '该文件表现一般，建议人工审核'
      };
    }

    return {
      action: 'delete',
      level: 'not-recommended',
      label: '✗ 建议删除',
      icon: '✗',
      color: '#e74c3c',
      description: '该文件在多个维度表现较差，建议删除'
    };
  }

  /**
   * 生成评分理由
   */
  _generateReasons(scores, recommendation) {
    const reasons = [];

    // 最高分维度
    const maxDimension = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])[0];

    if (maxDimension[1] >= 0.9) {
      reasons.push({
        type: 'strength',
        dimension: maxDimension[0],
        message: this._getDimensionStrengthMessage(maxDimension[0])
      });
    }

    // 最低分维度
    const minDimension = Object.entries(scores)
      .sort((a, b) => a[1] - b[1])[0];

    if (minDimension[1] <= 0.3) {
      reasons.push({
        type: 'weakness',
        dimension: minDimension[0],
        message: this._getDimensionWeaknessMessage(minDimension[0])
      });
    }

    return reasons;
  }

  /**
   * 获取维度优势描述
   */
  _getDimensionStrengthMessage(dimension) {
    const messages = {
      path: '位于核心工作目录',
      quality: '文件质量高（高分辨率/完整内容）',
      time: '最近创建或修改',
      naming: '命名规范，易于识别',
      metadata: '元数据完整'
    };
    return messages[dimension] || '表现优秀';
  }

  /**
   * 获取维度劣势描述
   */
  _getDimensionWeaknessMessage(dimension) {
    const messages = {
      path: '位于临时/下载目录',
      quality: '文件质量较低',
      time: '创建时间较早',
      naming: '命名不规范',
      metadata: '缺少元数据'
    };
    return messages[dimension] || '表现较差';
  }

  /**
   * ============================================
   * 4. 批量决策 API
   * ============================================
   */

  /**
   * 一键清理建议删除的文件
   */
  async executeCleanup(plan, options = {}) {
    const { dryRun = true, moveToTrash = true } = options;
    const results = {
      dryRun,
      processed: [],
      errors: [],
      spaceSaved: 0
    };

    for (const group of plan.groups) {
      for (const file of group.delete) {
        try {
          if (dryRun) {
            results.processed.push({
              path: file.filePath,
              action: 'would-delete',
              size: file.metadata?.size || 0
            });
          } else {
            // 实际删除或移动到回收站
            if (moveToTrash) {
              // TODO: 实现移动到回收站
              // await shell.moveItemToTrash(file.filePath);
            } else {
              fs.unlinkSync(file.filePath);
            }

            results.processed.push({
              path: file.filePath,
              action: 'deleted',
              size: file.metadata?.size || 0
            });
          }

          results.spaceSaved += file.metadata?.size || 0;
        } catch (err) {
          results.errors.push({
            path: file.filePath,
            error: err.message
          });
        }
      }
    }

    return results;
  }
}

module.exports = { RetentionScoring };
