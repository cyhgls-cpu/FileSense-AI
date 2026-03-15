# 测试模型下载链接可用性 - PowerShell 版本
# 无需安装 Node.js，直接使用 Windows 内置的 PowerShell 运行

$ErrorActionPreference = "Continue"

Write-Host "================================================================================"
Write-Host "🔍 开始测试模型下载链接可用性"
Write-Host "测试时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "================================================================================"
Write-Host ""

# 模型配置
$models = @{
    EMBEDDING = @{
        Name = "文档向量化模型 (EMBEDDING)"
        Mirrors = @{
            "modelscope" = "https://www.modelscope.cn/models/iic/bge-micro-v2/resolve/master/model.onnx"
            "modelers" = "https://modelers.cn/models/BAAI/bge-micro-v2/resolve/main/model.onnx"
            "huggingface" = "https://huggingface.co/BAAI/bge-micro-v2/resolve/main/model.onnx"
        }
    }
    CLIP = @{
        Name = "图片理解模型 (CLIP)"
        Mirrors = @{
            "modelscope" = "https://www.modelscope.cn/models/damo/cv_vit-base-patch32_image-multimodal-embedding/resolve/master/model.onnx"
            "modelers" = "https://modelers.cn/models/openai/clip-vit-base-patch32/resolve/main/model.onnx"
            "huggingface" = "https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/model.onnx"
        }
    }
    LLM = @{
        Name = "语言模型 (LLM)"
        Mirrors = @{
            "modelscope" = "https://www.modelscope.cn/models/qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/master/qwen2.5-1.5b-instruct-q4_k_m.gguf"
            "modelers" = "https://modelers.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
            "huggingface" = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
        }
    }
}

$mirrorLabels = @{
    "modelscope" = "🇨🇳 ModelScope（阿里云）"
    "modelers" = "🇨🇳 Modelers.cn（智谱 AI）"
    "huggingface" = "🌐 HuggingFace"
}

$results = @{
    Total = 0
    Success = 0
    Failed = 0
    Details = @{}
}

# 测试 URL 的函数
function Test-DownloadUrl {
    param(
        [string]$Url,
        [int]$Timeout = 10000
    )
    
    $result = @{
        Available = $false
        StatusCode = $null
        Duration = 0
        Error = $null
        Size = $null
    }
    
    $startTime = Get-Date
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        # 创建 HTTP 请求
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = "HEAD"
        $request.Timeout = $Timeout
        $request.AllowAutoRedirect = $false
        
        $response = $request.GetResponse()
        $stopwatch.Stop()
        
        $result.StatusCode = [int]$response.StatusCode
        $result.Duration = $stopwatch.ElapsedMilliseconds
        
        if ([int]$response.StatusCode -eq 200 -or [int]$response.StatusCode -ge 300) {
            $result.Available = $true
            
            # 获取文件大小
            if ($response.ContentLength -gt 0) {
                $sizeMB = [math]::Round($response.ContentLength / 1MB, 2)
                $result.Size = "$sizeMB MB"
            }
        }
        
        $response.Close()
    }
    catch [System.Net.WebException] {
        $stopwatch.Stop()
        $result.Duration = $stopwatch.ElapsedMilliseconds
        
        if ($_.Exception.Response) {
            $result.StatusCode = [int]$_.Exception.Response.StatusCode
            # 3xx 重定向也算可用
            if ($result.StatusCode -ge 300 -and $result.StatusCode -lt 400) {
                $result.Available = $true
            }
        }
        
        $result.Error = $_.Exception.Message
    }
    catch {
        $stopwatch.Stop()
        $result.Duration = $stopwatch.ElapsedMilliseconds
        $result.Error = $_.Exception.Message
    }
    
    return $result
}

# 主测试循环
foreach ($modelKey in $models.Keys) {
    $model = $models[$modelKey]
    
    Write-Host "📦 $($model.Name)" -ForegroundColor Cyan
    Write-Host "--------------------------------------------------------------------------------" -ForegroundColor Gray
    
    $results.Details[$modelKey] = @{}
    
    foreach ($mirrorKey in $model.Mirrors.Keys) {
        $url = $model.Mirrors[$mirrorKey]
        $label = $mirrorLabels[$mirrorKey]
        
        $results.Total++
        
        Write-Host -NoNewline "  测试 $label... "
        
        $testResult = Test-DownloadUrl -Url $url -Timeout 10000
        $results.Details[$modelKey][$mirrorKey] = $testResult
        
        if ($testResult.Available) {
            $results.Success++
            Write-Host "✅ 可用 ($($testResult.Duration)ms)" -ForegroundColor Green
            if ($testResult.Size) {
                Write-Host "     文件大小：$($testResult.Size)" -ForegroundColor Gray
            }
        }
        else {
            $results.Failed++
            Write-Host "❌ 失败" -ForegroundColor Red
            if ($testResult.Error) {
                Write-Host "     错误：$($testResult.Error)" -ForegroundColor Gray
            }
            elseif ($testResult.StatusCode) {
                Write-Host "     HTTP 状态码：$($testResult.StatusCode)" -ForegroundColor Gray
            }
        }
    }
    
    Write-Host ""
}

# 汇总统计
Write-Host "================================================================================"
Write-Host "📊 测试结果汇总" -ForegroundColor Cyan
Write-Host "================================================================================"
Write-Host "总测试数：$($results.Total)"
Write-Host "✅ 可用：$($results.Success) ($([math]::Round($results.Success / $results.Total * 100, 1))%)" -ForegroundColor Green
Write-Host "❌ 失败：$($results.Failed) ($([math]::Round($results.Failed / $results.Total * 100, 1))%)" -ForegroundColor Red
Write-Host ""

# 推荐建议
Write-Host "💡 推荐建议：" -ForegroundColor Yellow
Write-Host "--------------------------------------------------------------------------------"

foreach ($modelKey in $models.Keys) {
    $model = $models[$modelKey]
    $details = $results.Details[$modelKey]
    
    $availableMirrors = ($details.GetEnumerator() | Where-Object { $_.Value.Available }).Key
    
    if ($availableMirrors -and $availableMirrors.Count -gt 0) {
        $recommended = $availableMirrors[0]
        $mirrorName = switch ($recommended) {
            "modelscope" { "ModelScope（阿里云）" }
            "modelers" { "Modelers.cn（智谱 AI）" }
            "huggingface" { "HuggingFace" }
        }
        Write-Host "$($model.Name): 优先使用 $mirrorName" -ForegroundColor Green
    }
    else {
        Write-Host "$($model.Name): ⚠️ 所有镜像源都不可用" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "================================================================================"

# 保存结果到 JSON 文件
$jsonPath = Join-Path $PSScriptRoot "download-test-report.json"
$results | ConvertTo-Json -Depth 10 | Out-File -FilePath $jsonPath -Encoding utf8
Write-Host "📄 详细报告已保存到：$jsonPath" -ForegroundColor Gray
Write-Host ""

if ($results.Failed -eq 0) {
    Write-Host "✅ 所有链接测试完成！" -ForegroundColor Green
}
else {
    Write-Host "⚠️ 部分链接不可用，请查看上方的测试结果" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "按任意键关闭窗口..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
