@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY="
if exist ".runtime\python\python.exe" set "PY=.runtime\python\python.exe"
if "%PY%"=="" if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if "%PY%"=="" set "PY=python"

echo ============================================================
echo Blacklist Codex worker helper
echo Folder: %CD%
echo ============================================================
echo.
"%PY%" tools\blacklist_codex_worker.py --next
echo.
echo Common commands:
echo   "%PY%" tools\blacklist_codex_worker.py --list
echo   "%PY%" tools\blacklist_codex_worker.py --open JOB_ID
echo   "%PY%" tools\blacklist_codex_worker.py --template JOB_ID
echo.
pause
