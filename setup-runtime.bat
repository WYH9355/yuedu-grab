@echo off
setlocal
set "DIR=%~dp0"
set "VER=22.23.5"
set "ZIP=node-v%VER%-win-x64.zip"

if exist "%DIR%runtime\node.exe" goto already

where curl >nul 2>nul
if errorlevel 1 goto nocurl
where tar >nul 2>nul
if errorlevel 1 goto notar

echo Downloading Node %VER% win-x64 (about 34MB) ...
curl -L --retry 2 --max-time 900 -o "%DIR%node.zip" "https://nodejs.org/dist/v%VER%/%ZIP%"
if errorlevel 1 goto dlfail

echo Extracting ...
tar -xf "%DIR%node.zip" -C "%DIR%"
if errorlevel 1 goto unfail

move /y "%DIR%node-v%VER%-win-x64" "%DIR%runtime" >nul
del "%DIR%node.zip"
if exist "%DIR%runtime\node.exe" goto ok
goto unfail

:already
echo [OK] runtime already exists, nothing to do
goto end

:nocurl
echo [ERROR] curl not found. Need Windows 10 1803 or newer
goto end

:notar
echo [ERROR] tar not found. Need Windows 10 1809 or newer
goto end

:dlfail
echo [ERROR] download failed. Download manually:
echo         https://nodejs.org/dist/v%VER%/%ZIP%
echo         unzip it and rename the folder to runtime
goto end

:unfail
echo [ERROR] extract failed
goto end

:ok
echo [OK] runtime ready
"%DIR%runtime\node.exe" -v

:end
pause
