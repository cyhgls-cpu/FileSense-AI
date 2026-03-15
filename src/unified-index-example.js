/**
 * 统一文件索引使用示例
 * 展示"文件路径"、"传统哈希"、"AI 向量"三者如何优雅串联
 */

const { UnifiedFileIndex } = require('./unified-file-index');

async function example() {
  console.log('=== 统一文件索引使用示例 ===\n');

  // 初始化统一索引
  const index = new UnifiedFileIndex({
    dbPath: './data/example-unified.db',
    vectorDbPath: './data/example-vectors.db',
    enableVectors: true
  });

  await index.init();

  // ============================================
  // 场景 1：文件注册（身份建立）
  // ============================================
  console.log('【场景 1】文件注册');
  console.log('文件路径是文件的唯一身份标识\n');

  const files = [
    { path: '/docs/report_v1.pdf', size: 1024000, mtime: Date.now(), category: 'document' },
    { path: '/docs/report_v2.pdf', size: 1024500, mtime: Date.now(), category: 'document' },
    { path: '/photos/cat.jpg', size: 2048000, mtime: Date.now(), category: 'image' },
    { path: '/photos/cat_copy.jpg', size: 2048000, mtime: Date.now(), category: 'image' },
    { path: '/software/app.exe', size: 10485760, mtime: Date.now(), category: 'software' }
  ];

  for (const file of files) {
    const result = await index.registerFile(file.path, file);
    console.log(`  ✓ 注册: ${result.path}`);
    console.log(`    状态: ${result.status}`);
    console.log(`    后续步骤: ${result.nextSteps.join(', ')}`);
  }

  // ============================================
  // 场景 2：传统哈希计算（精确层）
  // ============================================
  console.log('\n【场景 2】传统哈希计算');
  console.log('分块哈希漏斗模型：稀疏哈希 -> 完整哈希\n');

  // 模拟哈希计算结果
  const hashResults = [
    {
      path: '/docs/report_v1.pdf',
      sparseHash: 'a1b2c3',
      fullHash: 'sha256:abc123...',
      size: 1024000,
      mtime: Date.now(),
      category: 'document',
      extension: '.pdf'
    },
    {
      path: '/docs/report_v2.pdf',
      sparseHash: 'a1b2c4',  // 略有不同
      fullHash: 'sha256:abc124...',  // 不同
      size: 1024500,
      mtime: Date.now(),
      category: 'document',
      extension: '.pdf'
    },
    {
      path: '/photos/cat.jpg',
      sparseHash: 'd4e5f6',
      fullHash: 'sha256:def456...',
      perceptualHash: 'phash:xyz789',  // 感知哈希
      size: 2048000,
      mtime: Date.now(),
      category: 'image',
      extension: '.jpg'
    },
    {
      path: '/photos/cat_copy.jpg',
      sparseHash: 'd4e5f6',
      fullHash: 'sha256:def456...',  // 完全相同！
      perceptualHash: 'phash:xyz789',  // 感知哈希也相同
      size: 2048000,
      mtime: Date.now(),
      category: 'image',
      extension: '.jpg'
    },
    {
      path: '/software/app.exe',
      sparseHash: 'g7h8i9',
      fullHash: 'sha256:ghi789...',
      size: 10485760,
      mtime: Date.now(),
      category: 'software',
      extension: '.exe'
    }
  ];

  for (const hashData of hashResults) {
    const result = await index.updateTraditionalHash(hashData.path, hashData);
    console.log(`  ✓ 哈希: ${result.path}`);
    console.log(`    完整哈希: ${result.fullHash.substring(0, 30)}...`);
  }

  // ============================================
  // 场景 3：精确去重检测
  // ============================================
  console.log('\n【场景 3】精确去重检测');
  console.log('通过 full_hash 快速找到完全相同的文件\n');

  const exactGroups = await index.getAllExactDuplicateGroups();
  console.log(`  发现 ${exactGroups.length} 组精确重复:`);
  for (const group of exactGroups) {
    console.log(`    哈希: ${group.hash.substring(0, 20)}...`);
    console.log(`    文件:`);
    group.paths.forEach(p => console.log(`      - ${p}`));
  }

  // ============================================
  // 场景 4：AI 向量计算（语义层）
  // ============================================
  console.log('\n【场景 4】AI 向量计算');
  console.log('异步计算语义特征，不阻塞主流程\n');

  // 模拟 AI 向量（实际应从 ONNX 模型获取）
  const vectorResults = [
    {
      path: '/docs/report_v1.pdf',
      fileHash: 'sha256:abc123...',
      embedding: new Float32Array(384).fill(0.1).map((v, i) => v + i * 0.001)
    },
    {
      path: '/docs/report_v2.pdf',
      fileHash: 'sha256:abc124...',
      embedding: new Float32Array(384).fill(0.1).map((v, i) => v + i * 0.0011)  // 非常相似
    },
    {
      path: '/photos/cat.jpg',
      fileHash: 'sha256:def456...',
      clip: new Float32Array(512).fill(0.2).map((v, i) => v + i * 0.0005)
    },
    {
      path: '/photos/cat_copy.jpg',
      fileHash: 'sha256:def456...',
      clip: new Float32Array(512).fill(0.2).map((v, i) => v + i * 0.0005)  // 相同
    }
  ];

  for (const vectorData of vectorResults) {
    const result = await index.updateAIVectors(vectorData.path, vectorData);
    console.log(`  ✓ 向量化: ${result.path}`);
    result.vectors.forEach(v => {
      console.log(`    ${v.type}: ${v.dimensions} 维`);
    });
  }

  // ============================================
  // 场景 5：分层去重分析
  // ============================================
  console.log('\n【场景 5】分层去重分析');
  console.log('第一层：传统哈希（精确匹配）');
  console.log('第二层：AI 向量（语义相似）\n');

  const analysis = await index.analyzeDuplicates('/docs/report_v1.pdf', {
    modelType: 'EMBEDDING',
    threshold: 0.95,
    topK: 5
  });

  console.log(`  分析文件: ${analysis.path}`);
  console.log(`  精确重复: ${analysis.summary.exactCount} 个`);
  analysis.exactDuplicates.forEach(d => {
    console.log(`    - ${d.file_path}`);
  });

  console.log(`  语义相似: ${analysis.summary.semanticCount} 个`);
  analysis.semanticDuplicates.forEach(d => {
    console.log(`    - ${d.filePath} (相似度: ${(d.similarity * 100).toFixed(1)}%)`);
  });

  // ============================================
  // 场景 6：获取文件完整信息
  // ============================================
  console.log('\n【场景 6】获取文件完整信息');
  console.log('路径 -> 哈希 -> 向量 的完整链路\n');

  const fileInfo = await index.getFileInfo('/docs/report_v1.pdf');
  console.log(`  文件: ${fileInfo.path}`);
  console.log(`  传统层:`);
  console.log(`    大小: ${fileInfo.traditional?.size} bytes`);
  console.log(`    完整哈希: ${fileInfo.traditional?.fullHash?.substring(0, 30)}...`);
  console.log(`  AI 层:`);
  console.log(`    文档嵌入: ${fileInfo.vectors?.embedding ? '✓' : '✗'}`);
  console.log(`    维度: ${fileInfo.vectors?.embedding?.dimensions || 0}`);

  // ============================================
  // 场景 7：统计信息
  // ============================================
  console.log('\n【场景 7】统计信息');

  const stats = await index.getStats();
  console.log(`  总文件数: ${stats.totalFiles}`);
  console.log(`  有传统哈希: ${stats.withTraditionalHash}`);
  console.log(`  有 AI 向量: ${stats.withAIVectors}`);
  console.log(`  缓存命中率: ${(stats.cache.hitRate * 100).toFixed(1)}%`);

  // ============================================
  // 场景 8：数据一致性验证
  // ============================================
  console.log('\n【场景 8】数据一致性验证');

  const consistency = await index.verifyConsistency();
  console.log(`  数据一致性: ${consistency.valid ? '✓ 通过' : '✗ 有问题'}`);
  console.log(`  总文件: ${consistency.totalFiles}`);
  if (consistency.issues.length > 0) {
    console.log(`  警告: ${consistency.issues.length} 个文件缺少向量`);
  }

  // 关闭
  await index.close();
  console.log('\n=== 示例完成 ===');
}

// 运行示例
example().catch(console.error);
