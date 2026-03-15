/**
 * 简化的AI引擎 - 不依赖node-llama-cpp
 * 用于在没有原生模块时的降级方案
 */

const fs = require('fs');
const path = require('path');
const { ModelDownloader, MODEL_CONFIGS } = require('./model-downloader');

// 尝试加载 node-llama-cpp
let llamaCppAvailable = false;
try {
  require('node-llama-cpp');
  llamaCppAvailable = true;
  console.log('[AI] ✓ node-llama-cpp 加载成功');
} catch (err) {
  // 静默处理，使用模拟模式
  llamaCppAvailable = false;
}

/**
 * 简化的AI模型管理器
 */
class SimpleAIModelManager {
  constructor() {
    this.models = new Map();
    this.downloader = new ModelDownloader();
  }

  init() {
    // 注册模型元数据
    for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
      this.models.set(key, {
        ...config,
        loaded: false,
        instance: null,
        path: this._getModelPath(key)
      });
    }
    console.log('[AI] 简化模式初始化完成');
  }

  async load(modelKey) {
    const model = this.models.get(modelKey);
    if (!model) {
      throw new Error(`未知模型：${modelKey}`);
    }

    if (model.loaded) {
      return model.instance;
    }

    console.log(`[AI] 加载模型：${model.name}`);

    // 检查文件是否存在
    if (!fs.existsSync(model.path)) {
      throw new Error(`模型文件不存在：${model.path}\n请先下载模型`);
    }

    // 如果是LLM且node-llama-cpp不可用，返回模拟实例
    if (modelKey === 'LLM' && !llamaCppAvailable) {
      console.warn('[AI] LLM使用模拟模式（node-llama-cpp未安装）');
      model.instance = this._createMockLLM(model.path);
      model.loaded = true;
      return model.instance;
    }

    // 否则尝试加载真实模型
    if (modelKey === 'LLM') {
      const { LlamaModel, LlamaContext, LlamaChatSession } = require('node-llama-cpp');
      
      try {
        const llmModel = new LlamaModel({
          modelPath: model.path,
          gpuLayers: 0,
          contextSize: 2048,
        });
        
        const context = new LlamaContext({ model: llmModel });
        const session = new LlamaChatSession({ context });

        model.instance = {
          type: 'LLM',
          loaded: true,
          generate: async (prompt, options = {}) => {
            return await session.prompt(prompt, {
              maxTokens: options.maxTokens || 512,
              temperature: options.temperature || 0.7,
            });
          },
          generateDiffSummary: async (diffContext) => {
            const prompt = `分析以下差异，用一句话总结：\n\n${diffContext}\n\n总结：`;
            const response = await session.prompt(prompt, {
              maxTokens: 100,
              temperature: 0.3,
            });
            return response.trim();
          },
          dispose: () => {
            session.dispose?.();
            context.dispose?.();
            llmModel.dispose?.();
          }
        };
        
        model.loaded = true;
        console.log('[AI] LLM加载成功');
        return model.instance;
        
      } catch (err) {
        console.error('[AI] LLM加载失败，使用模拟模式:', err.message);
        model.instance = this._createMockLLM(model.path);
        model.loaded = true;
        return model.instance;
      }
    }

    // ONNX模型（简化版）
    model.instance = {
      type: modelKey,
      loaded: true,
      run: async (input) => {
        // 返回随机向量作为模拟
        const dims = model.dimensions || 384;
        return new Float32Array(dims).map(() => Math.random() - 0.5);
      }
    };
    model.loaded = true;
    return model.instance;
  }

  _createMockLLM(modelPath) {
    return {
      type: 'LLM',
      loaded: false,
      isMock: true,
      generate: async (prompt, options = {}) => {
        console.warn('[AI Mock] 使用模拟响应');
        return `[模拟响应] ${prompt.substring(0, 50)}...`;
      },
      generateDiffSummary: async () => {
        return 'LLM未安装，无法生成摘要。请运行: npm install node-llama-cpp';
      },
      dispose: () => {}
    };
  }

  _getModelPath(modelKey) {
    const modelsDir = path.join(process.cwd(), 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const config = MODEL_CONFIGS[modelKey];
    const name = config?.name || '';
    return path.join(modelsDir, name);
  }

  getStatus() {
    const status = {};
    for (const [key, model] of this.models.entries()) {
      const exists = fs.existsSync(model.path);
      let fileSize = 0;
      if (exists) {
        try {
          fileSize = fs.statSync(model.path).size;
        } catch (e) {}
      }
      
      status[key] = {
        name: model.name,
        description: model.description,
        size: (model.size / 1024 / 1024).toFixed(0) + 'MB',
        loaded: model.loaded,
        installed: exists,
        isMock: model.instance?.isMock || false,
        actualSize: fileSize > 0 ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : '0MB',
      };
    }
    return status;
  }

  unload(modelKey) {
    const model = this.models.get(modelKey);
    if (model?.instance?.dispose) {
      model.instance.dispose();
    }
    if (model) {
      model.loaded = false;
      model.instance = null;
    }
  }
}

module.exports = { SimpleAIModelManager, llamaCppAvailable };
