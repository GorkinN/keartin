$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) {
            return
        }
        $parts = $line.Split("=", 2)
        if ($parts.Length -ne 2) {
            return
        }
        $name = $parts[0].Trim()
        if ($name -in @("HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE")) {
            Set-Item -Path "Env:$name" -Value $parts[1].Trim()
        }
    }
}

Write-Host "=== nvidia-smi ==="
nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv
Write-Host ""
Write-Host "=== ollama ps ==="
ollama ps
Write-Host ""
Write-Host "=== HF_HOME ==="
Write-Host $env:HF_HOME
Write-Host ""
Write-Host "=== FastAPI /gpu/status (if up) ==="
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8000/gpu/status" -TimeoutSec 3 | ConvertTo-Json -Compress
} catch {
    Write-Host "FastAPI not reachable"
}
