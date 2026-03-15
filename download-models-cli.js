/**
 * 模型下载助手 - 命令行工具
 * 用于手动下载 AI 模型文件
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 模型配置
const MODELS = [
  {
    id: 'EMBEDDING',
    name: 'bge-micro-v2.onnx',
    url: 'https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx',
    size: '22MB',
    description: '文档向量化模型'
  },
  {
    id: 'CLIP',
    name: 'clip-vit-b-32.onnx',
    url: 'https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx',
    size: '150MB',
    description: '图片理解模型'
  },
  {
    id: 'LLM',
    name: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    size: '1.1GB',
    description: '语言模型'
  }
];

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function downloadModel(model, index) {
  return new Promise((resolve, reject) => {
    const modelsDir = path.join(process.cwd(), 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
      console.log('✓ 创建 models 文件夹');
    }
    
    const filePath = path.join(modelsDir, model.name);
    
    // 检查是否已存在
    if (fs.existsSync(filePath)) {
      console.log(`\n⚠️  ${model.name} 已存在，跳过下载`);
      resolve();
      return;
    }
    
    console.log(`\n[${index + 1}/${MODELS.length}] 下载 ${model.description}`);
    console.log(`    文件名：${model.name}`);
    console.log(`    大小：${model.size}`);
    console.log(`    URL: ${model.url}`);
    
    let downloadedBytes = 0;
    let totalBytes = 0;
    let startTime = Date.now();
    
    const protocol = model.url.startsWith('https') ? https : http;
    
    const request = protocol.get(model.url, {
      redirect: 'follow',
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      // 处理重定向
      if ([301, 302, 307].includes(response.statusCode)) {
        const location = response.headers.location;
        console.log(`    ↪️  重定向到：${location.substring(0, 80)}...`);
        request.destroy();
        downloadModel(model, index).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode === 200) {
        totalBytes = parseInt(response.headers['content-length']) || 0;
      } else {
        reject(new Error(`HTTP 错误：${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        
        const progress = totalBytes > 0 ? (downloadedBytes / totalBytes * 100) : 0;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = downloadedBytes / elapsed;
        
        // 每 5% 显示一次进度
        if (Math.floor(progress) % 5 === 0 && Math.floor(progress) > Math.floor(progress - (chunk.length / totalBytes * 100))) {
          process.stdout.write(`\r    进度：${progress.toFixed(1)}% | ${formatSize(speed)}/s`);
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\n    ✅ 下载完成！`);
        resolve();
      });
      
      fileStream.on('error', (err) => {
        console.error('\n    ❌ 文件写入错误:', err.message);
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
    
    request.on('error', (err) => {
      console.error('\n    ❌ 下载失败:', err.message);
      reject(err);
    });
    
    request.setTimeout(120000, () => {
      request.destroy();
      reject(new Error('下载超时（120 秒）'));
    });
  });
}

async function main() {
  console.log('🚀 AI 模型下载助手\n');
  console.log('可用模型:');
  MODELS.forEach((model, index) => {
    console.log(`  ${index + 1}. ${model.description} (${model.name}) - ${model.size}`);
  });
  console.log('\n开始下载...\n');
  
  try {
    for (let i = 0; i < MODELS.length; i++) {
      await downloadModel(MODELS[i], i);
    }
    
    console.log('\n✅ 所有模型下载完成！');
    console.log('\n提示：');
    console.log('  - 文件已保存到：' + path.join(process.cwd(), 'models'));
    console.log('  - 重启应用后即可使用下载的模型');
    console.log('  - 如果下载失败，请检查网络连接或尝试使用代理\n');
  } catch (err) {
    console.error('\n❌ 下载过程中出现错误:', err.message);
    console.error('\n建议:');
    console.error('  1. 检查网络连接');
    console.error('  2. 如果使用公司网络，可能需要配置代理');
    console.error('  3. 可以手动访问 HuggingFace 下载模型文件');
    console.error('  4. 查看 MODEL_DOWNLOAD_GUIDE.md 获取更多下载方式\n');
    process.exit(1);
  }
}

main();
