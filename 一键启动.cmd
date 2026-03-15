@echo off
chcp 65001 >nul
title 智能文件整理助手

REM === 设置 Node.js 路径 ===
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%NODE_PATH%;%PATH%"

REM === 切换到脚本所在目录 ===
cd /d "%~dp0"

REM === 显示启动信息 ===
cls
echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║          FileSense AI (灵析)                          ║
echo ║          智能文件整理助手                              ║
echo ╚════════════════════════════════════════════════════════╝
echo.
echo [启动] 正在加载应用...
echo [路径] %CD%
echo.

REM === 启动 Electron ===
start "" "%NODE_PATH%\npx.cmd" electron .

echo ✅ 应用已启动！
echo.
echo 💡 如果窗口没有自动弹出，请检查任务栏
echo.
echo ⏎ 按任意键退出此提示窗口...
pause >nul
exit /b 0
