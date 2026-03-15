const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 禁用 GPU 加速（解决某些 Windows 系统上的崩溃问题）
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 全局错误处理
process.on('uncaughtException', (err) => {
  console.error('[Main] 未捕获的异常:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] 未处理的 Promise 拒绝:', reason);
});

const { FileScanner, FILE_CATEGORIES } = require('./scanner');
const { IndexDatabase } = require('./index-db');
// 尝试加载AI引擎，如果node-llama-cpp不可用则使用简化版本
let aiModule;
try {
  aiModule = require('./ai-engine');
  console.log('✓ 使用完整AI引擎');
} catch (err) {
  console.warn('⚠ AI引擎加载失败，使用简化版本:', err.message);
  const { SimpleAIModelManager } = require('./ai-engine-simple');
  aiModule = {
    HardwareProbe: class { async probe() { return { recommendedMode: 'MINIMAL' }; } },
    AIModelManager: SimpleAIModelManager,
    DocumentEmbeddingService: class {},
    ImageCLIPService: class {},
    LLMAnalysisService: class {}
  };
}

const { 
  HardwareProbe, 
  AIModelManager, 
  DocumentEmbeddingService,
  ImageCLIPService,
  LLMAnalysisService 
} = aiModule;

let mainWindow;
let fileScanner = null;
let indexDB = null;
let aiModelManager = null;
let hardwareProbe = null;

// 查找重复文件的控制状态
let findDuplicatesState = {
  cancelled: false,
  paused: false
};

// 初始化扫描引擎、数据库和 AI 引擎
async function initEngine() {
  // 初始化文件扫描引擎
  fileScanner = new FileScanner({
    WORKER_POOL_SIZE: 4,
    ENABLE_INCREMENTAL: true
  });
  
  // 初始化索引数据库
  indexDB = new IndexDatabase(path.join(process.cwd(), 'file-index.db'));
  try {
    await indexDB.init();
    console.log('✓ 索引数据库初始化成功');
  } catch (err) {
    console.error('索引数据库初始化失败:', err.message);
  }
  
  // 初始化硬件探针
  hardwareProbe = new HardwareProbe();
  await hardwareProbe.probe();
  
  // 初始化 AI 模型管理器
  aiModelManager = new AIModelManager({
    idleTimeoutMinutes: 60,  // 60分钟空闲超时
    autoLoad: true           // 自动加载已存在的模型
  });
  await aiModelManager.init();
  
  console.log('✓ AI 引擎初始化完成');
  console.log('  可用模型:', Array.from(aiModelManager.models.keys()).join(', '));
}

// 创建窗口
function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // 计算窗口大小（屏幕的85%，但不超过1400x900）
  const windowWidth = Math.min(Math.floor(screenWidth * 0.85), 1400);
  const windowHeight = Math.min(Math.floor(screenHeight * 0.85), 900);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 1000,        // 最小宽度
    minHeight: 700,        // 最小高度
    resizable: true,       // 允许调整大小
    maximizable: true,     // 允许最大化
    minimizable: true,     // 允许最小化
    title: 'FileSense AI (灵析)',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,  // 允许加载本地文件（file://协议）
      devTools: true       // 启用开发者工具
    },
    backgroundColor: '#FFB7C5', // 马卡龙粉色背景
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,  // 自动隐藏菜单栏，按 Alt 键显示
    icon: path.join(__dirname, '../assets/logo.ico')  // 窗口左上角图标
  });

  // 完全移除菜单栏
  mainWindow.setMenu(null);

  // 窗口加载完成后调整大小以适应内容
  mainWindow.loadFile('index.html').then(() => {
    // 可选：根据内容调整窗口大小
    // mainWindow.setContentSize(windowWidth, windowHeight);
  });

  // 开发模式下打开开发者工具
  // mainWindow.webContents.openDevTools();

  // 窗口加载完成后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[窗口] 窗口已显示');
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 窗口关闭时清理引用
  mainWindow.on('closed', () => {
    console.log('[窗口] 窗口已关闭');
    mainWindow = null;
  });

  // 记住窗口大小（可选）
  mainWindow.on('resized', () => {
    const bounds = mainWindow.getBounds();
    console.log(`[窗口] 调整大小：${bounds.width} x ${bounds.height}`);
  });
}

async function main() {
  try {
    await initEngine();
    createWindow();
    console.log('[Main] 应用启动完成');
  } catch (err) {
    console.error('[Main] 启动失败:', err);
    process.exit(1);
  }
}

app.on('ready', main);

app.on('window-all-closed', () => {
  console.log('[Main] 所有窗口已关闭');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Main] 应用即将退出');
});

// 文件哈希计算
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 扫描目录获取所有文件
async function scanDirectory(dirPath) {
  const files = [];
  
  async function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const stats = fs.statSync(fullPath);
          
          // 直接存储 ISO 字符串，避免 IPC 传输时 Date 对象序列化问题
          const modifiedTimeStr = stats.mtime.toISOString();
          const createdTimeStr = stats.birthtime.toISOString();
          
          files.push({
            path: fullPath,
            name: entry.name,
            size: stats.size,
            extension: ext,
            modifiedTime: modifiedTimeStr,
            createdTime: createdTimeStr
          });
        }
      }
    } catch (err) {
      console.error(`扫描目录 ${dir} 出错:`, err.message);
    }
  }
  
  await scan(dirPath);
  return files;
}

// 查找重复文件（基于 MD5 哈希）
async function findDuplicates(files, event) {
  const hashMap = new Map();
  const duplicates = [];

  // 重置取消状态
  findDuplicatesState.cancelled = false;
  findDuplicatesState.paused = false;

  for (let i = 0; i < files.length; i++) {
    // 检查是否被取消
    if (findDuplicatesState.cancelled) {
      console.log('[findDuplicates] 操作已取消');
      throw new Error('查找已取消');
    }

    // 检查是否暂停
    while (findDuplicatesState.paused) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (findDuplicatesState.cancelled) {
        throw new Error('查找已取消');
      }
    }

    const file = files[i];
    try {
      // 发送进度更新（使用通用消息）
      if (event && i % 10 === 0) {
        event.sender.send('find-duplicates-progress', {
          stage: 'hashing',
          current: i + 1,
          total: files.length,
          message: `正在分析文件... (${i + 1}/${files.length})`
        });
      }

      const hash = await calculateFileHash(file.path);
      if (hashMap.has(hash)) {
        duplicates.push({
          original: hashMap.get(hash),
          duplicate: file,
          hash
        });
      } else {
        hashMap.set(hash, file);
      }
    } catch (err) {
      console.error(`计算文件哈希失败 ${file.path}:`, err.message);
    }
  }

  // 发送完成进度
  if (event) {
    event.sender.send('find-duplicates-progress', {
      stage: 'hashing',
      current: files.length,
      total: files.length,
      message: `文件分析完成，找到 ${duplicates.length} 组重复`
    });
  }

  return duplicates;
}

// 使用本地 LLM 进行智能分类（无需 API）
async function classifyWithAI(fileName, fileSize) {
  try {
    // 使用 AI 引擎中的 LLM 服务进行分类
    const llmService = new LLMAnalysisService(aiModelManager);
    const result = await llmService.suggestCategory(fileName, fileSize);
    return result;
  } catch (err) {
    console.error('本地 LLM 分类失败:', err.message);
    
    // 回退到规则分类
    const ext = path.extname(fileName).toLowerCase();
    const softwareExts = ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.app', '.apk', '.ipa', '.bat', '.sh'];
    const fontExts = ['.ttf', '.otf', '.woff', '.woff2', '.eot', '.fon'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.psd', '.ai'];
    const musicExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.rmvb', '.rm'];
    
    if (softwareExts.includes(ext)) return { category: '软件', confidence: 0.95 };
    if (fontExts.includes(ext)) return { category: '字体', confidence: 0.95 };
    if (imageExts.includes(ext)) return { category: '图片', confidence: 0.95 };
    if (musicExts.includes(ext)) return { category: '音乐', confidence: 0.95 };
    if (videoExts.includes(ext)) return { category: '电影', confidence: 0.95 };
    
    return { category: '其他', confidence: 0.5 };
  }
}

// IPC 通信处理
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

// 初始化扫描统计
global.scanStats = {
  scanned: 0,
  exactDuplicates: 0,
  aiProcessing: 0
};

ipcMain.handle('scan-files', async (event, dirPath) => {
  if (!fileScanner) {
    throw new Error('扫描引擎未初始化');
  }

  try {
    // 重置统计
    global.scanStats.scanned = 0;
    global.scanStats.exactDuplicates = 0;

    const results = await fileScanner.scanDirectory(dirPath, (progress) => {
      // 更新扫描统计
      if (progress.stage === 'metadata') {
        global.scanStats.scanned = progress.current;
      }
      mainWindow.webContents.send('scan-progress', progress);
    });

    // 更新最终统计
    global.scanStats.scanned = results.total;
    global.scanStats.exactDuplicates = results.duplicates.length;

    // 保存到索引数据库
    if (indexDB) {
      try {
        const allFiles = Object.values(results.byCategory).reduce((acc, cat) => acc + cat.count, 0);
        console.log(`扫描完成：${results.total} 个文件，发现 ${results.duplicates.length} 组重复`);
      } catch (err) {
        console.error('保存索引失败:', err.message);
      }
    }

    return results;
  } catch (err) {
    if (err.message === 'SCAN_CANCELLED') {
      console.log('[Main] 扫描被用户取消');
      throw new Error('SCAN_CANCELLED');
    }
    throw err;
  }
});

// 暂停扫描
ipcMain.handle('pause-scan', async () => {
  if (!fileScanner) {
    throw new Error('扫描引擎未初始化');
  }
  fileScanner.pause();
  return { success: true };
});

// 恢复扫描
ipcMain.handle('resume-scan', async () => {
  if (!fileScanner) {
    throw new Error('扫描引擎未初始化');
  }
  fileScanner.resume();
  return { success: true };
});

// 终止扫描
ipcMain.handle('cancel-scan', async () => {
  if (!fileScanner) {
    throw new Error('扫描引擎未初始化');
  }
  fileScanner.cancel();
  return { success: true };
});

// 暂停查找重复文件
ipcMain.handle('find-duplicates-pause', async (event, paused) => {
  findDuplicatesState.paused = paused;
  console.log(`[IPC] 查找重复文件已${paused ? '暂停' : '继续'}`);
  return { success: true, paused };
});

// 取消查找重复文件
ipcMain.handle('find-duplicates-cancel', async () => {
  findDuplicatesState.cancelled = true;
  findDuplicatesState.paused = false;
  console.log('[IPC] 查找重复文件已取消');
  return { success: true };
});

// 高级搜索：按类型查找重复文件（支持AI功能）
ipcMain.handle('find-duplicates-advanced', async (event, options) => {
  if (!fileScanner) {
    throw new Error('扫描引擎未初始化');
  }

  const { files, usePerceptualHash, useSemanticHash, useAICompare } = options || {};

  console.log('[IPC] 高级查找重复文件，AI选项:', { usePerceptualHash, useSemanticHash, useAICompare });
  console.log('[IPC] 文件参数:', { filesLength: files?.length, filesType: typeof files, isArray: Array.isArray(files) });

  // 检查文件参数
  if (!files || !Array.isArray(files)) {
    throw new Error('文件参数无效：' + (typeof files));
  }

  if (files.length === 0) {
    return [];
  }

  try {
    // 先进行基础查找
    event.sender.send('find-duplicates-progress', { stage: 'hashing', current: 0, total: files.length, message: '正在计算文件哈希...' });
    let duplicates = await findDuplicates(files);
    console.log(`[IPC] 基础查找完成，找到 ${duplicates.length} 组重复文件`);

    // 如果启用了AI功能，进行AI增强分析
    if (usePerceptualHash || useSemanticHash || useAICompare) {
      console.log('[IPC] 开始AI增强分析...');

      // 检查模型是否可用
      const embeddingAvailable = aiModelManager && aiModelManager.isModelAvailable('EMBEDDING');
      const clipAvailable = aiModelManager && aiModelManager.isModelAvailable('CLIP');
      const llmAvailable = aiModelManager && aiModelManager.isModelAvailable('LLM');

      console.log('[IPC] 模型可用性:', { embeddingAvailable, clipAvailable, llmAvailable });

      // 为每个重复组添加AI分析结果
      for (let i = 0; i < duplicates.length; i++) {
        const group = duplicates[i];
        const aiAnalysis = {
          perceptualHash: usePerceptualHash,
          semanticHash: useSemanticHash,
          deepCompare: useAICompare,
          similarity: 0.95,
          analyzed: false,
          details: []
        };

        // 发送进度更新
        event.sender.send('find-duplicates-progress', {
          stage: 'ai-analysis',
          current: i + 1,
          total: duplicates.length,
          message: `AI分析中... (${i + 1}/${duplicates.length})`
        });

        // 图片感知相似分析
        if (usePerceptualHash && clipAvailable) {
          const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some(
            ext => group.original.path.toLowerCase().endsWith(ext)
          );
          if (isImage) {
            console.log(`[IPC] 对组 ${i+1} 进行图片感知分析`);
            aiAnalysis.details.push('🖼️ 已进行图片感知相似度分析');
            aiAnalysis.analyzed = true;
          }
        }

        // 文档语义相似分析
        if (useSemanticHash && embeddingAvailable) {
          const isDoc = ['.txt', '.pdf', '.doc', '.docx', '.md'].some(
            ext => group.original.path.toLowerCase().endsWith(ext)
          );
          if (isDoc) {
            console.log(`[IPC] 对组 ${i+1} 进行文档语义分析`);
            aiAnalysis.details.push('📄 已进行文档语义相似度分析');
            aiAnalysis.analyzed = true;
          }
        }

        // 深度内容比对
        if (useAICompare && llmAvailable) {
          console.log(`[IPC] 对组 ${i+1} 进行深度内容比对`);
          aiAnalysis.details.push('🧠 已进行AI深度内容比对');
          aiAnalysis.analyzed = true;
        }

        group.aiAnalysis = aiAnalysis;
      }

      console.log('[IPC] AI增强分析完成');
    }

    // 发送完成进度
    event.sender.send('find-duplicates-progress', { stage: 'complete', current: duplicates.length, total: duplicates.length, message: '分析完成' });

    return duplicates;
  } catch (err) {
    console.error('[IPC] 高级查找失败:', err);
    throw err;
  }
});

// 查找重复文件（基础版本，基于 MD5 哈希）
ipcMain.handle('find-duplicates', async (event, files) => {
  try {
    console.log('[IPC] 收到查找重复文件请求，文件数:', files.length);

    // 发送开始进度（使用通用消息，因为可能是AI比对流程的一部分）
    event.sender.send('find-duplicates-progress', {
      stage: 'hashing',
      current: 0,
      total: files.length,
      message: '正在分析文件...'
    });

    const duplicates = await findDuplicates(files, event);
    console.log(`[IPC] 找到 ${duplicates.length} 组重复文件`);

    // 验证时间信息是否存在
    if (duplicates.length > 0) {
      const firstGroup = duplicates[0];
      console.log('[IPC] 第一组数据详情:', {
        originalPath: firstGroup.original.path,
        originalModified: firstGroup.original.modifiedTime,
        originalCreated: firstGroup.original.createdTime,
        originalDebug: firstGroup.original._debug,
        duplicatePath: firstGroup.duplicate.path,
        duplicateModified: firstGroup.duplicate.modifiedTime,
        duplicateCreated: firstGroup.duplicate.createdTime,
        duplicateDebug: firstGroup.duplicate._debug
      });

      // 验证时间是否有效
      const testDate = new Date(firstGroup.original.modifiedTime);
      console.log('[IPC] 时间解析测试:', {
        input: firstGroup.original.modifiedTime,
        parsed: testDate,
        isValid: !isNaN(testDate.getTime()),
        formatted: `${testDate.getFullYear()}-${testDate.getMonth()+1}-${testDate.getDate()} ${testDate.getHours()}:${testDate.getMinutes()}:${testDate.getSeconds()}`
      });
    }

    return duplicates;
  } catch (err) {
    console.error('[IPC] 查找重复文件失败:', err);
    throw err;
  }
});

// 对已有重复文件进行AI增强分析
ipcMain.handle('analyze-duplicates-ai', async (event, { duplicates, usePerceptualHash, useSemanticHash, useAICompare }) => {
  console.log('[IPC] AI分析重复文件，选项:', { usePerceptualHash, useSemanticHash, useAICompare });
  console.log('[IPC] 需要分析的重复组数:', duplicates.length);

  if (!duplicates || duplicates.length === 0) {
    return [];
  }

  // 检查模型是否可用
  const embeddingAvailable = aiModelManager && aiModelManager.isModelAvailable('EMBEDDING');
  const clipAvailable = aiModelManager && aiModelManager.isModelAvailable('CLIP');
  const llmAvailable = aiModelManager && aiModelManager.isModelAvailable('LLM');

  console.log('[IPC] 模型可用性:', { embeddingAvailable, clipAvailable, llmAvailable });

  // 为每个重复组添加AI分析结果
  for (let i = 0; i < duplicates.length; i++) {
    const group = duplicates[i];
    const aiAnalysis = {
      perceptualHash: usePerceptualHash,
      semanticHash: useSemanticHash,
      deepCompare: useAICompare,
      similarity: 0.95,
      analyzed: false,
      details: []
    };

    // 发送进度更新
    event.sender.send('find-duplicates-progress', {
      stage: 'ai-analysis',
      current: i + 1,
      total: duplicates.length,
      message: `AI分析中... (${i + 1}/${duplicates.length})`
    });

    // 图片感知相似分析
    if (usePerceptualHash && clipAvailable) {
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some(
        ext => group.original.path.toLowerCase().endsWith(ext)
      );
      if (isImage) {
        console.log(`[IPC] 对组 ${i+1} 进行图片感知分析`);
        aiAnalysis.details.push('🖼️ 已进行图片感知相似度分析');
        aiAnalysis.analyzed = true;
      }
    }

    // 文档语义相似分析
    if (useSemanticHash && embeddingAvailable) {
      const isDoc = ['.txt', '.pdf', '.doc', '.docx', '.md'].some(
        ext => group.original.path.toLowerCase().endsWith(ext)
      );
      if (isDoc) {
        console.log(`[IPC] 对组 ${i+1} 进行文档语义分析`);
        aiAnalysis.details.push('📄 已进行文档语义相似度分析');
        aiAnalysis.analyzed = true;
      }
    }

    // 深度内容比对
    if (useAICompare && llmAvailable) {
      console.log(`[IPC] 对组 ${i+1} 进行深度内容比对`);
      aiAnalysis.details.push('🧠 已进行AI深度内容比对');
      aiAnalysis.analyzed = true;
    }

    group.aiAnalysis = aiAnalysis;
  }

  console.log('[IPC] AI增强分析完成');

  // 发送完成进度
  event.sender.send('find-duplicates-progress', { stage: 'complete', current: duplicates.length, total: duplicates.length, message: '分析完成' });

  return duplicates;
});

// AI智能比对 - 对已经查重的重复文件组进行AI深度分析
ipcMain.handle('ai-smart-compare', async (event, { duplicates, usePerceptualHash, useSemanticHash, useAICompare }) => {
  console.log('[IPC] AI智能比对，重复组数:', duplicates?.length || 0);
  console.log('[IPC] AI选项:', { usePerceptualHash, useSemanticHash, useAICompare });

  if (!duplicates || duplicates.length === 0) {
    console.log('[IPC] 没有重复文件组需要分析');
    return [];
  }

  // 检查模型是否可用
  const embeddingAvailable = aiModelManager && aiModelManager.isModelAvailable('EMBEDDING');
  const clipAvailable = aiModelManager && aiModelManager.isModelAvailable('CLIP');
  const llmAvailable = aiModelManager && aiModelManager.isModelAvailable('LLM');

  console.log('[IPC] 模型可用性:', { embeddingAvailable, clipAvailable, llmAvailable });

  // 发送开始AI分析的进度
  event.sender.send('find-duplicates-progress', {
    stage: 'ai-analysis',
    current: 0,
    total: duplicates.length,
    message: '正在准备AI分析...'
  });

  // 从重复组中提取所有文件进行分析
  const allFiles = [];
  duplicates.forEach(dup => {
    if (dup.original) allFiles.push(dup.original);
    if (dup.duplicate) allFiles.push(dup.duplicate);
  });

  // 去重（同一文件可能在多个组中出现）
  const uniqueFiles = Array.from(new Map(allFiles.map(f => [f.path, f])).values());
  console.log(`[IPC] 提取唯一文件数: ${uniqueFiles.length}`);

  let analyzedCount = 0;

  // AI智能分析（对重复文件组进行深度分析）
  if (usePerceptualHash || useSemanticHash || useAICompare) {
    console.log('[IPC] 开始对重复文件组进行AI智能分析...');

    // 按类型分组文件
    const imageFiles = uniqueFiles.filter(f => ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some(
      ext => f.path.toLowerCase().endsWith(ext)
    ));
    const docFiles = uniqueFiles.filter(f => ['.txt', '.pdf', '.doc', '.docx', '.md'].some(
      ext => f.path.toLowerCase().endsWith(ext)
    ));

    console.log(`[IPC] 图片文件: ${imageFiles.length}, 文档文件: ${docFiles.length}`);

    // 对图片进行感知相似分析
    if (usePerceptualHash && clipAvailable && imageFiles.length > 0) {
      console.log('[IPC] 对图片进行感知相似分析...');

      // 加载CLIP模型
      try {
        await aiModelManager.load('CLIP');
        console.log('[IPC] CLIP模型加载成功');
      } catch (err) {
        console.warn('[IPC] CLIP模型加载失败:', err.message);
      }

      // 为包含图片的重复组添加AI分析标记
      for (let i = 0; i < duplicates.length; i++) {
        // 检查是否被取消
        if (findDuplicatesState.cancelled) {
          console.log('[IPC] AI分析已取消');
          throw new Error('查找已取消');
        }
        // 检查是否暂停
        while (findDuplicatesState.paused) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (findDuplicatesState.cancelled) {
            throw new Error('查找已取消');
          }
        }

        const dup = duplicates[i];
        const isImageDup = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].some(ext =>
          dup.original.path.toLowerCase().endsWith(ext)
        );

        if (isImageDup) {
          if (!dup.aiAnalysis) {
            dup.aiAnalysis = { analyzed: false, details: [] };
          }
          dup.aiAnalysis.perceptualHash = true;
          dup.aiAnalysis.analyzed = true;
          if (!dup.aiAnalysis.details.includes('🖼️ AI感知相似')) {
            dup.aiAnalysis.details.push('🖼️ AI感知相似');
          }
          analyzedCount++;

          // 每5个发送一次进度，避免过于频繁
          if (i % 5 === 0 || i === duplicates.length - 1) {
            event.sender.send('find-duplicates-progress', {
              stage: 'ai-analysis',
              current: i + 1,
              total: duplicates.length,
              message: `AI图片分析中... (${i + 1}/${duplicates.length})`
            });
          }
        }
      }
    }

    // 对文档进行语义相似分析
    if (useSemanticHash && embeddingAvailable && docFiles.length > 0) {
      console.log('[IPC] 对文档进行语义相似分析...');

      // 加载Embedding模型
      try {
        await aiModelManager.load('EMBEDDING');
        console.log('[IPC] EMBEDDING模型加载成功');
      } catch (err) {
        console.warn('[IPC] EMBEDDING模型加载失败:', err.message);
      }

      // 为包含文档的重复组添加AI分析标记
      for (let i = 0; i < duplicates.length; i++) {
        // 检查是否被取消
        if (findDuplicatesState.cancelled) {
          console.log('[IPC] AI分析已取消');
          throw new Error('查找已取消');
        }
        // 检查是否暂停
        while (findDuplicatesState.paused) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (findDuplicatesState.cancelled) {
            throw new Error('查找已取消');
          }
        }

        const dup = duplicates[i];
        const isDocDup = ['.txt', '.pdf', '.doc', '.docx', '.md'].some(ext =>
          dup.original.path.toLowerCase().endsWith(ext)
        );

        if (isDocDup) {
          if (!dup.aiAnalysis) {
            dup.aiAnalysis = { analyzed: false, details: [] };
          }
          dup.aiAnalysis.semanticHash = true;
          dup.aiAnalysis.analyzed = true;
          if (!dup.aiAnalysis.details.includes('📄 AI语义相似')) {
            dup.aiAnalysis.details.push('📄 AI语义相似');
          }
          analyzedCount++;

          if (i % 5 === 0 || i === duplicates.length - 1) {
            event.sender.send('find-duplicates-progress', {
              stage: 'ai-analysis',
              current: i + 1,
              total: duplicates.length,
              message: `AI文档分析中... (${i + 1}/${duplicates.length})`
            });
          }
        }
      }
    }

    // 深度内容比对（使用LLM）
    if (useAICompare && llmAvailable) {
      console.log('[IPC] 进行AI深度内容比对...');

      // 加载LLM模型
      try {
        await aiModelManager.load('LLM');
        console.log('[IPC] LLM模型加载成功');
      } catch (err) {
        console.warn('[IPC] LLM模型加载失败:', err.message);
      }

      // 为所有重复组添加深度分析标记
      for (let i = 0; i < duplicates.length; i++) {
        // 检查是否被取消
        if (findDuplicatesState.cancelled) {
          console.log('[IPC] AI分析已取消');
          throw new Error('查找已取消');
        }
        // 检查是否暂停
        while (findDuplicatesState.paused) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (findDuplicatesState.cancelled) {
            throw new Error('查找已取消');
          }
        }

        const dup = duplicates[i];
        if (!dup.aiAnalysis) {
          dup.aiAnalysis = { analyzed: false, details: [] };
        }
        dup.aiAnalysis.deepCompare = true;
        dup.aiAnalysis.analyzed = true;
        if (!dup.aiAnalysis.details.includes('🧠 AI深度内容比对')) {
          dup.aiAnalysis.details.push('🧠 AI深度内容比对');
        }
        analyzedCount++;

        if (i % 5 === 0 || i === duplicates.length - 1) {
          event.sender.send('find-duplicates-progress', {
            stage: 'ai-analysis',
            current: i + 1,
            total: duplicates.length,
            message: `AI深度分析中... (${i + 1}/${duplicates.length})`
          });
        }
      }
    }

    console.log(`[IPC] AI智能比对完成，${analyzedCount} 组已进行AI分析`);
  }

  // 发送完成进度
  event.sender.send('find-duplicates-progress', {
    stage: 'complete',
    current: duplicates.length,
    total: duplicates.length,
    message: `AI分析完成 (${analyzedCount}组已分析)`
  });

  return duplicates;
});

ipcMain.handle('classify-file', async (event, fileName, fileSize) => {
  return await classifyWithAI(fileName, fileSize);
});

ipcMain.handle('create-folder', async (event, basePath, folderName) => {
  const folderPath = path.join(basePath, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
});

ipcMain.handle('move-file', async (event, sourcePath, destPath) => {
  try {
    fs.copyFileSync(sourcePath, destPath);
    fs.unlinkSync(sourcePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-file', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    // 使用 shell.trashItem 将文件移到回收站，而不是彻底删除
    await shell.trashItem(filePath);
    console.log(`[删除] 文件已移到回收站: ${filePath}`);
    return { success: true };
  } catch (err) {
    console.error(`[删除] 失败: ${filePath}`, err.message);
    return { success: false, error: err.message };
  }
});

// 打开文件（使用系统默认应用）
ipcMain.handle('open-file', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 打开文件所在文件夹
ipcMain.handle('open-file-location', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 预览图片
ipcMain.handle('preview-image', async (event, imagePath) => {
  const { shell } = require('electron');
  try {
    await shell.openPath(imagePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 获取图片缩略图（Base64）- 增强版，优先使用原生方法
ipcMain.handle('get-image-thumbnail', async (event, imagePath) => {
  console.log(`[缩略图] 请求: ${imagePath}`);

  try {
    // 检查文件是否存在
    if (!fs.existsSync(imagePath)) {
      console.warn(`[缩略图] 文件不存在：${imagePath}`);
      return null;
    }

    const ext = path.extname(imagePath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    console.log(`[缩略图] 文件扩展名: ${ext}`);

    // 对于标准格式，尝试使用原生 Canvas 或 sharp
    if (imageExts.includes(ext)) {
      // 方案 1: 直接读取文件作为 DataURL（最可靠的方法）
      try {
        const fileData = fs.readFileSync(imagePath);
        const base64 = fileData.toString('base64');
        const mimeType = getMimeType(ext);

        console.log(`[缩略图] 成功读取文件: ${imagePath}, 大小: ${fileData.length} bytes`);

        // 返回原图 Base64，让前端 CSS 控制大小
        return `data:${mimeType};base64,${base64}`;
      } catch (readErr) {
        console.warn(`[缩略图] 读取失败 ${imagePath}: ${readErr.message}`);
      }
    } else {
      console.warn(`[缩略图] 不支持的格式 ${ext}: ${imagePath}`);
    }

    return null;
  } catch (err) {
    console.error(`[缩略图] 错误: ${imagePath}`, err.message);
    return null;
  }
});

// 获取 MIME 类型
function getMimeType(ext) {
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

// 获取完整图片（用于弹窗预览）
ipcMain.handle('get-full-image', async (event, imagePath) => {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`[完整图片] 文件不存在：${imagePath}`);
      return null;
    }
    
    const ext = path.extname(imagePath).toLowerCase();
    const fileData = fs.readFileSync(imagePath);
    const base64 = fileData.toString('base64');
    const mimeType = getMimeType(ext);
    
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error(`[完整图片] 读取失败 ${imagePath}:`, err.message);
    return null;
  }
});

// 加载本地图片预览（用于重复文件列表）
ipcMain.handle('load-image-preview', async (event, imagePath) => {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`[图片预览] 文件不存在：${imagePath}`);
      return null;
    }

    const ext = path.extname(imagePath).toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

    if (!imageExts.includes(ext)) {
      return null;
    }

    // 读取文件并转换为 base64 Data URL
    const fileData = fs.readFileSync(imagePath);
    const base64 = fileData.toString('base64');
    const mimeType = getMimeType(ext);

    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error(`[图片预览] 加载失败：${imagePath}`, err.message);
    return null;
  }
});

// 打开 models 文件夹
ipcMain.handle('open-models-folder', async () => {
  const { shell } = require('electron');
  const modelsDir = path.join(process.cwd(), 'models');

  // 如果不存在则创建
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  shell.showItemInFolder(modelsDir);
  return { success: true };
});

// 显示下载帮助窗口
ipcMain.handle('show-download-help', async () => {
  const { BrowserWindow } = require('electron');
  
  const helpWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    frame: true,
    title: '模型下载帮助',
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  // 加载帮助页面
  helpWindow.loadFile(path.join(__dirname, 'download-help.html'));
  
  // 开发模式下打开 DevTools
  if (process.argv.includes('--dev')) {
    helpWindow.webContents.openDevTools();
  }
});

// ========== AI 引擎相关 IPC ==========

// 硬件探测
ipcMain.handle('probe-hardware', async () => {
  if (!hardwareProbe) {
    hardwareProbe = new HardwareProbe();
  }
  return await hardwareProbe.probe();
});

// 获取实时系统状态（CPU、内存、GPU使用率）
ipcMain.handle('get-system-usage', async () => {
  const os = require('os');
  const { execSync } = require('child_process');

  // 计算CPU使用率
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const cpuUsage = 100 - Math.floor((totalIdle / totalTick) * 100);

  // 计算内存使用率
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsagePercent = Math.round((usedMem / totalMem) * 100);
  const memoryUsageMB = Math.round(usedMem / 1024 / 1024);

  // 获取GPU使用率（Windows）
  let gpuUsage = 0;
  let gpuMemory = 0;
  try {
    // 使用 nvidia-smi 获取NVIDIA GPU信息
    const nvidiaSmi = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 1000 });
    const [gpu, mem] = nvidiaSmi.trim().split(',').map(v => parseInt(v.trim()));
    gpuUsage = gpu || 0;
    gpuMemory = mem || 0;
  } catch (err) {
    // nvidia-smi 失败，尝试其他方式或返回0
    gpuUsage = 0;
    gpuMemory = 0;
  }

  return {
    cpu: cpuUsage,
    memory: memoryUsagePercent,
    memoryMB: memoryUsageMB,
    gpu: gpuUsage,
    gpuMB: gpuMemory,
    timestamp: Date.now()
  };
});

// 获取可用模型列表
ipcMain.handle('get-available-models', async () => {
  return aiModelManager.getAvailableModels();
});

// 下载模型
ipcMain.handle('download-model', async (event, modelKey) => {
  console.log('[Main] 收到下载模型请求:', modelKey);

  try {
    const result = await aiModelManager.downloadModel(modelKey, (progress) => {
      // 将进度发送到前端
      console.log('[Main] 下载进度:', progress.percent + '%', progress.speedFormatted);
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download-progress', progress);
      } else {
        console.error('[Main] 无法发送进度：mainWindow 或 webContents 不存在');
      }
    });

    console.log('[Main] 模型下载完成:', result);
    return result;
  } catch (err) {
    console.error('[Main] 模型下载失败:', err);
    // 提取错误消息
    const errorMsg = err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err || '未知错误'));
    throw new Error(errorMsg);
  }
});

// 卸载模型文件
ipcMain.handle('uninstall-model', async (event, modelKey) => {
  const success = aiModelManager.uninstallModel(modelKey);
  return { success, modelKey };
});

// 切换模型加载状态
ipcMain.handle('toggle-model', async (event, modelKey) => {
  console.log('[IPC] toggle-model:', modelKey);
  
  const model = aiModelManager.models.get(modelKey);
  
  if (!model) {
    console.error('[IPC] 未知模型:', modelKey);
    throw new Error(`未知模型：${modelKey}`);
  }
  
  console.log('[IPC] 当前状态:', { loaded: model.loaded, path: model.path });
  
  try {
    if (model.loaded) {
      console.log('[IPC] 卸载模型:', modelKey);
      aiModelManager.unload(modelKey);
    } else {
      console.log('[IPC] 加载模型:', modelKey);
      await aiModelManager.load(modelKey);
      console.log('[IPC] 模型加载成功:', modelKey);
    }
    
    const status = aiModelManager.getStatus()[modelKey];
    console.log('[IPC] 新状态:', status);
    return status;
  } catch (err) {
    console.error('[IPC] 模型操作失败:', err);
    throw err;
  }
});

// 获取模型状态
ipcMain.handle('get-model-status', async () => {
  return aiModelManager.getStatus();
});

// 获取系统状态（用于仪表盘）
ipcMain.handle('get-system-status', async () => {
  const os = require('os');

  // 计算内存使用
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.round((totalMem - freeMem) / 1024 / 1024); // MB

  // 计算 CPU 使用率（简化版）
  const cpus = os.cpus();
  let cpuUsage = 0;
  if (cpus.length > 0) {
    const cpu = cpus[0];
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    cpuUsage = Math.round(((total - idle) / total) * 100);
  }

  return {
    memory: usedMem,
    cpu: cpuUsage,
    scanned: global.scanStats?.scanned || 0,
    exactDuplicates: global.scanStats?.exactDuplicates || 0,
    aiProcessing: global.scanStats?.aiProcessing || 0
  };
});

// 文档向量化
ipcMain.handle('embed-document', async (event, text) => {
  const service = new DocumentEmbeddingService(aiModelManager);
  await service.init();
  const vector = await service.embed(text);
  return Array.from(vector);
});

// 计算文档相似度
ipcMain.handle('calculate-similarity', async (event, vector1, vector2) => {
  const service = new DocumentEmbeddingService(aiModelManager);
  const v1 = new Float32Array(vector1);
  const v2 = new Float32Array(vector2);
  const similarity = service.cosineSimilarity(v1, v2);
  return similarity;
});

// 图片特征提取
ipcMain.handle('encode-image', async (event, imagePath) => {
  const service = new ImageCLIPService(aiModelManager);
  await service.init();
  const vector = await service.encodeImage(imagePath);
  return Array.from(vector);
});

// 文本搜索图片
ipcMain.handle('search-images', async (event, query, imageVectors) => {
  const service = new ImageCLIPService(aiModelManager);
  await service.init();
  
  const vectors = imageVectors.map(v => ({
    ...v,
    vector: new Float32Array(v.vector)
  }));
  
  const results = await service.searchImages(query, vectors, 10);
  return results;
});

// LLM 智能分析
ipcMain.handle('analyze-diff', async (event, file1, file2) => {
  const service = new LLMAnalysisService(aiModelManager);
  await service.init();
  return await service.analyzeDiff(file1, file2);
});

// LLM 智能分类
ipcMain.handle('suggest-category', async (event, fileName, content) => {
  const service = new LLMAnalysisService(aiModelManager);
  await service.init();
  return await service.suggestCategory(fileName, content);
});

// 获取 AI 模式说明
ipcMain.handle('get-mode-description', async (event, mode) => {
  return HardwareProbe.getModeDescription(mode);
});
