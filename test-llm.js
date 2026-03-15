/**
 * LLM模型加载诊断脚本
 * 用于排查Qwen2.5-1.5B加载问题
 */

const fs = require('fs');
const path = require('path');

console.log('=== LLM模型加载诊断 ===\n');

// 1. 检查node-llama-cpp是否安装
console.log('1. 检查 node-llama-cpp 安装状态...');
try {
  const llama = require('node-llama-cpp');
  console.log('   ✅ node-llama-cpp 已安装');
  console.log('   版本:', require('./node_modules/node-llama-cpp/package.json').version);
} catch (err) {
  console.log('   ❌ node-llama-cpp 未安装');
  console.log('   安装命令: npm install node-llama-cpp');
  process.exit(1);
}

// 2. 检查模型文件
console.log('\n2. 检查模型文件...');
const modelsDir = path.join(process.cwd(), 'models');
const modelPath = path.join(modelsDir, 'qwen2.5-1.5b-instruct-q4_k_m.gguf');

console.log('   模型目录:', modelsDir);
console.log('   模型路径:', modelPath);

if (!fs.existsSync(modelsDir)) {
  console.log('   ❌ models目录不存在');
  fs.mkdirSync(modelsDir, { recursive: true });
  console.log('   ✅ 已创建models目录');
} else {
  console.log('   ✅ models目录存在');
}

if (!fs.existsSync(modelPath)) {
  console.log('   ❌ 模型文件不存在');
  console.log('   请前往 设置 > AI模型 下载Qwen2.5-1.5B模型');
} else {
  const stats = fs.statSync(modelPath);
  const sizeMB = stats.size / 1024 / 1024;
  console.log('   ✅ 模型文件存在');
  console.log('   文件大小:', sizeMB.toFixed(2), 'MB');

  if (stats.size === 0) {
    console.log('   ❌ 文件大小为0，文件损坏');
  } else if (sizeMB < 900) {
    console.log('   ⚠️ 文件大小异常，可能下载不完整（预期约986MB）');
  } else {
    console.log('   ✅ 文件大小正常');
  }
}

// 3. 列出models目录所有文件
console.log('\n3. models目录内容:');
if (fs.existsSync(modelsDir)) {
  const files = fs.readdirSync(modelsDir);
  if (files.length === 0) {
    console.log('   (空目录)');
  } else {
    files.forEach(f => {
      const fpath = path.join(modelsDir, f);
      const stats = fs.statSync(fpath);
      const sizeMB = stats.size / 1024 / 1024;
      console.log(`   - ${f} (${sizeMB.toFixed(2)} MB)`);
    });
  }
} else {
  console.log('   (目录不存在)');
}

// 4. 测试加载模型
console.log('\n4. 测试加载模型...');
async function testLoad() {
  try {
    const { LlamaModel, LlamaContext, LlamaChatSession } = require('node-llama-cpp');

    console.log('   正在加载模型...');
    console.time('   加载耗时');

    const model = new LlamaModel({
      modelPath: modelPath,
      gpuLayers: 0, // CPU模式，兼容性最好
      contextSize: 2048, // 较小的上下文以节省内存
    });

    console.timeEnd('   加载耗时');
    console.log('   ✅ 模型加载成功');

    // 创建上下文
    console.log('   创建上下文...');
    const context = new LlamaContext({ model });

    // 创建会话
    console.log('   创建聊天会话...');
    const session = new LlamaChatSession({ context });

    // 测试生成
    console.log('   测试生成...');
    const response = await session.prompt('你好', {
      maxTokens: 50,
      temperature: 0.7,
    });

    console.log('   ✅ 生成测试成功');
    console.log('   响应:', response.substring(0, 100));

    // 清理
    session.dispose();
    context.dispose();
    model.dispose();

    console.log('\n✅ 所有测试通过！模型可以正常使用');

  } catch (err) {
    console.log('   ❌ 加载失败:', err.message);
    console.log('\n错误详情:', err);

    if (err.message.includes('Cannot find module')) {
      console.log('\n💡 解决方法:');
      console.log('   npm install node-llama-cpp');
    } else if (err.message.includes('model')) {
      console.log('\n💡 可能的解决方法:');
      console.log('   1. 重新下载模型文件');
      console.log('   2. 检查模型文件是否完整');
      console.log('   3. 尝试使用CPU模式（gpuLayers: 0）');
    }
  }
}

// 5. 系统信息
console.log('\n5. 系统信息:');
const os = require('os');
console.log('   平台:', process.platform);
console.log('   架构:', process.arch);
console.log('   Node版本:', process.version);
console.log('   CPU核心:', os.cpus().length);
console.log('   总内存:', (os.totalmem() / 1024 / 1024 / 1024).toFixed(2), 'GB');
console.log('   可用内存:', (os.freemem() / 1024 / 1024 / 1024).toFixed(2), 'GB');

// 运行测试
testLoad().then(() => {
  console.log('\n=== 诊断完成 ===');
}).catch(err => {
  console.log('\n=== 诊断出错 ===');
  console.error(err);
});
