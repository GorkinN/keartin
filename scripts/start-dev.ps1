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

$python = Join-Path $Root "ai-service\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "Нет venv: ai-service\.venv. Создайте его и установите зависимости из ai-service/pyproject.toml."
}

Write-Host "Docker: Qdrant + MinIO..."
docker compose -f docker/docker-compose.yml up -d

Write-Host "Prisma migrate..."
npx pnpm@9.15.9 --filter backend prisma:deploy

function Test-Listening([int] $Port) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $wait.AsyncWaitHandle.WaitOne(300, $false)
        if (-not $ok) {
            return $false
        }
        $tcp.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $tcp.Close()
    }
}

function Start-AppWindow([string] $Title, [int] $Port, [string] $Command) {
    if (Test-Listening $Port) {
        Write-Host "$Title уже слушает :$Port"
        return
    }
    $shell = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$Root'; $Command"
    Start-Process -FilePath "powershell.exe" -WorkingDirectory $Root -ArgumentList "-NoExit", "-Command", $shell
    Write-Host "Окно: $Title"
}

Start-AppWindow "llm-keartin ai" 8000 "& '$python' -m uvicorn app.main:app --reload --reload-dir ai-service/app --app-dir ai-service --host 127.0.0.1 --port 8000"
Start-AppWindow "llm-keartin nest" 3000 "npx pnpm@9.15.9 --filter backend start:dev"
Start-AppWindow "llm-keartin ui" 5173 "npx pnpm@9.15.9 --filter frontend dev"

Write-Host ""
Write-Host "HF_HOME=$env:HF_HOME"
Write-Host "UI:     http://127.0.0.1:5173"
Write-Host "Nest:   http://127.0.0.1:3000/health"
Write-Host "FastAPI http://127.0.0.1:8000/health"
Write-Host "Qdrant  http://127.0.0.1:6333/readyz"
Write-Host "MinIO   http://127.0.0.1:9001  (minioadmin / minioadmin)"
Write-Host "Ollama этим скриптом не запускается."
