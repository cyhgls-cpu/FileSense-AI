/**
 * 留存偏好自适应学习 (RLHF桌面版)
 * 学习用户的文件清理习惯，动态调整评分权重
 * 核心技术：在线梯度下降 + 特征差异分析
 */

const { EventEmitter } = require('events');

class PreferenceLearner extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;

    // 默认权重配置
    this.defaultWeights = {
      path: 0.25,      // 路径深度评分
      quality: 0.30,   // 文件质量评分
      time: 0.25,      // 时间新旧评分
      naming: 0.10,    // 命名规范评分
      metadata: 0.10   // 元数据完整度评分
    };

    // 学习率
    this.learningRate = 0.05;

    // 文件类型特定的偏好
    this.typePreferences = new Map();

    // 最小反馈数才开始学习
    this.minFeedbackCount = 3;
  }

  /**
   * 初始化数据库表
   */
  async init() {
    const sql = `
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT NOT NULL,           -- 'image', 'document', 'software', 'code', 'all'
        weights_json TEXT NOT NULL,        -- 权重配置JSON
        feedback_count INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0,         -- 置信度 (0-1)
        created_at REAL DEFAULT (strftime('%s', 'now')),
        updated_at REAL DEFAULT (strftime('%s', 'now')),
        UNIQUE(file_type)
      );

      CREATE TABLE IF NOT EXISTS user_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_type TEXT,
        group_id TEXT,                     -- 重复组标识
        recommended_path TEXT,             -- 系统推荐保留的文件
        chosen_path TEXT,                  -- 用户实际选择的文件
        rejected_path TEXT,                -- 用户放弃的文件
        features_json TEXT,                -- 特征差异JSON
        context_json TEXT,                 -- 决策上下文
        timestamp REAL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_type ON user_feedback(file_type);
      CREATE INDEX IF NOT EXISTS idx_feedback_group ON user_feedback(group_id);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else {
          // 加载已有偏好
          this._loadPreferences().then(resolve).catch(reject);
        }
      });
    });
  }

  /**
   * 获取文件类型的偏好权重
   */
  async getWeights(fileType = 'all') {
    // 检查是否有该类型的特定偏好
    if (this.typePreferences.has(fileType)) {
      const pref = this.typePreferences.get(fileType);
      if (pref.feedbackCount >= this.minFeedbackCount) {
        return pref.weights;
      }
    }

    // 回退到通用偏好
    if (this.typePreferences.has('all')) {
      const pref = this.typePreferences.get('all');
      if (pref.feedbackCount >= this.minFeedbackCount) {
        return pref.weights;
      }
    }

    // 返回默认权重
    return { ...this.defaultWeights };
  }

  /**
   * 记录用户反馈
   * @param {Object} feedback - 反馈数据
   */
  async recordFeedback(feedback) {
    const {
      fileType = 'all',
      groupId,
      recommended,
      chosen,
      rejected,
      context = {}
    } = feedback;

    // 提取特征差异
    const featureDiff = this._extractFeatureDiff(recommended, chosen, rejected);

    // 保存反馈到数据库
    await new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_feedback
         (file_type, group_id, recommended_path, chosen_path, rejected_path, features_json, context_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          fileType,
          groupId,
          recommended.path,
          chosen.path,
          rejected.path,
          JSON.stringify(featureDiff),
          JSON.stringify(context)
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 更新权重
    await this._updateWeights(fileType, featureDiff);

    this.emit('feedback:recorded', {
      fileType,
      featureDiff,
      currentWeights: await this.getWeights(fileType)
    });

    return featureDiff;
  }

  /**
   * 提取特征差异
   */
  _extractFeatureDiff(recommended, chosen, rejected) {
    const diff = {};

    // 路径深度差异
    const recommendedDepth = recommended.path.split(/[\\/]/).length;
    const chosenDepth = chosen.path.split(/[\\/]/).length;
    const rejectedDepth = rejected.path.split(/[\\/]/).length;

    diff.pathDepth = {
      recommended: recommendedDepth,
      chosen: chosenDepth,
      rejected: rejectedDepth,
      preference: chosenDepth < rejectedDepth ? 'shallow' :
                  chosenDepth > rejectedDepth ? 'deep' : 'neutral'
    };

    // 文件大小差异
    diff.fileSize = {
      recommended: recommended.size,
      chosen: chosen.size,
      rejected: rejected.size,
      preference: chosen.size > rejected.size ? 'larger' :
                  chosen.size < rejected.size ? 'smaller' : 'neutral'
    };

    // 修改时间差异
    const now = Date.now();
    const recommendedAge = now - new Date(recommended.mtime).getTime();
    const chosenAge = now - new Date(chosen.mtime).getTime();
    const rejectedAge = now - new Date(rejected.mtime).getTime();

    diff.modifiedTime = {
      recommended: recommendedAge,
      chosen: chosenAge,
      rejected: rejectedAge,
      preference: chosenAge < rejectedAge ? 'newer' :
                  chosenAge > rejectedAge ? 'older' : 'neutral'
    };

    // 命名质量差异
    const recommendedNamingScore = this._scoreNaming(recommended.path);
    const chosenNamingScore = this._scoreNaming(chosen.path);
    const rejectedNamingScore = this._scoreNaming(rejected.path);

    diff.naming = {
      recommended: recommendedNamingScore,
      chosen: chosenNamingScore,
      rejected: rejectedNamingScore,
      preference: chosenNamingScore > rejectedNamingScore ? 'better' :
                  chosenNamingScore < rejectedNamingScore ? 'worse' : 'neutral'
    };

    // 元数据完整度差异
    diff.metadata = {
      recommended: recommended.metadataScore || 0,
      chosen: chosen.metadataScore || 0,
      rejected: rejected.metadataScore || 0,
      preference: 'neutral' // 简化处理
    };

    return diff;
  }

  /**
   * 评分文件名质量
   */
  _scoreNaming(filePath) {
    const filename = require('path').basename(filePath);
    let score = 0;

    // 有描述性名称（不是纯数字/随机字符）
    if (/[a-zA-Z\u4e00-\u9fa5]/.test(filename)) score += 0.3;

    // 包含日期信息
    if (/\d{4}[-_]\d{2}[-_]\d{2}/.test(filename)) score += 0.2;

    // 使用下划线或连字符分隔
    if (/[_-]/.test(filename)) score += 0.2;

    // 不是默认命名（如IMG_, DSC_, 截图等）
    if (!/^(IMG|DSC|截图|image|P|pic)_?\d+/i.test(filename)) score += 0.3;

    return Math.min(1, score);
  }

  /**
   * 更新权重（在线梯度下降）
   */
  async _updateWeights(fileType, featureDiff) {
    // 获取当前权重
    let currentPref = this.typePreferences.get(fileType);
    if (!currentPref) {
      currentPref = {
        weights: { ...this.defaultWeights },
        feedbackCount: 0,
        confidence: 0
      };
    }

    const weights = { ...currentPref.weights };

    // 根据特征差异调整权重
    const adjustments = this._calculateAdjustments(featureDiff);

    // 应用调整（带学习率）
    for (const [key, adjustment] of Object.entries(adjustments)) {
      if (weights[key] !== undefined) {
        weights[key] += adjustment * this.learningRate;
        // 限制在合理范围内
        weights[key] = Math.max(0.05, Math.min(0.5, weights[key]));
      }
    }

    // 归一化权重，确保总和为1
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const key of Object.keys(weights)) {
      weights[key] /= totalWeight;
    }

    // 更新偏好
    currentPref.weights = weights;
    currentPref.feedbackCount++;
    currentPref.confidence = Math.min(1, currentPref.feedbackCount / 10);
    currentPref.updatedAt = Date.now();

    this.typePreferences.set(fileType, currentPref);

    // 保存到数据库
    await this._savePreference(fileType, currentPref);

    this.emit('weights:updated', {
      fileType,
      weights,
      confidence: currentPref.confidence
    });
  }

  /**
   * 计算权重调整量
   */
  _calculateAdjustments(featureDiff) {
    const adjustments = {};

    // 路径深度偏好
    if (featureDiff.pathDepth) {
      const { preference } = featureDiff.pathDepth;
      if (preference === 'shallow') {
        adjustments.path = 0.05; // 增加路径权重，偏好浅层
      } else if (preference === 'deep') {
        adjustments.path = -0.03;
      }
    }

    // 文件大小偏好
    if (featureDiff.fileSize) {
      const { preference } = featureDiff.fileSize;
      if (preference === 'larger') {
        adjustments.quality = 0.05; // 增加质量权重（大小是质量的一部分）
      } else if (preference === 'smaller') {
        adjustments.quality = -0.03;
      }
    }

    // 时间偏好
    if (featureDiff.modifiedTime) {
      const { preference } = featureDiff.modifiedTime;
      if (preference === 'newer') {
        adjustments.time = 0.05;
      } else if (preference === 'older') {
        adjustments.time = -0.03;
      }
    }

    // 命名偏好
    if (featureDiff.naming) {
      const { preference } = featureDiff.naming;
      if (preference === 'better') {
        adjustments.naming = 0.03;
      } else if (preference === 'worse') {
        adjustments.naming = -0.02;
      }
    }

    return adjustments;
  }

  /**
   * 保存偏好到数据库
   */
  async _savePreference(fileType, pref) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_preferences (file_type, weights_json, feedback_count, confidence, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file_type) DO UPDATE SET
           weights_json = excluded.weights_json,
           feedback_count = excluded.feedback_count,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at`,
        [
          fileType,
          JSON.stringify(pref.weights),
          pref.feedbackCount,
          pref.confidence,
          pref.updatedAt
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 加载所有偏好
   */
  async _loadPreferences() {
    const rows = await new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_preferences`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    for (const row of rows) {
      this.typePreferences.set(row.file_type, {
        weights: JSON.parse(row.weights_json),
        feedbackCount: row.feedback_count,
        confidence: row.confidence,
        updatedAt: row.updated_at
      });
    }
  }

  /**
   * 获取学习统计
   */
  async getStats() {
    const stats = await new Promise((resolve, reject) => {
      this.db.get(
        `SELECT
          COUNT(*) as total_feedback,
          COUNT(DISTINCT file_type) as types_learned
        FROM user_feedback`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    return {
      ...stats,
      preferences: Array.from(this.typePreferences.entries()).map(([type, pref]) => ({
        fileType: type,
        feedbackCount: pref.feedbackCount,
        confidence: pref.confidence,
        weights: pref.weights
      }))
    };
  }

  /**
   * 重置偏好（重新开始学习）
   */
  async reset(fileType = null) {
    if (fileType) {
      // 重置特定类型
      this.typePreferences.delete(fileType);
      await new Promise((resolve, reject) => {
        this.db.run(
          `DELETE FROM user_preferences WHERE file_type = ?`,
          [fileType],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } else {
      // 重置所有
      this.typePreferences.clear();
      await new Promise((resolve, reject) => {
        this.db.run(`DELETE FROM user_preferences`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    this.emit('preferences:reset', { fileType });
  }

  /**
   * 导出学习报告
   */
  async generateReport() {
    const stats = await this.getStats();
    const feedbacks = await new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_feedback ORDER BY timestamp DESC LIMIT 50`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    return {
      summary: stats,
      recentFeedbacks: feedbacks.map(f => ({
        ...f,
        features: JSON.parse(f.features_json),
        context: JSON.parse(f.context_json)
      })),
      insights: this._generateInsights(stats, feedbacks)
    };
  }

  /**
   * 生成洞察
   */
  _generateInsights(stats, feedbacks) {
    const insights = [];

    if (stats.total_feedback < this.minFeedbackCount) {
      insights.push('反馈数据不足，继续使用以提升个性化准确度');
    }

    // 分析偏好趋势
    const pathPrefs = feedbacks.filter(f => {
      const features = JSON.parse(f.features_json);
      return features.pathDepth?.preference !== 'neutral';
    });

    if (pathPrefs.length > 5) {
      const shallowRatio = pathPrefs.filter(f => {
        const features = JSON.parse(f.features_json);
        return features.pathDepth?.preference === 'shallow';
      }).length / pathPrefs.length;

      if (shallowRatio > 0.7) {
        insights.push('您倾向于保留路径层级较浅的文件');
      } else if (shallowRatio < 0.3) {
        insights.push('您倾向于保留路径层级较深的文件');
      }
    }

    // 时间偏好
    const timePrefs = feedbacks.filter(f => {
      const features = JSON.parse(f.features_json);
      return features.modifiedTime?.preference !== 'neutral';
    });

    if (timePrefs.length > 5) {
      const newerRatio = timePrefs.filter(f => {
        const features = JSON.parse(f.features_json);
        return features.modifiedTime?.preference === 'newer';
      }).length / timePrefs.length;

      if (newerRatio > 0.7) {
        insights.push('您倾向于保留较新的文件');
      } else if (newerRatio < 0.3) {
        insights.push('您倾向于保留较旧的文件（可能有怀旧倾向）');
      }
    }

    return insights;
  }
}

module.exports = { PreferenceLearner };
