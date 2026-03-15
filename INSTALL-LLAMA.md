# node-llama-cpp 安装指南

## 问题
`node-llama-cpp` 是一个原生C++模块，需要编译环境才能安装。

## 快速解决方案

### 方案1：使用预编译版本（推荐）

运行自动安装脚本：
```bash
install-llama.bat
```

### 方案2：手动安装

#### 步骤1：安装编译工具

**Windows:**
1. 下载 [Visual Studio Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe)
2. 安装时选择 **"使用C++的桌面开发"** 工作负载
3. 等待安装完成

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install build-essential python3
```

#### 步骤2：安装Python

确保Python 3.6+已安装：
```bash
python --version
```

设置npm使用正确的Python：
```bash
npm config set python python.exe
```

#### 步骤3：安装node-llama-cpp

```bash
npm install node-llama-cpp@3.0.0
```

如果编译失败，尝试：
```bash
npm install node-llama-cpp@3.0.0 --build-from-source
```

### 方案3：使用简化版本（无需安装）

如果不安装 `node-llama-cpp`，应用会自动使用**模拟模式**：
- LLM功能会返回模拟响应
- 其他功能（扫描、哈希、数据库）完全正常
- 界面会提示"LLM未安装"

## 验证安装

```bash
node test-llm.js
```

如果看到 `✅ 所有测试通过！模型可以正常使用`，说明安装成功。

## 常见问题

### 1. "MSBuild not found"
**解决:** 安装 Visual Studio Build Tools，选择"使用C++的桌面开发"

### 2. "Python is not set"
**解决:** 
```bash
npm config set python python.exe
```

### 3. "Cannot find module 'node-llama-cpp'"
**解决:** 
```bash
npm install
# 或
npm install node-llama-cpp@3.0.0
```

### 4. 编译时间过长
**解决:** 这是正常的，编译可能需要5-10分钟。耐心等待。

### 5. 内存不足错误
**解决:** 
- 关闭其他应用程序
- 增加虚拟内存（页面文件）大小
- 使用 `--jobs=1` 参数减少并行编译任务

## 卸载

```bash
npm uninstall node-llama-cpp
```

## 替代方案

如果无法安装 `node-llama-cpp`，应用会自动降级到**模拟模式**：
- 所有核心功能正常工作
- LLM相关功能显示模拟响应
- 界面会有相应提示
