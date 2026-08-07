$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$pythonCmd = $null

try {
  & python -c "import sys" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $pythonCmd = @("python")
  }
} catch {}

if (-not $pythonCmd) {
  try {
    & py -3 -c "import sys" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $pythonCmd = @("py", "-3")
    }
  } catch {}
}

$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (-not $pythonCmd -and (Test-Path -LiteralPath $bundledPython)) {
  $pythonCmd = @($bundledPython)
}

if (-not $pythonCmd) {
  Write-Host "未找到可用的 Python。"
  Write-Host ""
  Write-Host "请安装 Python 3.10 或以上版本：https://www.python.org/downloads/windows/"
  Write-Host "安装时请勾选 Add python.exe to PATH。"
  Write-Host "如果弹出 Microsoft Store，说明当前电脑没有安装真正的 Python。"
  exit 1
}

if (Test-Path -LiteralPath ".\.venv\Scripts\python.exe") {
  try {
    & ".\.venv\Scripts\python.exe" -c "import sys" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath ".\.venv" -Recurse -Force
    }
  } catch {
    Remove-Item -LiteralPath ".\.venv" -Recurse -Force
  }
}

if (-not (Test-Path -LiteralPath ".\.venv\Scripts\python.exe")) {
  & $pythonCmd[0] @($pythonCmd[1..($pythonCmd.Length - 1)]) -m venv .venv
}

& ".\.venv\Scripts\python.exe" -c "import sys" | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "本地 Python 环境损坏，请重新安装 Python 或提供 .runtime\python\python.exe。"
  exit 1
}

$wheelDir = Join-Path $PSScriptRoot "vendor\wheels"
if (Test-Path -LiteralPath $wheelDir) {
  & ".\.venv\Scripts\python.exe" -m pip install --no-index --find-links $wheelDir -r requirements.txt
} else {
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
}
& ".\.venv\Scripts\python.exe" ".\server.py" 8899
