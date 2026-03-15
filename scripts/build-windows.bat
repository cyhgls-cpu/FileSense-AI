@echo off
chcp 65001 >nul
title FileSense AI - Windows 打包工具

echo ========================================
echo   FileSense AI Windows 打包工具
echo ========================================
echo.

cd /d "%~dp0\.."

echo 📦 正在打包 Windows 版本...
echo.

:: 安装包版本 (NSIS Installer)
echo 🔧 正在生成安装包 (NSIS)...
npx electron-builder --win nsis --x64
if errorlevel 1 (
    echo ❌ 安装包打包失败
    pause
    exit /b 1
)
echo ✅ 安装包生成完成
echo.

:: 绿色便携版 (Portable)
echo 📁 正在生成绿色便携版...
npx electron-builder --win portable --x64
if errorlevel 1 (
    echo ❌ 绿色版打包失败
    pause
    exit /b 1
)
echo ✅ 绿色便携版生成完成
echo.

:: ZIP 压缩包
echo 🗜️  正在生成 ZIP 压缩包...
npx electron-builder --win zip --x64
if errorlevel 1 (
    echo ❌ ZIP 打包失败
    pause
    exit /b 1
)
echo ✅ ZIP 压缩包生成完成
echo.

echo ========================================
echo   Windows 打包完成！
echo ========================================
echo.
echo 生成的文件:
echo   • FileSense-AI-x.x.x-Windows-Setup-x64.exe  (安装包)
echo   • FileSense-AI-x.x.x-Windows-Portable-x64.exe (绿色便携版)
echo   • FileSense-AI-x.x.x-Windows-x64.zip (ZIP压缩包)
echo.
echo 输出目录: .\dist\
echo.
pause
