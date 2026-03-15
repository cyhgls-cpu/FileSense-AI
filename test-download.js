const { ModelDownloader } = require('./src/model-downloader');

async function testDownload() {
  console.log('开始测试模型下载...\n');
  
  const downloader = new ModelDownloader();
  
  // 监听事件
  downloader.on('start', (data) => {
    console.log(`✓ 开始下载：${data.modelId}`);
    console.log(`  镜像源：${data.mirror}`);
    console.log(`  URL: ${data.url.substring(0, 80)}...\n`);
  });
  
  downloader.on('progress', (data) => {
    console.log(`📊 ${data.modelId}: ${data.percent}% | ${data.speedFormatted} | ETA: ${data.eta}s`);
  });
  
  downloader.on('complete', (data) => {
    console.log(`\n✅ 下载完成！`);
    console.log(`  模型：${data.modelId}`);
    console.log(`  路径：${data.path}`);
    console.log(`  大小：${(data.size / 1024 / 1024).toFixed(2)}MB\n`);
  });
  
  downloader.on('error', (data) => {
    console.error(`\n❌ 下载失败：${data.modelId}`);
    console.error(`  错误：${data.error}\n`);
  });
  
  downloader.on('retry', (data) => {
    console.log(`\n🔄 重试：${data.modelId}`);
    console.log(`  原因：${data.error}`);
    console.log(`  切换到：${data.nextMirror}\n`);
  });
  
  try {
    // 测试下载最小的模型
    await downloader.download('EMBEDDING');
    console.log('测试成功！\n');
  } catch (err) {
    console.error('测试失败:', err.message);
  }
}

testDownload();
