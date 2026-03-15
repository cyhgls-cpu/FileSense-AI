@echo off
chcp 65001 >nul
title FileSense AI - 创建 Release

echo ========================================
echo   FileSense AI Release 创建工具
echo ========================================
echo.

set VERSION=v1.0.0
if not "%~1"=="" set VERSION=%~1

echo 版本: %VERSION%
echo.

:: 检查 gh CLI
gh --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 需要安装 GitHub CLI ^(gh^)
    echo 安装: https://cli.github.com/
    pause
    exit /b 1
)

echo 请确保 GitHub Actions 打包已完成
echo 访问: https://github.com/cyhgls-cpu/FileSense-AI/actions
echo.

:: 创建临时目录
set TEMP_DIR=%TEMP%\filesense-release-%RANDOM%
mkdir "%TEMP_DIR%"

echo 步骤 1: 下载 Artifact...
echo.

echo 下载 Windows 构建...
gh run download --repo cyhgls-cpu/FileSense-AI --name "windows-build" --dir "%TEMP_DIR%\windows" 2>nul
if errorlevel 1 echo   Windows Artifact 暂不可用

echo 下载 macOS 构建...
gh run download --repo cyhgls-cpu/FileSense-AI --name "macos-build" --dir "%TEMP_DIR%\macos" 2>nul
if errorlevel 1 echo   macOS Artifact 暂不可用

echo 下载 Linux 构建...
gh run download --repo cyhgls-cpu/FileSense-AI --name "linux-build" --dir "%TEMP_DIR%\linux" 2>nul
if errorlevel 1 echo   Linux Artifact 暂不可用

echo.
echo 步骤 2: 创建 Release...
echo.

:: 收集文件
set FILES=
for %%f in ("%TEMP_DIR%\windows\*") do set FILES=!FILES!"%%f" 
for %%f in ("%TEMP_DIR%\macos\*") do set FILES=!FILES!"%%f" 
for %%f in ("%TEMP_DIR%\linux\*") do set FILES=!FILES!"%%f"

if "%FILES%"=="" (
    echo 错误: 没有找到任何构建文件
    echo 请确保 GitHub Actions 打包已完成
    rmdir /s /q "%TEMP_DIR%"
    pause
    exit /b 1
)

echo 找到以下文件:
dir /b "%TEMP_DIR%\windows\*" 2>nul
dir /b "%TEMP_DIR%\macos\*" 2>nul
dir /b "%TEMP_DIR%\linux\*" 2>nul
echo.

echo 创建 Release %VERSION%...
gh release create %VERSION% ^
    --repo cyhgls-cpu/FileSense-AI ^
    --title "FileSense AI %VERSION%" ^
    --notes "## FileSense AI %VERSION%" ^
    "%TEMP_DIR%\windows\*" ^
    "%TEMP_DIR%\macos\*" ^
    "%TEMP_DIR%\linux\*"

echo.
echo ========================================
echo   Release 创建成功!
echo   访问: https://github.com/cyhgls-cpu/FileSense-AI/releases/tag/%VERSION%
echo ========================================
echo.

:: 清理
rmdir /s /q "%TEMP_DIR%"

pause
