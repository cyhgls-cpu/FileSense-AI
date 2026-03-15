# 热修复说明 - Hash 算法兼容性

## 问题描述

运行时报错：
```
Error: Digest method not supported
    at new Hash (node:internal/crypto/hash:69:19)
    at Object.createHash (node:crypto:133:10)
```

## 原因分析

Node.js 的 `crypto` 模块**不支持**以下哈希算法：
- ❌ `xxhash64` - 需要 native 模块 `xxhash`
- ❌ `blake3` - 需要 native 模块 `blake3`

这些算法在 Node.js 中不是内置的，需要安装额外的 native 依赖。

## 解决方案

### 临时方案（已实施）

使用 Node.js **原生支持**的 SHA-256 算法：

```javascript
// ✅ 正确 - Node.js 原生支持
const hash = crypto.createHash('sha256');

// ❌ 错误 - 需要 native 模块
const hash = crypto.createHash('xxhash64');
const hash = crypto.createHash('blake3');
```

### 性能对比

| 算法 | 速度 | Node.js 支持 | 推荐场景 |
|------|------|------------|---------|
| SHA-256 | 快 | ✅ 原生 | 当前使用 |
| xxHash | 极快 | ❌ 需安装 | 未来优化 |
| BLAKE3 | 最快 | ❌ 需安装 | 未来优化 |

### 未来优化（可选）

如需极致性能，可安装 native 模块：

```bash
npm install xxhash blake3
```

然后在代码中使用：

```javascript
const xxhash = require('xxhash');
const blake3 = require('blake3');

// xxHash
const hash = xxhash.XxHash64.hash(buffer);

// BLAKE3
const hash = blake3.blake3(buffer).toString('hex');
```

## 已修复文件

- ✅ `src/scanner.js` - 分块哈希和全量哈希改用 SHA-256
- ✅ `src/scanner-worker.js` - 已经是 SHA-256（无需修改）

## 验证结果

应用已成功启动：
```
✅ 索引数据库初始化成功
✅ 无哈希算法错误
✅ 扫描引擎就绪
```

## 注意事项

1. **SHA-256 性能足够**: 对于大多数场景，SHA-256 的性能已经足够好
2. **native 模块风险**: native 模块可能有编译问题和平台兼容性风险
3. **未来升级路径**: 如确实需要更高性能，再考虑引入 native 模块

---

*修复时间：2026-03-14*
