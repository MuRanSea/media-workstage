# PowerShell Build Script for Media Workstage
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building Media Workstage Single Binary   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Remove stale binary to prevent false-green reporting on compilation failure
if (Test-Path "media-workstage.exe") {
    Remove-Item "media-workstage.exe" -Force
}

# 1. Build frontend Vite production bundle
Write-Host "[1/2] Building frontend React SPA..." -ForegroundColor Yellow
Set-Location web

try {
    if (Get-Command bun -ErrorAction SilentlyContinue) {
        bun run build
    } elseif (Get-Command npm -ErrorAction SilentlyContinue) {
        npm run build
    } else {
        throw "Neither bun nor npm found on PATH"
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }
} finally {
    Set-Location ..
}

# 2. Build Go single binary with embedded SPA and zero CGO
Write-Host "[2/2] Compiling Go static single executable (CGO_ENABLED=0)..." -ForegroundColor Yellow
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o media-workstage.exe ./cmd/server

if ($LASTEXITCODE -ne 0) {
    throw "Go static compilation failed with exit code $LASTEXITCODE"
}

if (Test-Path "media-workstage.exe") {
    $size = (Get-Item "media-workstage.exe").Length / 1MB
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host (" Build Succeeded: media-workstage.exe ({0:N2} MB)" -f $size) -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
} else {
    throw "Build failed: media-workstage.exe not produced"
}
