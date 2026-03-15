# Rust Native File Scanner

高性能Rust文件扫描模块，使用N-API为Electron应用提供原生性能。

## 特性

- **并行扫描**: 使用 `jwalk` + `rayon` 实现多线程并行遍历
- **内存映射**: 大文件使用mmap加速读取
- **快速哈希**: Blake3算法，比MD5/SHA256更快更安全
- **稀疏哈希**: 大文件只采样头/中/尾部分，快速去重
- **Windows MFT**: Windows下可直接读取MFT，扫描速度提升10倍
- **SimHash**: 支持相似文件检测

## 性能对比

| 操作 | Node.js | Rust Native | 提升 |
|------|---------|-------------|------|
| 扫描10万文件 | 8-12秒 | 0.5-1秒 | **10-20x** |
| 计算1GB文件哈希 | 3秒 | 0.5秒 | **6x** |
| 批量哈希1000文件 | 15秒 | 2秒 | **7x** |

## 安装

### 前置要求

1. **Rust工具链** (必需)
   ```bash
   # 安装 Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   # Windows: 下载并运行 rustup-init.exe
   ```

2. **Node.js** >= 16.0.0

3. **Python** 3.6+ (Windows构建需要)

4. **Visual Studio Build Tools** (Windows)
   - 或安装 Visual Studio Community + "Desktop development with C++"

### 构建

```bash
cd native

# 安装依赖
npm install

# 构建Release版本
npm run build

# 或构建Debug版本
npm run build:debug

# 运行测试
npm test
```

### 交叉编译

#### Windows -> macOS
需要配置交叉编译工具链（较复杂，建议使用CI）

#### 使用GitHub Actions自动构建
项目已配置 `.github/workflows/build-native.yml`，推送后自动构建各平台二进制。

## 使用

### 基本用法

```javascript
const { FastScanner, init } = require('./native');

// 初始化（设置线程池）
init();

// 创建扫描器
const scanner = new FastScanner({
  threads: 8,           // 线程数（默认CPU核心数）
  skipHidden: true,     // 跳过隐藏文件
  maxDepth: 10,         // 最大深度
});

// 扫描目录
const files = JSON.parse(scanner.scanDirectory('C:\\Users'));
console.log(`Found ${files.length} files`);

// 计算文件哈希
const hash = scanner.calculateHash('C:\\file.txt', 'blake3');

// 批量哈希（并行处理）
const hashes = JSON.parse(scanner.batchCalculateHash([
  'C:\\file1.txt',
  'C:\\file2.txt',
  // ...
]));
```

### 带进度回调

```javascript
const result = scanner.scanWithProgress(
  'C:\\Users',
  (progress, currentFile) => {
    console.log(`${progress}% - ${currentFile}`);
  }
);
```

### Windows MFT快速扫描（需要管理员权限）

```javascript
const { WindowsFastScanner } = require('./native');

const scanner = new WindowsFastScanner();
const files = JSON.parse(scanner.scanMft('C')); // 扫描整个C盘
```

### 内存映射读取

```javascript
const { MmapReader } = require('./native');

// 读取文件的前4KB
const chunk = MmapReader.readFileChunk('large.bin', 0, 4096);
```

## API文档

### FastScanner

#### `new(options?: ScanOptions)`
创建扫描器实例。

**Options:**
- `threads`: 线程数（默认CPU核心数）
- `followSymlinks`: 是否跟随符号链接（默认false）
- `maxDepth`: 最大扫描深度（默认无限制）
- `skipHidden`: 跳过隐藏文件（默认true）
- `extensions`: 只扫描指定扩展名（如 `['jpg', 'png']`）

#### `scanDirectory(path: string): string`
扫描目录，返回JSON字符串化的文件列表。

**Returns:** `FileInfo[]`
```typescript
interface FileInfo {
  path: string;
  size: number;
  modifiedTime: number;
  createdTime: number;
  isDirectory: boolean;
  extension: string;
  category: 'software' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other';
}
```

#### `scanWithProgress(path: string, callback: (progress: number, file: string) => void): string`
带进度回调的扫描。

#### `calculateHash(path: string, type?: 'blake3' | 'md5' | 'sha256' | 'sparse'): string`
计算文件哈希。

#### `batchCalculateHash(paths: string[]): string`
批量计算哈希（并行处理）。

### WindowsFastScanner (Windows only)

#### `scanMft(drive: string): string`
使用Windows MFT扫描整个驱动器（需要管理员权限）。

### MmapReader

#### `readFileChunk(path: string, offset: number, length: number): Buffer`
使用内存映射读取文件片段。

## 故障排除

### 构建失败

**错误: `linker 'link.exe' not found` (Windows)**
- 安装 Visual Studio Build Tools 或 Visual Studio Community
- 确保安装了 "Desktop development with C++" 工作负载

**错误: `python` not found**
- Windows: `npm config set python python3`
- 或安装 Python 并添加到 PATH

**错误: `napi.h` not found**
- 确保安装了 `@napi-rs/cli`: `npm install -g @napi-rs/cli`

### 运行时错误

**错误: `Cannot find module './native'`**
- 确保已构建: `cd native && npm run build`
- 检查 `.node` 文件是否存在于 `native/` 目录

**错误: `The specified module could not be found`**
- Windows: 可能需要安装 Visual C++ Redistributable
- 检查是否缺少 DLL 依赖: `dumpbin /dependents file_scanner.node`

## 开发

### 项目结构

```
native/
├── Cargo.toml          # Rust项目配置
├── build.rs            # 构建脚本
├── package.json        # Node包配置
├── index.js            # JS入口
├── fallback.js         # JS降级实现
├── src/
│   ├── lib.rs          # N-API绑定
│   ├── scanner.rs      # 文件扫描
│   ├── hasher.rs       # 哈希计算
│   └── platform/
│       └── windows.rs  # Windows优化
├── scripts/
│   └── move-binary.js  # 移动编译产物
└── test.js             # 测试脚本
```

### 添加新功能

1. 在 `src/` 下创建新的Rust模块
2. 在 `lib.rs` 中添加N-API导出
3. 在 `index.js` 中导出JS接口
4. 在 `test.js` 中添加测试

### 调试

```bash
# 构建Debug版本
cargo build

# 运行Rust测试
cargo test

# 带日志运行
RUST_LOG=debug node test.js
```

## 许可证

MIT
