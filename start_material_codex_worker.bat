@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY="
if exist ".runtime\python\python.exe" set "PY=.runtime\python\python.exe"
if "%PY%"=="" if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if "%PY%"=="" set "PY=python"

echo ============================================================
echo Material price Codex worker helper
echo Folder: %CD%
echo ============================================================
echo.
"%PY%" tools\material_codex_worker.py --next
echo.
echo Common commands:
echo   "%PY%" tools\material_codex_worker.py --list
echo   "%PY%" tools\material_codex_worker.py --copy
echo   "%PY%" tools\material_codex_worker.py --copy JOB_ID
echo   "%PY%" tools\material_codex_worker.py --open-platform
echo.
pause
