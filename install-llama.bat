@echo off
chcp 65001
echo ==========================================
echo 安装 node-llama-cpp
echo ==========================================
echo.

REM 检查Node版本
echo [1/5] 检查Node.js版本...
node -v
if errorlevel 1 (
    echo 错误: Node.js未安装
    echo 请从 https://nodejs.org/ 下载安装
    pause
    exit /b 1
)

REM 检查Python
echo.
echo [2/5] 检查Python...
python --version 2>nul || py --version 2>nul
if errorlevel 1 (
    echo 警告: Python未安装，安装node-llama-cpp可能需要Python
    echo 请从 https://www.python.org/ 下载安装
)

REM 设置Python路径
npm config set python python.exe 2>nul

REM 安装Visual Studio Build Tools检查
echo.
echo [3/5] 检查编译工具...
echo 如果需要，请安装Visual Studio Build Tools:
echo https://aka.ms/vs/17/release/vs_BuildTools.exe
echo 选择"使用C++的桌面开发"工作负载
echo.

REM 清理旧的安装
echo [4/5] 清理旧的安装...
if exist "node_modules\node-llama-cpp" (
    rmdir /s /q "node_modules\node-llama-cpp"
)
if exist "node_modules\@node-llama-cpp" (
    rmdir /s /q "node_modules\@node-llama-cpp"
)

REM 设置npm镜像
echo.
echo [5/5] 安装node-llama-cpp...
echo 使用淘宝镜像加速下载...
npm config set registry https://registry.npmmirror.com

REM 尝试安装预编译版本
echo 尝试安装预编译版本...
npm install node-llama-cpp@3.0.0 --no-save

if errorlevel 1 (
    echo.
    echo 预编译版本安装失败，尝试从源码编译...
    echo 这可能需要几分钟时间...
    npm install node-llama-cpp@3.0.0 --build-from-source --no-save
)

REM 恢复npm registry
npm config set registry https://registry.npmjs.org/

REM 检查结果
if exist "node_modules\node-llama-cpp\package.json" (
    echo.
    echo ==========================================
    echo ✅ node-llama-cpp 安装成功！
    echo ==========================================
    node -e "console.log('版本:', require('./node_modules/node-llama-cpp/package.json').version)"
) else (
    echo.
    echo ==========================================
    echo ❌ 安装失败
    echo ==========================================
    echo.
    echo 可能的解决方案：
    echo 1. 安装Visual Studio Build Tools:
    echo    https://aka.ms/vs/17/release/vs_BuildTools.exe
    echo 2. 选择"使用C++的桌面开发"工作负载
    echo 3. 重新运行此脚本
    echo.
    echo 或者使用预编译版本：
    echo npm install node-llama-cpp-win-x64
)

pause
