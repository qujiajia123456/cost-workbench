@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_PORT=8899"
set "APP_URL=http://127.0.0.1:%APP_PORT%"
set "PYTHON_CMD="
set "PORTABLE_PY=%CD%\.runtime\python\python.exe"
set "BUNDLED_INSTALLER=%CD%\vendor\python-installer.exe"
set "USE_PORTABLE=0"

echo ============================================================
echo ReportHub one-click installer and launcher
echo Folder: %CD%
echo ============================================================
echo.

call :FindPython
if "%PYTHON_CMD%"=="" (
  if exist "%BUNDLED_INSTALLER%" (
    echo Python was not found. Installing bundled Python...
    "%BUNDLED_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1
    if errorlevel 1 (
      echo Bundled Python installation failed.
      pause
      exit /b 1
    )
    call :FindPython
  )
)

if "%PYTHON_CMD%"=="" (
  echo Python was not found. Trying to install Python with winget...
  echo.
  winget --version >nul 2>nul
  if errorlevel 1 (
    echo winget was not found on this computer.
    echo Please install Python 3.10 or later manually, then run this file again.
    echo Download: https://www.python.org/downloads/windows/
    pause
    exit /b 1
  )

  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo.
    echo Python installation failed.
    echo You can install Python manually from https://www.python.org/downloads/windows/
    echo Then run this file again.
    pause
    exit /b 1
  )

  call :FindPython
)

if "%PYTHON_CMD%"=="" (
  echo Python is still not available after installation.
  echo Close this window, open a new one, and run this file again.
  pause
  exit /b 1
)

echo Python command: %PYTHON_CMD%
echo.

if "%USE_PORTABLE%"=="1" (
  echo Using bundled portable Python. No installation or internet connection is required.
  echo.
  echo Starting ReportHub...
  echo Browser address: %APP_URL%
  echo Keep this window open while using the app.
  echo.
  start "" cmd /c "timeout /t 2 /nobreak >nul & start "" "%APP_URL%""
  "%PORTABLE_PY%" server.py %APP_PORT%
  echo.
  echo ReportHub has stopped.
  pause
  exit /b 0
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys" >nul 2>nul
  if errorlevel 1 (
    echo Existing .venv is broken. Rebuilding local Python environment...
    rmdir /s /q ".venv"
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 (
    echo Failed to create .venv.
    pause
    exit /b 1
  )
)

".venv\Scripts\python.exe" -c "import sys" >nul 2>nul
if errorlevel 1 (
  echo.
  echo The local Python environment is broken.
  echo Please install Python 3.10 or later, or provide .runtime\python\python.exe.
  pause
  exit /b 1
)

echo Installing Python packages...
if exist "vendor\wheels" (
  echo Found vendor\wheels. Installing packages offline...
  ".venv\Scripts\python.exe" -m pip install --no-index --find-links "vendor\wheels" -r requirements.txt
) else (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if errorlevel 1 (
  echo.
  echo Package installation failed.
  echo Check the network connection, or prepare offline wheels in vendor\wheels.
  pause
  exit /b 1
)

echo.
echo Starting ReportHub...
echo Browser address: %APP_URL%
echo Keep this window open while using the app.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" "%APP_URL%""
".venv\Scripts\python.exe" server.py %APP_PORT%

echo.
echo ReportHub has stopped.
pause
exit /b 0

:FindPython
set "PYTHON_CMD="
if exist "%PORTABLE_PY%" (
  set "PYTHON_CMD=%PORTABLE_PY%"
  set "USE_PORTABLE=1"
  exit /b 0
)

python -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_CMD=python"
  exit /b 0
)

py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_CMD=py -3"
  exit /b 0
)

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set "PYTHON_CMD=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  exit /b 0
)

exit /b 0
