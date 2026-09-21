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

if (-not $env:HF_HOME) {
    throw "HF_HOME is not set. Put it in .env (D:/huggingface_cache)."
}

$Python = Join-Path $Root "ai-service\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "venv not found: $Python"
}

Write-Host "HF_HOME=$env:HF_HOME"
Write-Host "HUGGINGFACE_HUB_CACHE=$env:HUGGINGFACE_HUB_CACHE"
Write-Host "Downloading BAAI/bge-m3 into HF cache (not the user profile)..."

$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"

& $Python -c @"
import os
from pathlib import Path

import truststore
from huggingface_hub import snapshot_download

truststore.inject_into_ssl()

hf_home = os.environ.get('HF_HOME', '')
hub = os.environ.get('HUGGINGFACE_HUB_CACHE') or (str(Path(hf_home) / 'hub') if hf_home else '')
if not hf_home:
    raise SystemExit('HF_HOME is empty; refusing to download into the user profile.')
print('HF_HOME=', hf_home)
print('HUB=', hub)
path = snapshot_download(repo_id='BAAI/bge-m3')
print('downloaded:', path)
profile = Path.home() / '.cache' / 'huggingface'
print('profile_cache_exists=', profile.exists())
"@

if ($LASTEXITCODE -ne 0) {
    throw "bge-m3 download failed"
}

Write-Host "Done."
