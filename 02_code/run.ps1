# Almanach launcher (PowerShell) — self-bootstrapping.
# Lives in 02_code/. Project root = the PARENT of this folder. The data dir is
# the "04_Almanach Library" subfolder at the project root, so
# almanach-library.yaml + almanach-sync.yaml placed there are read on launch.
# Run:  powershell -ExecutionPolicy Bypass -File .\02_code\run.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dataDir = Join-Path $root "04_Almanach Library"
$env:ALMANACH_DATA_DIR = $dataDir
Write-Host "ALMANACH_DATA_DIR = $dataDir"

Set-Location $PSScriptRoot
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}
. ".venv\Scripts\Activate.ps1"
Write-Host "Installing/updating dependencies..."
python -m pip install -q -r requirements.txt
# Pre-launch smoke gate (CR-260704-0800-005): run the regression suite and only
# open the app on PASS. On FAIL the failing checks stay visible in this window.
# UAT failure toggle: set ALMANACH_SMOKE_FAIL=1 to force a deliberate failure.
Write-Host "Running pre-launch checks..."
python -m pytest tests -q --tb=line
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Pre-launch checks FAILED - Almanach will not start. See the failures above." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
Write-Host "Pre-launch checks passed."
Write-Host "Starting Almanach at http://127.0.0.1:8000/"
python -m almanach
