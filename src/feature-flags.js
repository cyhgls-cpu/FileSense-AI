/**
 * 功能开关配置
 * 实现渐进式功能暴露，默认只显示基础功能
 * 高级功能隐藏在"实验室"或"高级模式"后
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 功能分类
const FEATURE_CATEGORIES = {
  BASIC: 'basic',           // 基础功能，始终显示
  ADVANCED: 'advanced',     // 高级功能，需要开启高级模式
  EXPERIMENTAL: 'experimental', // 实验性功能，需要开启实验室模式
  BETA: 'beta'              // 测试功能，需要特殊权限
};

// 功能定义
const FEATURES = {
  // 基础功能
  DUPLICATE_SCAN: {
    id: 'duplicate_scan',
    name: '重复文件扫描',
    description: '基于哈希值快速找出完全相同的文件',
    category: FEATURE_CATEGORIES.BASIC,
    defaultEnabled: true,
    icon: '🔍'
  },

  SIMILAR_IMAGE: {
    id: 'similar_image',
    name: '相似图片检测',
    description: '找出视觉上相似的图片',
    category: FEATURE_CATEGORIES.BASIC,
    defaultEnabled: true,
    icon: '🖼️'
  },

  FILE_PREVIEW: {
    id: 'file_preview',
    name: '文件预览',
    description: '支持图片、文档预览',
    category: FEATURE_CATEGORIES.BASIC,
    defaultEnabled: true,
    icon: '👁️'
  },

  // 高级功能（需要开启高级模式）
  AI_SEMANTIC_SEARCH: {
    id: 'ai_semantic_search',
    name: 'AI 语义搜索',
    description: '使用自然语言搜索文件内容',
    category: FEATURE_CATEGORIES.ADVANCED,
    defaultEnabled: false,
    icon: '🤖',
    requiresModel: 'EMBEDDING'
  },

  SMART_ORGANIZE: {
    id: 'smart_organize',
    name: '智能整理',
    description: 'AI 自动分类文件到合适文件夹',
    category: FEATURE_CATEGORIES.ADVANCED,
    defaultEnabled: false,
    icon: '📁',
    requiresModel: 'EMBEDDING'
  },

  CONTENT_DEDUP: {
    id: 'content_dedup',
    name: '内容级去重',
    description: '检测内容相似但格式不同的文件',
    category: FEATURE_CATEGORIES.ADVANCED,
    defaultEnabled: false,
    icon: '📝',
    requiresModel: 'EMBEDDING'
  },

  // 实验性功能（需要开启实验室模式）
  IMAGE_SEARCH: {
    id: 'image_search',
    name: '以图搜图',
    description: '上传图片搜索相似图片',
    category: FEATURE_CATEGORIES.EXPERIMENTAL,
    defaultEnabled: false,
    icon: '📷',
    requiresModel: 'CLIP'
  },

  SMART_FOLDER: {
    id: 'smart_folder',
    name: '智能文件夹',
    description: '基于规则自动整理的虚拟文件夹',
    category: FEATURE_CATEGORIES.EXPERIMENTAL,
    defaultEnabled: false,
    icon: '🗂️'
  },

  RETENTION_SCORE: {
    id: 'retention_score',
    name: '留存评分',
    description: 'AI 评估文件重要性并给出建议',
    category: FEATURE_CATEGORIES.EXPERIMENTAL,
    defaultEnabled: false,
    icon: '⭐',
    requiresModel: 'LLM'
  },

  AI_MERGE_SUGGEST: {
    id: 'ai_merge_suggest',
    name: 'AI 合并建议',
    description: '智能建议文件合并方案',
    category: FEATURE_CATEGORIES.EXPERIMENTAL,
    defaultEnabled: false,
    icon: '🔀',
    requiresModel: 'LLM'
  },

  // 测试功能
  RLHF_FEEDBACK: {
    id: 'rlhf_feedback',
    name: 'RLHF 反馈',
    description: '通过反馈改进 AI 推荐质量',
    category: FEATURE_CATEGORIES.BETA,
    defaultEnabled: false,
    icon: '👍'
  },

  BATCH_SCRIPT: {
    id: 'batch_script',
    name: '批量脚本',
    description: '自定义批量处理脚本',
    category: FEATURE_CATEGORIES.BETA,
    defaultEnabled: false,
    icon: '⚡'
  }
};

class FeatureFlags extends EventEmitter {
  constructor() {
    super();
    this.settings = this._loadSettings();
    this._ensureDefaults();
  }

  /**
   * 获取设置文件路径
   */
  _getSettingsPath() {
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'feature-flags.json');
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    return path.join(homeDir, '.smart-file-organizer', 'feature-flags.json');
  }

  /**
   * 加载设置
   */
  _loadSettings() {
    const settingsPath = this._getSettingsPath();
    try {
      if (fs.existsSync(settingsPath)) {
        const data = fs.readFileSync(settingsPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('[FeatureFlags] 加载设置失败:', err);
    }
    return {};
  }

  /**
   * 保存设置
   */
  _saveSettings() {
    const settingsPath = this._getSettingsPath();
    try {
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err) {
      console.error('[FeatureFlags] 保存设置失败:', err);
    }
  }

  /**
   * 确保默认值
   */
  _ensureDefaults() {
    for (const [key, feature] of Object.entries(FEATURES)) {
      if (this.settings[feature.id] === undefined) {
        this.settings[feature.id] = {
          enabled: feature.defaultEnabled,
          discovered: feature.category === FEATURE_CATEGORIES.BASIC
        };
      }
    }
    this._saveSettings();
  }

  /**
   * 检查功能是否启用
   */
  isEnabled(featureId) {
    return this.settings[featureId]?.enabled ?? false;
  }

  /**
   * 启用功能
   */
  enable(featureId) {
    if (!this.settings[featureId]) {
      this.settings[featureId] = {};
    }
    this.settings[featureId].enabled = true;
    this.settings[featureId].discovered = true;
    this._saveSettings();
    this.emit('feature-enabled', featureId);
    console.log(`[FeatureFlags] 功能已启用: ${featureId}`);
  }

  /**
   * 禁用功能
   */
  disable(featureId) {
    if (this.settings[featureId]) {
      this.settings[featureId].enabled = false;
      this._saveSettings();
      this.emit('feature-disabled', featureId);
      console.log(`[FeatureFlags] 功能已禁用: ${featureId}`);
    }
  }

  /**
   * 标记功能为已发现
   */
  discover(featureId) {
    if (!this.settings[featureId]) {
      this.settings[featureId] = {};
    }
    if (!this.settings[featureId].discovered) {
      this.settings[featureId].discovered = true;
      this._saveSettings();
      this.emit('feature-discovered', featureId);
    }
  }

  /**
   * 检查功能是否已发现
   */
  isDiscovered(featureId) {
    return this.settings[featureId]?.discovered ?? false;
  }

  /**
   * 获取功能列表
   */
  getFeatures(options = {}) {
    const { category = null, includeDisabled = false } = options;

    return Object.values(FEATURES).filter(feature => {
      if (category && feature.category !== category) return false;
      if (!includeDisabled && !this.isEnabled(feature.id)) return false;
      return true;
    });
  }

  /**
   * 获取功能分类列表
   */
  getFeaturesByCategory() {
    const result = {
      [FEATURE_CATEGORIES.BASIC]: [],
      [FEATURE_CATEGORIES.ADVANCED]: [],
      [FEATURE_CATEGORIES.EXPERIMENTAL]: [],
      [FEATURE_CATEGORIES.BETA]: []
    };

    for (const feature of Object.values(FEATURES)) {
      result[feature.category].push({
        ...feature,
        enabled: this.isEnabled(feature.id),
        discovered: this.isDiscovered(feature.id)
      });
    }

    return result;
  }

  /**
   * 获取功能详情
   */
  getFeature(featureId) {
    const feature = Object.values(FEATURES).find(f => f.id === featureId);
    if (!feature) return null;

    return {
      ...feature,
      enabled: this.isEnabled(featureId),
      discovered: this.isDiscovered(featureId)
    };
  }

  /**
   * 启用高级模式（解锁高级功能）
   */
  enableAdvancedMode() {
    this.settings.advancedMode = true;

    // 自动启用所有高级功能
    for (const feature of Object.values(FEATURES)) {
      if (feature.category === FEATURE_CATEGORIES.ADVANCED) {
        this.enable(feature.id);
      }
    }

    this._saveSettings();
    this.emit('advanced-mode-enabled');
    console.log('[FeatureFlags] 高级模式已启用');
  }

  /**
   * 启用实验室模式（解锁实验性功能）
   */
  enableLabMode() {
    this.enableAdvancedMode();
    this.settings.labMode = true;

    // 自动启用所有实验性功能
    for (const feature of Object.values(FEATURES)) {
      if (feature.category === FEATURE_CATEGORIES.EXPERIMENTAL) {
        this.enable(feature.id);
      }
    }

    this._saveSettings();
    this.emit('lab-mode-enabled');
    console.log('[FeatureFlags] 实验室模式已启用');
  }

  /**
   * 检查高级模式是否启用
   */
  isAdvancedMode() {
    return this.settings.advancedMode === true;
  }

  /**
   * 检查实验室模式是否启用
   */
  isLabMode() {
    return this.settings.labMode === true;
  }

  /**
   * 获取模式状态
   */
  getModeStatus() {
    return {
      advanced: this.isAdvancedMode(),
      lab: this.isLabMode()
    };
  }

  /**
   * 重置所有设置为默认
   */
  resetToDefaults() {
    this.settings = {};
    this._ensureDefaults();
    this.emit('settings-reset');
  }

  /**
   * 导出设置
   */
  exportSettings() {
    return JSON.stringify(this.settings, null, 2);
  }

  /**
   * 导入设置
   */
  importSettings(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      this.settings = { ...this.settings, ...imported };
      this._saveSettings();
      this.emit('settings-imported');
      return true;
    } catch (err) {
      console.error('[FeatureFlags] 导入设置失败:', err);
      return false;
    }
  }
}

// 单例模式
let instance = null;

function getFeatureFlags() {
  if (!instance) {
    instance = new FeatureFlags();
  }
  return instance;
}

module.exports = {
  FeatureFlags,
  getFeatureFlags,
  FEATURE_CATEGORIES,
  FEATURES
};
