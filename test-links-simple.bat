@echo off
chcp 65001 >nul
cls
echo ================================================================================
echo Testing Model Download Links
echo ================================================================================
echo.

powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; Write-Host 'Testing EMBEDDING model...' -ForegroundColor Cyan; $urls = @{'ModelScope'= 'https://www.modelscope.cn/models/iic/bge-micro-v2/resolve/master/model.onnx'; 'HuggingFace'='https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx'}; foreach($url in $urls.Keys){ try{ $r=Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 10 -ErrorAction Stop; Write-Host \"  $($url.Key): OK ($($r.StatusCode))\" -ForegroundColor Green } catch{ Write-Host \"  $($url.Key): FAILED\" -ForegroundColor Red } } }"

echo.
echo Testing complete! Check output above for results.
echo.
pause
