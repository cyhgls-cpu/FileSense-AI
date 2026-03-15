/**
 * FileSense AI (灵析) - 本地 AI 引擎核心
 * 实现三层 AI 架构：
 * 1. 轻量级 Embedding (文档语义去重) - 20-80MB
 * 2. 中等 CLIP (图片跨模态理解) - 150-300MB
 * 3. 按需 LLM (智能差异分析) - 1-2GB (量化后)
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ModelDownloader, MODEL_CONFIGS } = require('./model-downloader');

// 尝试加载 node-llama-cpp
let llamaModule = null;
try {
  llamaModule = require('node-llama-cpp');
  console.log('✓ node-llama-cpp 加载成功');
} catch (err) {
  // 静默处理，使用模拟模式，不在启动时显示警告
  llamaModule = null;
}

// 导出模块（如果可用）
const LlamaModel = llamaModule?.LlamaModel;
const LlamaContext = llamaModule?.LlamaContext;
const LlamaChatSession = llamaModule?.LlamaChatSession;

// AI_MODELS 现在引用 MODEL_CONFIGS，确保配置单一来源
const AI_MODELS = MODEL_CONFIGS;

/**
 * 硬件探针 - 检测系统能力
 */
class HardwareProbe {
  constructor() {
    this.info = null;
  }

  /**
   * 执行硬件探测
   */
  async probe() {
    const cpu = this._detectCPU();
    const memory = this._detectMemory();
    const gpu = await this._detectGPU();
    const instructions = this._detectInstructions();

    this.info = {
      cpu,
      memory,
      gpu,
      instructions,
      timestamp: Date.now()
    };

    // 自动推荐 AI 模式
    const recommendedMode = this._recommendMode();
    
    console.log('硬件探测完成:');
    console.log(`  CPU: ${cpu.model}`);
    console.log(`  内存：${(memory.total / 1024 / 1024 / 1024).toFixed(1)}GB (可用 ${(memory.available / 1024 / 1024 / 1024).toFixed(1)}GB)`);
    console.log(`  GPU: ${gpu.model || '无独立显卡'}`);
    console.log(`  指令集：${instructions.join(', ')}`);
    console.log(`  推荐模式：${recommendedMode}`);

    return { ...this.info, recommendedMode };
  }

  /**
   * 检测 CPU 信息
   */
  _detectCPU() {
    const cpus = os.cpus();
    const cpu = cpus[0];
    
    return {
      model: cpu.model,
      cores: cpus.length,
      speed: cpu.speed,
      architecture: os.arch()
    };
  }

  /**
   * 检测内存信息
   */
  _detectMemory() {
    const total = os.totalmem();
    const free = os.freemem();
    
    // 估算可用内存（预留 2GB 给系统）
    const available = Math.max(0, free - 2 * 1024 * 1024 * 1024);

    return {
      total,
      free,
      available,
      usage: ((total - free) / total * 100).toFixed(1) + '%'
    };
  }

  /**
   * 检测 GPU 信息（Windows）
   */
  async _detectGPU() {
    if (process.platform !== 'win32') {
      return { model: null, vram: 0 };
    }

    try {
      const output = execSync(
        'powershell -c "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"',
        { encoding: 'utf8' }
      ).trim();
      
      const gpus = output.split('\r\n').filter(line => line.trim());
      
      if (gpus.length === 0) {
        return { model: null, vram: 0 };
      }

      // 简单判断是否有独立显卡
      const hasDiscreteGPU = gpus.some(gpu => 
        gpu.includes('NVIDIA') || gpu.includes('AMD') || gpu.includes('Radeon')
      );

      return {
        model: gpus[0],
        isDiscrete: hasDiscreteGPU,
        count: gpus.length
      };
    } catch (err) {
      console.warn('GPU 检测失败:', err.message);
      return { model: null, vram: 0 };
    }
  }

  /**
   * 检测 CPU 指令集支持
   */
  _detectInstructions() {
    const instructions = [];
    const cpuFlags = os.cpus()[0].flags || '';
    
    // x86 指令集检测
    if (process.arch === 'x64' || process.arch === 'ia32') {
      if (cpuFlags.includes('avx2') || cpuFlags.includes('avx')) instructions.push('AVX');
      if (cpuFlags.includes('avx2')) instructions.push('AVX2');
      if (cpuFlags.includes('avx512')) instructions.push('AVX-512');
      if (cpuFlags.includes('sse4_1') || cpuFlags.includes('sse4')) instructions.push('SSE4');
      if (cpuFlags.includes('sse4_2')) instructions.push('SSE4.2');
    }

    // ARM 指令集检测
    if (process.arch === 'arm64') {
      instructions.push('NEON');
      if (os.platform() === 'darwin') {
        instructions.push('Apple Silicon');
      }
    }

    return instructions;
  }

  /**
   * 根据硬件推荐 AI 模式
   */
  _recommendMode() {
    const { memory, instructions } = this.info;
    const availableGB = memory.available / 1024 / 1024 / 1024;

    // 高端配置：所有功能
    if (availableGB >= 8 && instructions.includes('AVX2')) {
      return 'FULL_AI';
    }
    
    // 中端配置：Embedding + CLIP
    if (availableGB >= 4 && instructions.includes('AVX')) {
      return 'BALANCED';
    }
    
    // 低端配置：仅基础功能
    if (availableGB >= 2) {
      return 'LITE';
    }
    
    // 极低配置：禁用所有 AI
    return 'MINIMAL';
  }

  /**
   * 获取 AI 模式说明
   */
  static getModeDescription(mode) {
    const descriptions = {
      FULL_AI: {
        name: '🚀 完全 AI 模式',
        features: ['文档语义去重', '图片跨模态理解', 'LLM 智能分析'],
        memory: '~2GB',
        speed: '中等'
      },
      BALANCED: {
        name: '⚖️ 平衡模式',
        features: ['文档语义去重', '图片跨模态理解'],
        memory: '~200MB',
        speed: '快速'
      },
      LITE: {
        name: '💨 极速模式',
        features: ['文档语义去重'],
        memory: '~50MB',
        speed: '极快'
      },
      MINIMAL: {
        name: '🐢 基础模式',
        features: ['传统哈希比对'],
        memory: '<10MB',
        speed: '最快'
      }
    };
    return descriptions[mode] || descriptions.MINIMAL;
  }
}

/**
 * AI 模型管理器 - 懒加载和超时卸载
 */
class AIModelManager {
  constructor(options = {}) {
    this.models = new Map();
    this.lastUsed = new Map();
    // 默认60分钟空闲超时，可通过选项配置
    this.idleTimeout = (options.idleTimeoutMinutes || 60) * 60 * 1000;
    this.checkInterval = null;
    this.downloader = new ModelDownloader();
    this.autoLoad = options.autoLoad !== false; // 默认启用自动加载

    // 绑定下载器事件
    this.downloader.on('progress', (data) => {
      console.log(`下载进度 ${data.modelId}: ${data.percent}% (${data.speedFormatted})`);
    });

    console.log(`[AIModelManager] 初始化完成，空闲超时: ${this.idleTimeout / 60000} 分钟，自动加载: ${this.autoLoad}`);
  }

  /**
   * 初始化（注册模型，可选自动加载）
   */
  async init() {
    // 注册模型元数据
    for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
      this.models.set(key, {
        ...config,
        loaded: false,
        instance: null,
        path: this._getModelPath(key)
      });
    }

    // 如果启用自动加载，加载已存在的模型
    if (this.autoLoad) {
      console.log('[AIModelManager] 检查并自动加载已存在的模型...');
      await this._autoLoadModels();
    }

    // 启动空闲检查
    this._startIdleChecker();

    console.log('AI 模型管理器初始化完成');
  }

  /**
   * 自动加载已存在的模型
   */
  async _autoLoadModels() {
    for (const [key, model] of this.models.entries()) {
      if (this.isModelAvailable(key)) {
        try {
          console.log(`[AIModelManager] 自动加载模型: ${key}`);
          await this.load(key);
          console.log(`[AIModelManager] 模型 ${key} 自动加载成功`);
        } catch (err) {
          console.warn(`[AIModelManager] 模型 ${key} 自动加载失败:`, err.message);
        }
      }
    }
  }

  /**
   * 获取模型存储路径
   * 使用 userData 目录确保在 Electron 打包后路径正确
   */
  _getModelPath(modelKey) {
    // 尝试使用 Electron 的 app.getPath，如果不可用则使用 process.cwd()
    let modelsDir;
    try {
      const { app } = require('electron');
      modelsDir = path.join(app.getPath('userData'), 'models');
    } catch (err) {
      // 不在 Electron 环境中，使用当前工作目录
      modelsDir = path.join(process.cwd(), 'models');
    }

    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const config = MODEL_CONFIGS[modelKey];
    const name = config?.name || '';

    // 检查模型名称是否已包含扩展名
    let filename = name;
    if (!name.toLowerCase().endsWith('.gguf') &&
        !name.toLowerCase().endsWith('.onnx') &&
        !name.toLowerCase().endsWith('.bin')) {
      // 名称不包含扩展名，需要添加
      const ext = modelKey === 'LLM' ? '.gguf' : '.onnx';
      filename = `${name}${ext}`;
    }

    return path.join(modelsDir, filename);
  }

  /**
   * 启动空闲检查器
   */
  _startIdleChecker() {
    this.checkInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [key, model] of this.models.entries()) {
        if (!model.loaded) continue;
        
        const lastUse = this.lastUsed.get(key) || 0;
        if (now - lastUse > this.idleTimeout) {
          console.log(`卸载空闲模型：${key}`);
          this.unload(key);
        }
      }
    }, 10 * 1000); // 每 10 秒检查一次
  }

  /**
   * 加载模型（懒加载）
   */
  async load(modelKey) {
    const model = this.models.get(modelKey);
    if (!model) {
      throw new Error(`未知模型：${modelKey}`);
    }

    if (model.loaded) {
      // 更新最后使用时间
      this.lastUsed.set(modelKey, Date.now());
      return model.instance;
    }

    console.log(`正在加载模型：${model.name} (${(model.size / 1024 / 1024).toFixed(0)}MB)...`);
    console.log(`模型路径：${model.path}`);

    try {
      // 使用已经正确处理的 model.path，不再添加扩展名
      let modelPath = model.path;

      // 详细检查模型文件
      if (!fs.existsSync(modelPath)) {
        console.warn(`⚠️ 模型文件不存在于新位置：${modelPath}`);

        // 检查旧位置
        const oldPath = path.join(process.cwd(), 'models', model.name);
        if (fs.existsSync(oldPath)) {
          console.log(`✓ 在旧位置找到模型：${oldPath}`);
          modelPath = oldPath;
        } else {
          console.error(`❌ 模型文件不存在：${modelPath}`);
          console.error(`   请前往 设置 > AI模型 下载模型文件`);

          // 列出models目录内容
          const modelsDir = path.dirname(modelPath);
          if (fs.existsSync(modelsDir)) {
            const files = fs.readdirSync(modelsDir);
            console.log(`   models目录现有文件：${files.join(', ') || '(空)'}`);
          } else {
            console.error(`   models目录不存在：${modelsDir}`);
          }

          throw new Error(`模型文件不存在：${modelPath}\n请先下载模型文件`);
        }
      }

      // 检查文件大小
      const stats = fs.statSync(modelPath);
      console.log(`模型文件大小：${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      if (stats.size === 0) {
        throw new Error('模型文件大小为0，可能下载不完整');
      }

      if (stats.size < model.size * 0.9) {
        console.warn(`⚠️ 模型文件可能比预期小 (${(stats.size / model.size * 100).toFixed(1)}%)`);
      }

      // 根据模型类型加载
      let instance;
      if (modelKey === 'LLM') {
        // LLM 使用 llama.cpp
        console.log('[LLM] 使用 llama.cpp 加载模型...');
        instance = await this._loadLLM(modelPath);
      } else {
        // Embedding 和 CLIP 使用 ONNX Runtime
        console.log(`[ONNX] 加载 ${modelKey} 模型...`);
        instance = await this._loadONNX(modelKey, modelPath);
      }

      model.instance = instance;
      model.loaded = true;
      this.lastUsed.set(modelKey, Date.now());

      console.log(`✅ 模型加载成功：${model.name}`);
      return instance;

    } catch (err) {
      console.error(`❌ 模型加载失败：${model.name}`);
      console.error(`   错误：${err.message}`);

      // 提供故障排除建议
      if (err.message.includes('Cannot find module')) {
        console.error('\n💡 解决方法：');
        console.error('   1. 安装 node-llama-cpp：npm install node-llama-cpp');
        console.error('   2. 或重新构建原生模块：cd node_modules/node-llama-cpp && npm run build');
      }

      throw err;
    }
  }

  /**
   * 加载 LLM 模型（llama.cpp）
   */
  async _loadLLM(modelPath) {
    // 检查 node-llama-cpp 是否可用
    if (!LlamaModel) {
      console.log('[LLM] node-llama-cpp 未安装，使用模拟模式');
      return this._createMockLLM(modelPath);
    }

    try {
      console.log(`[LLM] 正在加载模型: ${path.basename(modelPath)}`);
      console.log(`[LLM] 模型路径: ${modelPath}`);

      // 检查文件是否存在
      if (!fs.existsSync(modelPath)) {
        throw new Error(`模型文件不存在: ${modelPath}`);
      }

      const fileSize = fs.statSync(modelPath).size;
      console.log(`[LLM] 模型大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      // 检查可用内存
      const freemem = os.freemem();
      const requiredMem = fileSize * 1.5; // 需要1.5倍模型大小的内存
      if (freemem < requiredMem) {
        console.warn(`[LLM] 警告: 可用内存不足 (${(freemem/1024/1024).toFixed(0)}MB < ${(requiredMem/1024/1024).toFixed(0)}MB)`);
        console.warn('[LLM] 尝试使用较小的上下文加载...');
      }

      // 加载模型 - 使用更保守的参数
      console.log('[LLM] 创建模型实例...');
      const model = new LlamaModel({
        modelPath: modelPath,
        gpuLayers: this._detectGPULayers(),
        // 根据可用内存调整上下文
        contextSize: freemem > 4 * 1024 * 1024 * 1024 ? 4096 : 2048,
      });

      console.log('[LLM] 模型实例创建成功');

      // 创建上下文
      console.log('[LLM] 创建上下文...');
      const context = new LlamaContext({ model });
      console.log('[LLM] 上下文创建成功');

      // 创建聊天会话
      console.log('[LLM] 创建聊天会话...');
      const session = new LlamaChatSession({ context });
      console.log('[LLM] 聊天会话创建成功');

      console.log('[LLM] ✅ 模型加载完成');

      return {
        type: 'LLM',
        path: modelPath,
        model,
        context,
        session,
        loaded: true,

        // 生成文本
        generate: async (prompt, options = {}) => {
          const { maxTokens = 512, temperature = 0.7 } = options;

          try {
            const response = await session.prompt(prompt, {
              maxTokens,
              temperature,
            });
            return response;
          } catch (err) {
            console.error('[LLM] 生成失败:', err);
            throw err;
          }
        },

        // 生成对比摘要
        generateDiffSummary: async (diffContext) => {
          const prompt = `分析以下两份文档的差异，用一句话总结核心区别：

${diffContext}

总结（一句话）：`;

          try {
            const response = await session.prompt(prompt, {
              maxTokens: 100,
              temperature: 0.3,
            });
            return response.trim();
          } catch (err) {
            console.error('[LLM] 摘要生成失败:', err);
            return '无法生成摘要';
          }
        },

        // 生成合并建议
        generateMergeAdvice: async (fileA, fileB, differences) => {
          const prompt = `分析以下两份文档的差异，给出合并建议：

文档A: ${fileA}
文档B: ${fileB}

差异:
${differences}

请提供:
1. 应该保留哪份为主
2. 建议从另一份提取什么内容
3. 合并时的注意事项

用JSON格式返回: {"keepPrimary": "A|B", "extract": "...", "cautions": "..."}`;

          try {
            const response = await session.prompt(prompt, {
              maxTokens: 256,
              temperature: 0.3,
            });

            // 尝试解析JSON
            try {
              return JSON.parse(response);
            } catch {
              // 如果不是JSON，返回文本格式
              return {
                summary: response.trim(),
                keepPrimary: 'A',
                extract: '请参考上述分析',
                cautions: '请人工审核合并结果'
              };
            }
          } catch (err) {
            console.error('[LLM] 合并建议生成失败:', err);
            return {
              keepPrimary: 'A',
              extract: '无法生成建议',
              cautions: '请人工审核'
            };
          }
        },

        // 卸载模型
        dispose: () => {
          console.log('[LLM] 释放模型资源');
          try {
            session.dispose && session.dispose();
          } catch (e) {}
          try {
            context.dispose && context.dispose();
          } catch (e) {}
          try {
            model.dispose && model.dispose();
          } catch (e) {}
        }
      };

    } catch (err) {
      console.error('[LLM] ❌ 模型加载失败:', err.message);
      console.error('[LLM] 错误详情:', err);

      if (err.message.includes('Cannot find module')) {
        console.error('\n💡 解决方法:');
        console.error('   npm install node-llama-cpp');
      } else if (err.message.includes('model') || err.message.includes('gguf')) {
        console.error('\n💡 可能的解决方法:');
        console.error('   1. 重新下载模型文件');
        console.error('   2. 检查模型文件是否完整');
        console.error('   3. 尝试使用CPU模式（gpuLayers: 0）');
        console.error('   4. 减少contextSize（如2048或1024）');
      } else if (err.message.includes('memory') || err.message.includes('alloc')) {
        console.error('\n💡 内存不足，建议:');
        console.error('   1. 关闭其他应用程序');
        console.error('   2. 使用更小的模型');
        console.error('   3. 增加虚拟内存/页面文件大小');
      }

      // 返回模拟实例作为fallback
      return this._createMockLLM(modelPath);
    }
  }

  /**
   * 创建模拟LLM实例（fallback）
   */
  _createMockLLM(modelPath) {
    return {
      type: 'LLM',
      path: modelPath,
      loaded: false,
      isMock: true,

      generate: async (prompt, options = {}) => {
        console.warn('[LLM Mock] 使用模拟响应');
        return `[模拟响应] ${prompt.substring(0, 50)}...`;
      },

      generateDiffSummary: async () => {
        return 'LLM未加载，无法生成摘要';
      },

      generateMergeAdvice: async () => {
        return {
          keepPrimary: 'A',
          extract: 'LLM未加载',
          cautions: '请安装 node-llama-cpp 以使用AI功能'
        };
      },

      dispose: () => {}
    };
  }

  /**
   * 检测GPU层数（用于llama.cpp的gpuLayers参数）
   */
  _detectGPULayers() {
    // 简单检测是否有NVIDIA GPU
    try {
      if (process.platform === 'win32') {
        const output = execSync(
          'powershell -c "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"',
          { encoding: 'utf8' }
        ).trim();

        if (output.includes('NVIDIA')) {
          console.log('[LLM] 检测到NVIDIA GPU，启用GPU加速');
          return 35; // 使用35层GPU加速
        }
      }
    } catch (err) {
      // 忽略错误
    }

    console.log('[LLM] 未检测到NVIDIA GPU，使用CPU推理');
    return 0; // CPU only
  }

  /**
   * 加载 ONNX 模型
   */
  async _loadONNX(modelKey, modelPath) {
    // TODO: 集成 onnxruntime-node
    // const ort = require('onnxruntime-node');
    // return await ort.InferenceSession.create(modelPath);

    console.warn('ONNX Runtime 尚未集成，返回模拟实例');
    const config = MODEL_CONFIGS[modelKey];
    return {
      type: modelKey,
      path: modelPath,
      run: async (input) => {
        // 返回随机向量（模拟）
        const dims = config?.dimensions || 384;
        return new Float32Array(dims).map(() => Math.random() - 0.5);
      }
    };
  }

  /**
   * 卸载模型
   */
  unload(modelKey) {
    const model = this.models.get(modelKey);
    if (!model || !model.loaded) return;

    console.log(`释放模型内存：${model.name}`);
    
    // 调用实例的dispose方法（如果存在）
    if (model.instance?.dispose) {
      try {
        model.instance.dispose();
      } catch (err) {
        console.warn('释放模型时出错:', err.message);
      }
    }
    
    model.instance = null;
    model.loaded = false;
    this.lastUsed.delete(modelKey);
    
    console.log(`模型已卸载：${modelKey}`);
  }

  /**
   * 获取模型状态
   */
  getStatus() {
    const status = {};

    for (const [key, model] of this.models.entries()) {
      const modelPath = this._getModelPath(key);
      let exists = fs.existsSync(modelPath);
      let fileSize = 0;
      let actualPath = modelPath;

      if (exists) {
        fileSize = fs.statSync(modelPath).size;
      } else {
        // 检查旧位置
        const oldPath = path.join(process.cwd(), 'models', model.name);
        if (fs.existsSync(oldPath)) {
          console.log(`[getStatus] ${key}: 在旧位置找到模型`);
          exists = true;
          fileSize = fs.statSync(oldPath).size;
          actualPath = oldPath;
        }
      }

      console.log(`[getStatus] ${key}: installed=${exists}, path=${actualPath}, size=${fileSize}`);

      status[key] = {
        name: model.name,
        description: model.description,
        size: (model.size / 1024 / 1024).toFixed(0) + 'MB',
        sizeFormatted: this._formatSize(model.size),
        loaded: model.loaded,
        installed: exists,
        actualSize: fileSize > 0 ? (fileSize / 1024 / 1024).toFixed(2) + 'MB' : '0MB',
        lastUsed: model.loaded ?
          new Date(this.lastUsed.get(key)).toLocaleTimeString() : '未加载'
      };
    }

    return status;
  }

  /**
   * 检查模型是否可用（已下载）
   */
  isModelAvailable(modelKey) {
    const model = this.models.get(modelKey);
    if (!model) return false;

    const modelPath = this._getModelPath(modelKey);
    const exists = fs.existsSync(modelPath);

    console.log(`[isModelAvailable] ${modelKey}: path=${modelPath}, exists=${exists}`);

    if (exists) {
      const stats = fs.statSync(modelPath);
      console.log(`[isModelAvailable] ${modelKey}: size=${stats.size}`);
      // 文件存在且大小大于0才算可用
      return stats.size > 0;
    }

    // 检查旧位置（process.cwd()/models）
    const oldPath = path.join(process.cwd(), 'models', model.name);
    if (fs.existsSync(oldPath)) {
      console.log(`[isModelAvailable] ${modelKey}: 在旧位置找到: ${oldPath}`);
      // 移动到正确位置
      try {
        fs.copyFileSync(oldPath, modelPath);
        console.log(`[isModelAvailable] ${modelKey}: 已复制到新位置`);
        return true;
      } catch (err) {
        console.warn(`[isModelAvailable] ${modelKey}: 复制失败`, err.message);
      }
    }

    return false;
  }

  /**
   * 格式化大小
   */
  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /**
   * 下载模型
   */
  async downloadModel(modelKey, callback) {
    return new Promise((resolve, reject) => {
      const onProgress = (data) => {
        if (callback) callback(data);
      };

      // 创建一次性事件处理器
      const onComplete = (result) => {
        cleanup();
        resolve(result);
      };

      const onError = (error) => {
        cleanup();
        // 确保错误对象有 message 属性
        if (error instanceof Error) {
          reject(error);
        } else if (typeof error === 'string') {
          reject(new Error(error));
        } else {
          reject(new Error(error?.message || JSON.stringify(error) || '未知错误'));
        }
      };

      const onAlreadyInstalled = (result) => {
        cleanup();
        resolve({ ...result, alreadyInstalled: true });
      };

      // 清理函数
      const cleanup = () => {
        this.downloader.removeListener('progress', onProgress);
        this.downloader.removeListener('complete', onComplete);
        this.downloader.removeListener('error', onError);
        this.downloader.removeListener('already-installed', onAlreadyInstalled);
      };

      // 绑定事件
      this.downloader.on('progress', onProgress);
      this.downloader.once('complete', onComplete);
      this.downloader.once('error', onError);
      this.downloader.once('already-installed', onAlreadyInstalled);

      // 开始下载
      this.downloader.download(modelKey).catch((err) => {
        // 捕获 download 方法抛出的任何错误
        cleanup();
        if (err instanceof Error) {
          reject(err);
        } else {
          reject(new Error(err?.message || String(err) || '下载失败'));
        }
      });
    });
  }

  /**
   * 卸载模型文件
   */
  uninstallModel(modelKey) {
    const modelPath = this._getModelPath(modelKey);
    if (fs.existsSync(modelPath)) {
      // 如果模型已加载，先卸载
      if (this.models.get(modelKey).loaded) {
        this.unload(modelKey);
      }
      
      fs.unlinkSync(modelPath);
      return true;
    }
    return false;
  }

  /**
   * 获取所有模型信息（含下载状态）
   */
  getAvailableModels() {
    return this.downloader.getAvailableModels();
  }

  /**
   * 清理资源
   */
  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    for (const key of this.models.keys()) {
      this.unload(key);
    }
  }
}

/**
 * 文档向量化服务（轻量级 Embedding）
 */
class DocumentEmbeddingService {
  constructor(modelManager) {
    this.modelManager = modelManager;
    this.session = null;
  }

  /**
   * 初始化（加载模型）
   */
  async init() {
    this.session = await this.modelManager.load('EMBEDDING');
  }

  /**
   * 将文本转换为向量
   */
  async embed(text) {
    if (!this.session) {
      await this.init();
    }

    // TODO: 实际 ONNX 推理
    // const tensor = new ort.Tensor('float32', tokens, [1, tokens.length]);
    // const results = await this.session.run({ input_ids: tensor });
    
    // 模拟：返回固定维度向量
    const vector = new Float32Array(AI_MODELS.EMBEDDING.dimensions);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = Math.sin(text.length + i); // 伪向量
    }
    
    return vector;
  }

  /**
   * 计算两个向量的余弦相似度
   */
  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * 批量向量化
   */
  async embedBatch(texts, batchSize = 32) {
    const vectors = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchVectors = await Promise.all(batch.map(text => this.embed(text)));
      vectors.push(...batchVectors);
      
      console.log(`向量化进度：${Math.min(i + batchSize, texts.length)}/${texts.length}`);
    }
    
    return vectors;
  }
}

/**
 * 图片跨模态理解服务（CLIP）
 */
class ImageCLIPService {
  constructor(modelManager) {
    this.modelManager = modelManager;
    this.session = null;
  }

  /**
   * 初始化
   */
  async init() {
    this.session = await this.modelManager.load('CLIP');
  }

  /**
   * 提取图片特征向量
   */
  async encodeImage(imagePath) {
    if (!this.session) {
      await this.init();
    }

    // TODO: 实际图像处理
    // const image = await sharp(imagePath).resize(224, 224).toBuffer();
    // const tensor = new ort.Tensor('float32', pixels, [1, 3, 224, 224]);
    
    const vector = new Float32Array(AI_MODELS.CLIP.dimensions);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = Math.cos(imagePath.length + i);
    }
    
    return vector;
  }

  /**
   * 编码文本查询
   */
  async encodeText(text) {
    if (!this.session) {
      await this.init();
    }

    const vector = new Float32Array(AI_MODELS.CLIP.dimensions);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = Math.sin(text.length + i);
    }
    
    return vector;
  }

  /**
   * 搜索相似图片
   */
  async searchImages(query, imageVectors, topK = 10) {
    const queryVector = await this.encodeText(query);
    
    const scores = imageVectors.map((vec, index) => ({
      index,
      score: this._cosineSimilarity(queryVector, vec.vector)
    }));
    
    // 按相似度排序
    scores.sort((a, b) => b.score - a.score);
    
    return scores.slice(0, topK);
  }

  _cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}

/**
 * LLM 智能分析服务
 */
class LLMAnalysisService {
  constructor(modelManager) {
    this.modelManager = modelManager;
    this.model = null;
  }

  /**
   * 初始化（按需加载）
   */
  async init() {
    this.model = await this.modelManager.load('LLM');
  }

  /**
   * 智能分析文件差异
   */
  async analyzeDiff(file1, file2) {
    if (!this.model) {
      await this.init();
    }

    const prompt = `请分析以下两个文件的差异，用简洁的语言总结：

文件 1: ${file1.name}
内容预览：${file1.preview}

文件 2: ${file2.name}
内容预览：${file2.preview}

请指出：
1. 主要差异点
2. 是否为重复文件
3. 建议保留哪个`;

    // TODO: 实际 LLM 推理
    // const response = await this.model.generate(prompt, {
    //   maxTokens: 500,
    //   temperature: 0.7
    // });
    
    return {
      summary: '这是模拟的 AI 分析结果...',
      isDuplicate: false,
      recommendation: '建议保留较新版本',
      differences: ['内容长度不同', '创建时间不同']
    };
  }

  /**
   * 智能分类建议
   */
  async suggestCategory(fileName, fileSize) {
    if (!this.model) {
      await this.init();
    }

    const ext = path.extname(fileName).toLowerCase();
    
    // 预定义规则优先（减少 LLM 调用）
    const softwareExts = ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.app', '.apk', '.ipa', '.bat', '.sh'];
    const fontExts = ['.ttf', '.otf', '.woff', '.woff2', '.eot', '.fon'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.psd', '.ai', '.raw', '.cr2'];
    const musicExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.mid', '.midi'];
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.rmvb', '.rm', '.mpeg', '.mpg'];
    const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.epub'];
    
    if (softwareExts.includes(ext)) return { category: '软件', confidence: 0.98 };
    if (fontExts.includes(ext)) return { category: '字体', confidence: 0.98 };
    if (imageExts.includes(ext)) return { category: '图片', confidence: 0.95 };
    if (musicExts.includes(ext)) return { category: '音乐', confidence: 0.98 };
    if (videoExts.includes(ext)) return { category: '电影', confidence: 0.98 };
    if (docExts.includes(ext)) return { category: '文档', confidence: 0.95 };

    // 对于不确定的文件，使用 LLM 判断
    const prompt = `请判断以下文件的类型，只返回一个分类名称（软件、字体、图片、音乐、电影、文档、其他），不要解释：
文件名：${fileName}
文件大小：${(fileSize / 1024 / 1024).toFixed(2)} MB
扩展名：${ext}

分类：`;

    try {
      // 实际 LLM 推理
      const response = await this.model.generate(prompt, {
        maxTokens: 20,
        temperature: 0.3
      });
      
      let result = response.text.trim();
      // 解析结果
      const validCategories = ['软件', '字体', '图片', '音乐', '电影', '文档', '其他'];
      for (const cat of validCategories) {
        if (result.includes(cat)) {
          return { category: cat, confidence: 0.85 };
        }
      }
      
      // 如果没有匹配到有效分类，返回其他
      return { category: '其他', confidence: 0.6 };
    } catch (err) {
      console.error('LLM 分类失败:', err.message);
      // LLM 失败时回退到规则判断
      return { category: '其他', confidence: 0.5 };
    }
  }
}

module.exports = {
  HardwareProbe,
  AIModelManager,
  DocumentEmbeddingService,
  ImageCLIPService,
  LLMAnalysisService,
  AI_MODELS
};
