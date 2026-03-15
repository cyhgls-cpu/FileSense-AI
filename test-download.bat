@echo off
chcp 65001 >nul
echo.
echo ========================================
echo    快速模型下载测试工具
echo ========================================
echo.
echo 正在测试 HuggingFace 下载...
echo.

set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"

node test-model-download.js

echo.
pause
