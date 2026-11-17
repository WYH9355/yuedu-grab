@echo off
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "NODE=%DIR%runtime\node.exe"

if not exist "%NODE%" (
  echo [ERROR] runtime\node.exe not found. Unzip portable node into %DIR%runtime
  pause
  exit /b 1
)

"%NODE%" "%DIR%pipe.mjs" %*
set "RC=%ERRORLEVEL%"

if "%~1"=="" pause
exit /b %RC%
