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
    throw "HF_HOME is not set. Put it in .env."
}

$Python = Join-Path $Root "ai-service\.venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "venv not found: $Python"
}

$ModelId = if ($env:QWEN_IMAGE_MODEL_ID) { $env:QWEN_IMAGE_MODEL_ID } else { "Qwen/Qwen-Image-2.1" }
$env:QWEN_IMAGE_MODEL_ID = $ModelId

Write-Host "HF_HOME=$env:HF_HOME"
Write-Host "HUGGINGFACE_HUB_CACHE=$env:HUGGINGFACE_HUB_CACHE"
Write-Host "Downloading $ModelId into HF cache (not the user profile)..."

$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"

& $Python -c @"
import os
from pathlib import Path

import truststore
from huggingface_hub import snapshot_download

truststore.inject_into_ssl()

hf_home = os.environ.get('HF_HOME', '')
if not hf_home:
    raise SystemExit('HF_HOME is empty; refusing to download into the user profile.')
raw_paths = os.environ.get('QWEN_MODEL_PATH', '') + ';' + os.environ.get('QWEN_MODEL_PATHS', '')
skip_transformer = any(part.strip().lower().endswith('.gguf') for part in raw_paths.split(';'))
ignore = ['transformer/*.safetensors', 'transformer/*.bin'] if skip_transformer else None
if ignore:
    print('GGUF transformer is configured; skipping transformer weights')
path = snapshot_download(repo_id=os.environ['QWEN_IMAGE_MODEL_ID'], ignore_patterns=ignore)
print('downloaded:', path)
root = Path(os.environ['HF_HOME']).resolve()
resolved = Path(path).resolve()
if resolved != root and root not in resolved.parents:
    raise SystemExit(f'download landed outside HF_HOME: {resolved}')
"@

if ($LASTEXITCODE -ne 0) {
    throw "Qwen-Image download failed"
}

Write-Host "Done."
