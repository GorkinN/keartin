$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $Root ".env.example") $envFile
    Write-Host "Created .env from .env.example"
}

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
    $value = $parts[1].Trim()
    Set-Item -Path "Env:$name" -Value $value
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\sqlite") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\library") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\posts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\tmp") | Out-Null

Write-Host "Starting Docker (Qdrant + MinIO)..."
docker compose -f docker/docker-compose.yml up -d

Write-Host ""
Write-Host "HF_HOME=$env:HF_HOME"
Write-Host "Qdrant:       http://127.0.0.1:6333/readyz"
Write-Host "MinIO console: http://127.0.0.1:9001  (minioadmin / minioadmin)"
Write-Host ""
Write-Host "Start the three apps in separate terminals from the repo root:"
Write-Host "  1. ai-service:  .\\ai-service\\.venv\\Scripts\\python -m uvicorn app.main:app --reload --reload-dir ai-service/app --app-dir ai-service --host 127.0.0.1 --port 8000"
Write-Host "  2. backend:     npx pnpm@9.15.9 --filter backend start:dev"
Write-Host "  3. frontend:    npx pnpm@9.15.9 --filter frontend dev"
Write-Host ""
Write-Host "Health checks:"
Write-Host "  FastAPI  http://127.0.0.1:8000/health"
Write-Host "  NestJS   http://127.0.0.1:3000/health"
Write-Host "  Vite     http://127.0.0.1:5173"
