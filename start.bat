@echo off
setlocal

set PORT=8080

:: Kill anything already on port 8080
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo Killing process %%p on port %PORT%...
  taskkill /PID %%p /F >nul 2>&1
)

:: Start Python server
echo Starting FloatTube on http://localhost:%PORT%
echo Press Ctrl+C to stop.
echo.
python -m http.server %PORT%
