/**
 * 测试模型下载链接可用性
 * 测试所有国内和国际镜像源的响应状态
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// 模型配置（与 download-help.html 保持一致）
const MODEL_CONFIGS = {
  EMBEDDING: {
    name: '文档向量化模型 (EMBEDDING)',
    mirrors: {
      modelscope: 'https://www.modelscope.cn/models/iic/bge-micro-v2/resolve/master/model.onnx',
      modelers: 'https://modelers.cn/models/BAAI/bge-micro-v2/resolve/main/model.onnx',
      huggingface: 'https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx'
    }
  },
  CLIP: {
    name: '图片理解模型 (CLIP)',
    mirrors: {
      modelscope: 'https://www.modelscope.cn/models/damo/cv_vit-base-patch32_image-multimodal-embedding/resolve/master/model.onnx',
      modelers: 'https://modelers.cn/models/openai/clip-vit-base-patch32/resolve/main/model.onnx',
      huggingface: 'https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx'
    }
  },
  LLM: {
    name: '语言模型 (LLM)',
    mirrors: {
      modelscope: 'https://www.modelscope.cn/models/qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf',
      modelers: 'https://modelers.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
      huggingface: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
    }
  }
};

// 测试 URL 响应
async function testUrl(url, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, { timeout }, (res) => {
      const duration = Date.now() - startTime;
      
      // 检查是否是重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({
          statusCode: res.statusCode,
          redirect: res.headers.location,
          duration,
          available: true
        });
      } else if (res.statusCode === 200) {
        // 获取文件大小
        const contentLength = res.headers['content-length'];
        const sizeMB = contentLength ? (parseInt(contentLength) / (1024 * 1024)).toFixed(2) : '未知';
        
        resolve({
          statusCode: res.statusCode,
          duration,
          size: sizeMB + ' MB',
          available: true
        });
      } else {
        resolve({
          statusCode: res.statusCode,
          duration,
          available: false
        });
      }
      
      // 终止响应，不下载完整文件
      res.destroy();
    });
    
    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      resolve({
        error: err.message,
        duration,
        available: false
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        error: '请求超时',
        duration: timeout,
        available: false
      });
    });
  });
}

// 主测试函数
async function runTests() {
  console.log('='.repeat(80));
  console.log('🔍 开始测试模型下载链接可用性');
  console.log('测试时间：', new Date().toLocaleString('zh-CN'));
  console.log('='.repeat(80));
  console.log();
  
  const results = {
    total: 0,
    success: 0,
    failed: 0,
    details: {}
  };
  
  for (const [modelKey, config] of Object.entries(MODEL_CONFIGS)) {
    console.log(`📦 ${config.name}`);
    console.log('-'.repeat(80));
    
    results.details[modelKey] = {};
    
    for (const [mirrorName, url] of Object.entries(config.mirrors)) {
      results.total++;
      
      const mirrorLabels = {
        modelscope: '🇨🇳 ModelScope（阿里云）',
        modelers: '🇨🇳 Modelers.cn（智谱 AI）',
        huggingface: '🌐 HuggingFace'
      };
      
      process.stdout.write(`  测试 ${mirrorLabels[mirrorName]}... `);
      
      const result = await testUrl(url);
      results.details[modelKey][mirrorName] = result;
      
      if (result.available) {
        results.success++;
        console.log(`✅ 可用 (${result.duration}ms)`);
        if (result.size) {
          console.log(`     文件大小：${result.size}`);
        }
        if (result.redirect) {
          console.log(`     重定向到：${result.redirect.substring(0, 60)}...`);
        }
      } else {
        results.failed++;
        console.log(`❌ 失败`);
        if (result.error) {
          console.log(`     错误：${result.error}`);
        } else if (result.statusCode) {
          console.log(`     HTTP 状态码：${result.statusCode}`);
        }
      }
    }
    
    console.log();
  }
  
  // 汇总统计
  console.log('='.repeat(80));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(80));
  console.log(`总测试数：${results.total}`);
  console.log(`✅ 可用：${results.success} (${((results.success/results.total)*100).toFixed(1)}%)`);
  console.log(`❌ 失败：${results.failed} (${((results.failed/results.total)*100).toFixed(1)}%)`);
  console.log();
  
  // 推荐建议
  console.log('💡 推荐建议：');
  console.log('-'.repeat(80));
  
  for (const [modelKey, config] of Object.entries(MODEL_CONFIGS)) {
    const details = results.details[modelKey];
    const availableMirrors = Object.entries(details)
      .filter(([_, result]) => result.available)
      .map(([name, _]) => name);
    
    if (availableMirrors.length > 0) {
      const recommended = availableMirrors[0];
      console.log(`${config.name}: 优先使用 ${recommended === 'modelscope' ? 'ModelScope（阿里云）' : recommended === 'modelers' ? 'Modelers.cn（智谱 AI）' : 'HuggingFace'}`);
    } else {
      console.log(`${config.name}: ⚠️ 所有镜像源都不可用`);
    }
  }
  
  console.log();
  console.log('='.repeat(80));
  
  return results;
}

// 运行测试
runTests()
  .then(results => {
    // 保存结果到文件
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, 'download-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`📄 详细报告已保存到：${reportPath}`);
    
    // 如果全部成功，退出码为 0，否则为 1
    process.exit(results.failed === 0 ? 0 : 1);
  })
  .catch(err => {
    console.error('测试过程出错:', err);
    process.exit(1);
  });
