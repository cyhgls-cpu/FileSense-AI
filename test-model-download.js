/**
 * 快速模型下载测试工具
 * 用于诊断下载问题
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function testDownload(url, filename) {
  console.log(`\n测试下载：${filename}`);
  console.log(`URL: ${url}`);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    let downloadedBytes = 0;
    let totalBytes = 0;
    let startTime = Date.now();
    
    const request = protocol.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        console.log(`↪️  重定向：${response.headers.location}`);
        testDownload(response.headers.location, filename).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP 错误：${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      totalBytes = parseInt(response.headers['content-length']) || 0;
      console.log(`✓ 连接成功，文件大小：${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
      
      const filePath = path.join(__dirname, 'models', filename);
      const fileStream = fs.createWriteStream(filePath);
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const progress = totalBytes > 0 ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : 0;
        const speed = downloadedBytes / ((Date.now() - startTime) / 1000);
        
        if (Math.floor(progress) % 10 === 0) {
          process.stdout.write(`\r进度：${progress}% | ${(speed / 1024).toFixed(1)}KB/s`);
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`\n✅ 下载完成：${filePath}`);
        resolve(filePath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
    
    request.on('error', (err) => {
      reject(err);
    });
    
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('下载超时（10 秒）'));
    });
  });
}

async function main() {
  console.log('🔍 模型下载测试工具\n');
  console.log('正在测试 HuggingFace 连接...\n');
  
  // 创建 models 目录
  const modelsDir = path.join(__dirname, 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  
  try {
    // 测试下载最小的模型
    await testDownload(
      'https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx',
      'bge-micro-v2.onnx'
    );
    
    console.log('\n✅ 测试成功！模型已下载到 models 文件夹');
    console.log('\n提示：');
    console.log('  - 重启应用即可使用已下载的模型');
    console.log('  - 如果下载失败，请检查网络连接或使用代理\n');
  } catch (err) {
    console.error('\n❌ 下载失败:', err.message);
    console.error('\n可能的原因:');
    console.error('  1. 无法访问 HuggingFace（需要网络或代理）');
    console.error('  2. 防火墙阻止了下载');
    console.error('  3. 磁盘空间不足');
    console.error('\n建议:');
    console.error('  - 手动下载模型文件并放到 models 文件夹');
    console.error('  - 查看 MODEL_DOWNLOAD_GUIDE.md 获取详细帮助\n');
    process.exit(1);
  }
}

main();
