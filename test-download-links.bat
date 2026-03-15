@echo off
chcp 65001 >nul
echo ================================================================================
echo 🔍 开始测试模型下载链接可用性
echo ================================================================================
echo.

node test-download-links.js

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ 所有链接测试完成！
) else (
    echo.
    echo ⚠️ 部分链接不可用，请查看上方的测试结果
)

echo.
echo 按任意键关闭窗口...
pause >nul
