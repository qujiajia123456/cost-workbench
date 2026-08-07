@echo off
setlocal
cd /d "%~dp0"

echo ===== ReportHub Diagnose =====
echo Project folder: %CD%
echo.

echo [1] Python launcher:
py -3 --version
echo ErrorLevel: %ERRORLEVEL%
echo.

echo [2] Python:
python --version
echo ErrorLevel: %ERRORLEVEL%
echo.

echo [3] Python location:
where python
echo.

echo [4] Project files:
dir server.py requirements.txt start_windows.bat
echo.

echo [5] Port 8899:
netstat -ano | findstr :8899
echo.

echo [6] Python package openpyxl:
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import openpyxl; print('openpyxl ok', openpyxl.__version__)"
  if errorlevel 1 (
    echo.
    echo .venv is broken or openpyxl is missing.
    echo If you see "No Python at ...Python312...", delete the .venv folder and run start_windows.bat again.
    echo If it still fails, install Python 3.10+ or provide .runtime\python\python.exe.
  )
) else (
  echo .venv\Scripts\python.exe not found
)
echo ErrorLevel: %ERRORLEVEL%
echo.

echo [7] Local web check:
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8899/' -TimeoutSec 3; 'HTTP ' + $r.StatusCode } catch { $_.Exception.Message }"
echo.

echo [8] Tips:
echo Browser address must be http://127.0.0.1:8899/ with an English colon :
echo If this computer cannot access the internet, prepare vendor\wheels for openpyxl.
echo If another computer wants to access this service, do not use 127.0.0.1 from that other computer.
echo.

echo Diagnose finished.
pause
