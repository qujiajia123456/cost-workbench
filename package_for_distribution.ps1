param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "dist"),
  [switch]$IncludeBusinessData
)

$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$packageName = "ReportHub_Distribution_$stamp"
$targetRoot = Join-Path $OutputRoot $packageName

if (Test-Path -LiteralPath $targetRoot) {
  throw "Target folder already exists: $targetRoot"
}

New-Item -ItemType Directory -Path $targetRoot | Out-Null

$files = @(
  "server.py",
  "requirements.txt",
  "install_and_start_windows.bat",
  "start_windows.bat",
  "start_windows.ps1",
  "diagnose_windows.bat",
  "start_blacklist_codex_worker.bat",
  "start_material_codex_worker.bat",
  "README.md"
)

foreach ($file in $files) {
  $src = Join-Path $sourceRoot $file
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $targetRoot $file) -Force
  }
}

foreach ($pattern in @("*.txt", "*.md")) {
  Get-ChildItem -Path (Join-Path $sourceRoot $pattern) -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetRoot $_.Name) -Force
  }
}

$dirs = @(
  "static",
  "templates",
  "tools",
  "vendor",
  "_skill_yanjian_bid_price_comparison",
  "outputs"
)

foreach ($dir in $dirs) {
  $src = Join-Path $sourceRoot $dir
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $targetRoot $dir) -Recurse -Force
  }
}

$targetData = Join-Path $targetRoot "data"
New-Item -ItemType Directory -Path $targetData | Out-Null

if ($IncludeBusinessData) {
  $sourceData = Join-Path $sourceRoot "data"
  $excludeDirs = @(
    "edge-material-worker-profile",
    "edge-tyc-worker-profile",
    "edge-pm-debug-profile",
    "chrome-bigpm-debug-profile",
    "__pycache__",
    "pm_warning_logs",
    "material_worker_logs",
    "pm_warning_captures",
    "tyc_cache"
  )
  $excludeFilePatterns = @(
    "*.log",
    "*.tmp",
    "*.saved-*",
    "*.backup-*",
    "*before_dedupe*",
    "db.before-*",
    "server.saved-*",
    "app.saved-*",
    "styles.saved-*",
    "index.saved-*",
    "tmp_*",
    "test_*"
  )
  robocopy $sourceData $targetData /E /XD $excludeDirs /XF $excludeFilePatterns | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
  }
} else {
  $emptyDb = @'
{
  "uploads": [],
  "issues": [],
  "materialPriceTasks": [],
  "blacklistEntities": [],
  "blacklistCodexJobs": []
}
'@
  Set-Content -LiteralPath (Join-Path $targetData "db.json") -Value $emptyDb -Encoding ASCII
}

$pycacheDirs = Get-ChildItem -LiteralPath $targetRoot -Directory -Filter "__pycache__" -Recurse -Force -ErrorAction SilentlyContinue
foreach ($pycacheDir in $pycacheDirs) {
  Remove-Item -LiteralPath $pycacheDir.FullName -Recurse -Force
}

Write-Host "Distribution package created: $targetRoot"
Write-Host "Copy this folder to another computer and run start_windows.bat."
