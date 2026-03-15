# Qwen2.5-1.5B LLM 使用指南

## 安装依赖

```bash
npm install node-llama-cpp
```

## 下载模型

### 自动下载
在应用内 设置 > AI模型 页面点击下载。

### 手动下载
如果自动下载失败，可以手动下载：

1. 访问 https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF
2. 下载 `qwen2.5-1.5b-instruct-q4_k_m.gguf` 文件
3. 将文件放入项目根目录的 `models/` 文件夹

## 验证安装

运行诊断脚本：
```bash
node test-llm.js
```

## 使用示例

```javascript
const { AIModelManager } = require('./src/ai-engine');

const manager = new AIModelManager();
manager.init();

// 加载LLM模型
const llm = await manager.load('LLM');

// 生成文本
const response = await llm.generate('你好，请介绍一下自己', {
  maxTokens: 100,
  temperature: 0.7
});
console.log(response);

// 生成差异摘要
const summary = await llm.generateDiffSummary(`
文档A: 合同v1.txt
文档B: 合同v2.txt
差异: 增加了违约金条款
`);
console.log(summary);

// 卸载模型
manager.unload('LLM');
```

## 故障排除

### "node-llama-cpp 未安装"
```bash
npm install node-llama-cpp
```

### "模型文件不存在"
- 检查 `models/qwen2.5-1.5b-instruct-q4_k_m.gguf` 是否存在
- 运行 `node test-llm.js` 诊断

### "内存不足"
- 关闭其他应用程序
- 在 `ai-engine.js` 中减小 `contextSize`（如改为 2048 或 1024）
- 增加系统虚拟内存

### 加载缓慢或卡顿
- 首次加载需要几分钟，请耐心等待
- 模型加载后会缓存，后续使用更快
- 考虑使用SSD存储模型文件

## 系统要求

- **内存**: 至少 4GB 可用内存
- **存储**: 1GB 空间用于模型文件
- **CPU**: 支持 AVX2 的现代处理器
- **可选**: NVIDIA GPU 可加速推理

## 模型信息

- **模型**: Qwen2.5-1.5B-Instruct
- **量化**: Q4_K_M (4-bit)
- **大小**: ~986MB
- **上下文**: 最大 4096 tokens
- **语言**: 中文、英文
