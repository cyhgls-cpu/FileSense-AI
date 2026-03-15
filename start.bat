@echo off
chcp 65001 >nul
echo 正在启动智能文件整理助手...
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"
node_modules\.bin\electron.cmd .
