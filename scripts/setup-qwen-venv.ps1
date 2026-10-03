$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Venv = Join-Path $Root "ai-service\.venv-qwen"
if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
    Write-Host "Creating $Venv"
    & py -3.12 -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 is required to create ai-service/.venv-qwen." }
}

$VenvPython = Join-Path $Venv "Scripts\python.exe"
Write-Host "Installing CUDA torch into the Qwen venv..."
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw "torch install failed" }

Write-Host "Installing the qwen extra (diffusers with QwenImage21Pipeline, transformers>=5.17)..."
& $VenvPython -m pip install -e ".\ai-service[qwen]" --extra-index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw "qwen extra install failed" }

Write-Host "Restoring the CUDA torch wheel in case the extra replaced it..."
& $VenvPython -m pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) { throw "torch reinstall failed" }

Write-Host "Done. QWEN_PYTHON=$VenvPython"
