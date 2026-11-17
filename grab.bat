@echo off
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "NODE=%DIR%runtime\node.exe"

if exist "%NODE%" goto run

echo [ERROR] runtime\node.exe not found.
echo         Run setup-runtime.bat once to download portable Node.
pause
exit /b 1

:run
"%NODE%" "%DIR%pipe.mjs" %*
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
