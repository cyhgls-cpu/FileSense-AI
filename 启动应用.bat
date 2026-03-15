@echo off
chcp 65001 >nul
title 智能文件整理助手

REM 设置 Node.js 路径
set "PATH=C:\Program Files\nodejs;%PATH%"

cd /d "%~dp0"

echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║   智能文件整理助手 - 启动中...                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.
echo [信息] 正在启动 Electron 应用...
echo.

start "" /B "C:\Program Files\nodejs\npx.cmd" electron .

if %ERRORLEVEL% EQU 0 (
    echo ✅ 应用已启动！
    echo.
    echo 💡 提示：应用窗口应该已经打开
    echo.
    echo ⏎ 按任意键退出此窗口...
    pause >nul
) else (
    echo ❌ 启动失败
    echo.
    pause
)
