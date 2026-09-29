@echo off
rem Aion 2 - Progress Tracker launcher.
rem Uses Python 3 when installed, otherwise the built-in PowerShell server.
setlocal
cd /d "%~dp0"

python -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" >nul 2>&1
if %errorlevel%==0 (
  python server\server.py
  goto :eof
)

py -3 -c "import sys" >nul 2>&1
if %errorlevel%==0 (
  py -3 server\server.py
  goto :eof
)

echo Python 3 was not found - using the PowerShell server instead.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\serve.ps1"
