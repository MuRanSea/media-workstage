# PowerShell Build Script for Media Workstage
#   build.ps1           single media-workstage.exe (browser mode)
#   build.ps1 -Desktop  also the Tauri desktop installer (ADR 0007)
param([switch]$Desktop)
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building Media Workstage Single Binary   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Remove stale binary to prevent false-green reporting on compilation failure
if (Test-Path "media-workstage.exe") {
    Remove-Item "media-workstage.exe" -Force
}

# 1. Build frontend Vite production bundle
Write-Host "[1/3] Building frontend React SPA..." -ForegroundColor Yellow
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
Write-Host "[2/3] Compiling Go static single executable (CGO_ENABLED=0)..." -ForegroundColor Yellow
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

if (-not $Desktop) { return }

# 3. Desktop installer: the same binary becomes the Tauri sidecar
Write-Host "[3/3] Building Tauri desktop installer (NSIS)..." -ForegroundColor Yellow
$sidecar = "src-tauri/binaries/media-workstage-server-x86_64-pc-windows-msvc.exe"
New-Item -ItemType Directory -Force (Split-Path $sidecar) | Out-Null
Copy-Item media-workstage.exe $sidecar -Force

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargoBin = Join-Path (Join-Path $env:USERPROFILE ".cargo") "bin"
    if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
        $env:PATH = "$cargoBin;$env:PATH"
    } else {
        throw "Rust toolchain not found; install it with: winget install Rustlang.Rustup"
    }
}

Set-Location src-tauri
try {
    bunx @tauri-apps/cli@2.12.1 build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE"
    }
} finally {
    Set-Location ..
}

$installer = Get-ChildItem "src-tauri/target/release/bundle/nsis/*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "==========================================" -ForegroundColor Green
Write-Host (" Desktop installer: {0} ({1:N2} MB)" -f $installer.FullName, ($installer.Length / 1MB)) -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
