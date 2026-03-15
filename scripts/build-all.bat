@echo off
chcp 65001 >nul
title FileSense AI - 全平台打包工具

echo ========================================
echo   FileSense AI 全平台打包工具
echo ========================================
echo.

cd /d "%~dp0\.."

echo 🌍 开始全平台打包...
echo 注意: 打包过程可能需要较长时间
echo.

:: Windows
echo.
echo ========================================
echo   [1/3] 打包 Windows 版本
echo ========================================
call scripts\build-windows.bat

:: 检查是否在 Windows 上运行，如果是则跳过 macOS
echo.
echo ========================================
echo   [2/3] 跳过 macOS (请在 Mac 上运行)
echo ========================================
echo 提示: macOS 版本需要在 macOS 系统上打包
echo       请复制项目到 Mac 运行 scripts/build-macos.sh
echo.

:: Linux (如果在 WSL 或 Linux 环境)
echo ========================================
echo   [3/3] 打包 Linux 版本
echo ========================================
where bash >nul 2>nul
if %errorlevel% == 0 (
    bash scripts/build-linux.sh
) else (
    echo 未检测到 bash，跳过 Linux 打包
echo 提示: Linux 版本需要在 Linux 环境打包
echo       请复制项目到 Linux 运行 scripts/build-linux.sh
echo.
)

echo.
echo ========================================
echo   全平台打包完成！
echo ========================================
echo.
echo 生成的文件位于: .\dist\
echo.
dir /b dist\FileSense* 2>nul || echo 暂无生成的文件
echo.
pause
