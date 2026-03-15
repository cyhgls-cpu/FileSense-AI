/**
 * 体验沙盒模块
 * 首次启动时创建测试环境，让用户直观体验 AI 功能
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class PlaygroundManager {
  constructor() {
    this.playgroundDir = null;
    this.isInitialized = false;
  }

  /**
   * 获取沙盒目录路径
   */
  _getPlaygroundPath() {
    const tempDir = os.tmpdir();
    return path.join(tempDir, 'SmartFileOrganizer-Playground');
  }

  /**
   * 初始化体验沙盒
   */
  async initialize() {
    this.playgroundDir = this._getPlaygroundPath();

    try {
      // 清理旧的沙盒
      await this.cleanup();

      // 创建沙盒目录结构
      await fs.mkdir(this.playgroundDir, { recursive: true });
      await fs.mkdir(path.join(this.playgroundDir, '文档'), { recursive: true });
      await fs.mkdir(path.join(this.playgroundDir, '图片'), { recursive: true });
      await fs.mkdir(path.join(this.playgroundDir, '下载'), { recursive: true });
      await fs.mkdir(path.join(this.playgroundDir, '备份'), { recursive: true });

      // 创建测试文件
      await this._createTestDocuments();
      await this._createTestImages();
      await this._createDuplicateFiles();
      await this._createSimilarFiles();

      this.isInitialized = true;
      console.log('[Playground] 体验沙盒已创建:', this.playgroundDir);

      return {
        success: true,
        path: this.playgroundDir,
        stats: await this._getPlaygroundStats()
      };
    } catch (err) {
      console.error('[Playground] 初始化失败:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 创建测试文档（用于语义搜索演示）
   */
  async _createTestDocuments() {
    const docDir = path.join(this.playgroundDir, '文档');

    const documents = [
      {
        name: '项目计划书.txt',
        content: `智能文件整理器项目计划书

项目目标：
开发一款基于 AI 的文件管理工具，帮助用户自动整理和去重文件。

核心功能：
1. 重复文件检测 - 使用哈希算法快速找出完全相同的文件
2. AI 语义搜索 - 通过自然语言描述找到相关文件
3. 智能分类 - 自动将文件分类到合适的文件夹
4. 图片聚类 - 识别相似图片并分组

技术栈：
- Electron 桌面应用框架
- ONNX Runtime 本地 AI 推理
- SQLite 数据存储
- Rust 高性能文件扫描

预期成果：
让用户在 3 分钟内感受到 AI 整理文件的魅力，大幅提升文件管理效率。`
      },
      {
        name: '会议记录-2024.txt',
        content: `产品开发会议纪要

时间：2024年12月15日
主题：AI 文件整理器功能规划

讨论要点：
1. 用户体验优先，界面要简洁直观
2. 所有 AI 功能本地运行，保护隐私
3. 文件删除必须进入回收站，确保安全
4. 支持断点续传下载 AI 模型

下一步行动：
- 完成基础文件扫描功能
- 集成 ONNX Runtime
- 设计优雅的下载界面
- 编写用户引导教程`
      },
      {
        name: '技术方案.md',
        content: `# 技术架构方案

## 文件扫描层
使用 Rust + N-API 实现高性能文件扫描，支持：
- 并行目录遍历
- 智能错误处理（跳过被占用文件）
- 实时进度反馈

## AI 推理层
- Embedding 模型：bge-micro-v2（22MB）
- 图片理解：CLIP ViT-B/32（578MB）
- 语言模型：Qwen2.5-1.5B（986MB）

## 存储层
- SQLite WAL 模式
- 批量事务处理
- 向量索引加速

## UI 层
- 虚拟滚动处理大列表
- 渐进式功能暴露
- 操作历史与撤销`
      },
      {
        name: '预算报告.xlsx.txt',
        content: `项目预算报告

开发成本：
- 人力成本：50万元
- 服务器费用：2万元/年
- 第三方服务：5万元

预期收益：
- 付费用户转化率：5%
- 平均客单价：99元
- 首年目标用户：10,000人

风险评估：
- 模型下载稳定性
- 杀毒软件误报
- 用户学习成本`
      },
      {
        name: '旅游照片说明.txt',
        content: `2024年日本旅游照片整理

行程：
- 第一天：东京浅草寺、晴空塔
- 第二天：富士山一日游
- 第三天：京都清水寺、伏见稻荷
- 第四天：大阪环球影城

照片分类：
- 风景照：富士山、寺庙、街道
- 美食照：寿司、拉面、天妇罗
- 人物照：合影、自拍
- 购物：药妆店、电器城

需要整理的内容：
很多重复拍摄的照片，相似角度的风景照，需要挑选最佳照片保留。`
      }
    ];

    for (const doc of documents) {
      await fs.writeFile(path.join(docDir, doc.name), doc.content, 'utf8');
    }
  }

  /**
   * 创建测试图片说明文件（模拟图片场景）
   */
  async _createTestImages() {
    const imgDir = path.join(this.playgroundDir, '图片');

    const imageDescriptions = [
      {
        name: 'IMG_001.jpg.txt',
        content: `[模拟图片文件] 富士山日出
拍摄时间：2024-03-15 06:30
地点：河口湖
描述：清晨的富士山，湖面倒影清晰，天空呈现粉红色
文件大小：3.2MB
分辨率：4000x3000`
      },
      {
        name: 'IMG_002.jpg.txt',
        content: `[模拟图片文件] 富士山日出-连拍1
拍摄时间：2024-03-15 06:31
地点：河口湖
描述：清晨的富士山，角度与 IMG_001 相似
文件大小：3.1MB
分辨率：4000x3000`
      },
      {
        name: 'IMG_003.jpg.txt',
        content: `[模拟图片文件] 富士山日出-连拍2
拍摄时间：2024-03-15 06:32
地点：河口湖
描述：清晨的富士山，角度与 IMG_001 相似
文件大小：3.3MB
分辨率：4000x3000`
      },
      {
        name: 'DSC_1001.png.txt',
        content: `[模拟图片文件] 东京夜景
拍摄时间：2024-03-16 20:15
地点：涩谷天空
描述：东京城市夜景，霓虹灯璀璨
文件大小：5.1MB
分辨率：6000x4000`
      },
      {
        name: 'DSC_1002.png.txt',
        content: `[模拟图片文件] 东京夜景-横版
拍摄时间：2024-03-16 20:16
地点：涩谷天空
描述：东京城市夜景，与 DSC_1001 同地点拍摄
文件大小：4.8MB
分辨率：6000x4000`
      },
      {
        name: 'food_001.jpg.txt',
        content: `[模拟图片文件] 寿司拼盘
拍摄时间：2024-03-17 12:30
地点：筑地市场
描述：新鲜寿司，金枪鱼、三文鱼、海胆
文件大小：2.1MB
分辨率：3000x3000`
      },
      {
        name: 'food_002.jpg.txt',
        content: `[模拟图片文件] 拉面
拍摄时间：2024-03-17 19:00
地点：一兰拉面
描述：豚骨拉面，溏心蛋，叉烧
文件大小：1.8MB
分辨率：3000x3000`
      }
    ];

    for (const img of imageDescriptions) {
      await fs.writeFile(path.join(imgDir, img.name), img.content, 'utf8');
    }
  }

  /**
   * 创建重复文件（用于去重演示）
   */
  async _createDuplicateFiles() {
    const downloadDir = path.join(this.playgroundDir, '下载');
    const backupDir = path.join(this.playgroundDir, '备份');

    // 完全相同的文件
    const duplicateContent = `这是一个重复的文件内容。
用于演示智能文件整理器的重复文件检测功能。
相同的文件可能分布在不同的文件夹中。
通过哈希算法可以快速找出这些重复项。`;

    // 在不同位置创建相同内容的文件
    await fs.writeFile(path.join(this.playgroundDir, '重要资料.txt'), duplicateContent, 'utf8');
    await fs.writeFile(path.join(downloadDir, '重要资料(1).txt'), duplicateContent, 'utf8');
    await fs.writeFile(path.join(backupDir, '重要资料-备份.txt'), duplicateContent, 'utf8');

    // 创建另一个重复组
    const anotherContent = `项目会议纪要 - 2024年12月
参会人员：张三、李四、王五
会议主题：产品发布计划
结论：确定于明年3月正式发布。`;

    await fs.writeFile(path.join(this.playgroundDir, '文档', '会议纪要.txt'), anotherContent, 'utf8');
    await fs.writeFile(path.join(downloadDir, '会议纪要-final.txt'), anotherContent, 'utf8');
    await fs.writeFile(path.join(backupDir, '会议纪要-旧.txt'), anotherContent, 'utf8');
  }

  /**
   * 创建相似文件（用于相似度检测演示）
   */
  async _createSimilarFiles() {
    const docDir = path.join(this.playgroundDir, '文档');

    // 相似但不完全相同的文档
    const version1 = `产品需求文档 v1.0

功能需求：
1. 支持 Windows 和 macOS 系统
2. 文件扫描速度不低于 1000 文件/秒
3. 支持 50+ 文件格式

非功能需求：
1. 内存占用不超过 500MB
2. 启动时间不超过 3 秒`;

    const version2 = `产品需求文档 v1.1

功能需求：
1. 支持 Windows、macOS 和 Linux 系统
2. 文件扫描速度不低于 2000 文件/秒
3. 支持 100+ 文件格式

非功能需求：
1. 内存占用不超过 1GB
2. 启动时间不超过 2 秒
3. 支持深色模式`;

    const version3 = `产品需求文档 - 草稿

功能需求：
1. 支持 Windows 系统
2. 文件扫描
3. 支持常见文件格式

待确定：
- macOS 支持
- Linux 支持
- 具体性能指标`;

    await fs.writeFile(path.join(docDir, 'PRD-v1.0.txt'), version1, 'utf8');
    await fs.writeFile(path.join(docDir, 'PRD-v1.1.txt'), version2, 'utf8');
    await fs.writeFile(path.join(docDir, 'PRD-草稿.txt'), version3, 'utf8');
  }

  /**
   * 获取沙盒统计信息
   */
  async _getPlaygroundStats() {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byCategory: {}
    };

    const categories = ['文档', '图片', '下载', '备份'];

    for (const category of categories) {
      const dir = path.join(this.playgroundDir, category);
      try {
        const files = await fs.readdir(dir);
        stats.byCategory[category] = files.length;
        stats.totalFiles += files.length;

        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = await fs.stat(filePath);
          stats.totalSize += stat.size;
        }
      } catch {
        stats.byCategory[category] = 0;
      }
    }

    // 根目录文件
    const rootFiles = await fs.readdir(this.playgroundDir);
    const rootFileCount = rootFiles.filter(f => !categories.includes(f)).length;
    stats.byCategory['根目录'] = rootFileCount;
    stats.totalFiles += rootFileCount;

    return stats;
  }

  /**
   * 获取引导步骤
   */
  getGuidedTourSteps() {
    return [
      {
        title: '欢迎使用智能文件整理器',
        description: '这是一个体验沙盒，包含测试文件用于演示 AI 功能。所有文件都是安全的示例数据。',
        target: null
      },
      {
        title: '第一步：扫描文件',
        description: '点击"开始扫描"按钮，应用会快速分析沙盒中的所有文件，建立索引。',
        target: 'scan-btn'
      },
      {
        title: '第二步：查看重复文件',
        description: '扫描完成后，切换到"重复文件"标签，可以看到 3 组重复文件。尝试删除重复项。',
        target: 'duplicates-tab'
      },
      {
        title: '第三步：AI 语义搜索',
        description: '在搜索框输入"项目计划"或"旅游照片"，AI 会理解你的意图，找到相关文件。',
        target: 'search-box'
      },
      {
        title: '第四步：智能分类',
        description: '使用"智能整理"功能，让 AI 自动将文件分类到合适的文件夹。',
        target: 'organize-btn'
      },
      {
        title: '第五步：查看操作历史',
        description: '所有操作都会记录在"操作历史"中，你可以随时撤销误操作。',
        target: 'history-tab'
      },
      {
        title: '开始探索',
        description: '现在你可以自由探索所有功能。完成后，点击"退出沙盒"开始使用真实文件。',
        target: null
      }
    ];
  }

  /**
   * 清理沙盒
   */
  async cleanup() {
    try {
      if (this.playgroundDir) {
        await fs.rm(this.playgroundDir, { recursive: true, force: true });
        console.log('[Playground] 沙盒已清理');
      }
    } catch (err) {
      console.error('[Playground] 清理失败:', err);
    }
  }

  /**
   * 检查是否是沙盒路径
   */
  isPlaygroundPath(filePath) {
    if (!this.playgroundDir) return false;
    return filePath.startsWith(this.playgroundDir);
  }

  /**
   * 获取沙盒路径
   */
  getPath() {
    return this.playgroundDir;
  }
}

// 单例模式
let instance = null;

function getPlaygroundManager() {
  if (!instance) {
    instance = new PlaygroundManager();
  }
  return instance;
}

module.exports = {
  PlaygroundManager,
  getPlaygroundManager
};
