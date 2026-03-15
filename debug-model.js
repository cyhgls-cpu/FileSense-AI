/**
 * 模型加载调试脚本
 */

const path = require('path');
const fs = require('fs');

console.log('=== 模型加载调试 ===\n');

// 1. 检查models目录
const modelsDir = path.join(process.cwd(), 'models');
console.log('1. Models目录:', modelsDir);
console.log('   存在:', fs.existsSync(modelsDir));

if (fs.existsSync(modelsDir)) {
  const files = fs.readdirSync(modelsDir);
  console.log('   文件列表:');
  files.forEach(f => {
    const fpath = path.join(modelsDir, f);
    const stats = fs.statSync(fpath);
    console.log(`     - ${f} (${(stats.size/1024/1024).toFixed(2)} MB)`);
  });
}

// 2. 检查MODEL_CONFIGS
console.log('\n2. 模型配置:');
const { MODEL_CONFIGS } = require('./src/model-downloader');
for (const [key, config] of Object.entries(MODEL_CONFIGS)) {
  const modelPath = path.join(modelsDir, config.name);
  const exists = fs.existsSync(modelPath);
  console.log(`   ${key}:`);
  console.log(`     名称: ${config.name}`);
  console.log(`     路径: ${modelPath}`);
  console.log(`     存在: ${exists}`);
  if (exists) {
    const size = fs.statSync(modelPath).size;
    console.log(`     大小: ${(size/1024/1024).toFixed(2)} MB`);
  }
}

// 3. 测试AI引擎
console.log('\n3. 测试AI引擎:');

try {
  const aiModule = require('./src/ai-engine');
  console.log('   ✓ ai-engine 加载成功');
  
  const manager = new aiModule.AIModelManager();
  manager.init();
  console.log('   ✓ 管理器初始化成功');
  
  const status = manager.getStatus();
  console.log('   状态:', JSON.stringify(status, null, 2));
  
  // 尝试加载LLM
  console.log('\n4. 尝试加载LLM:');
  manager.load('LLM').then(llm => {
    console.log('   ✓ LLM加载成功');
    console.log('   类型:', llm.type);
    console.log('   已加载:', llm.loaded);
    console.log('   是否模拟:', llm.isMock || false);
    
    const newStatus = manager.getStatus();
    console.log('\n   新状态:', JSON.stringify(newStatus.LLM, null, 2));
    
    // 卸载
    console.log('\n5. 卸载LLM:');
    manager.unload('LLM');
    const finalStatus = manager.getStatus();
    console.log('   最终状态:', JSON.stringify(finalStatus.LLM, null, 2));
    
  }).catch(err => {
    console.error('   ✗ LLM加载失败:', err.message);
  });
  
} catch (err) {
  console.error('   ✗ ai-engine 加载失败:', err.message);
  
  // 尝试简化版
  console.log('\n   尝试简化版...');
  try {
    const simpleModule = require('./src/ai-engine-simple');
    console.log('   ✓ ai-engine-simple 加载成功');
    
    const manager = new simpleModule.SimpleAIModelManager();
    manager.init();
    console.log('   ✓ 简化管理器初始化成功');
    
    const status = manager.getStatus();
    console.log('   状态:', JSON.stringify(status, null, 2));
  } catch (err2) {
    console.error('   ✗ 简化版也失败:', err2.message);
  }
}
