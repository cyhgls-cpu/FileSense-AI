@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    AI 模型下载助手 - 命令行版
echo ========================================
echo.
echo 正在下载 AI 模型...
echo.

set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"

node download-models-cli.js

echo.
pause
