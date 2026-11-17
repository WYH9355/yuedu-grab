@echo off
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "VER=22.23.5"
set "ZIP=node-v%VER%-win-x64.zip"

if exist "%DIR%runtime\node.exe" (
  echo [OK] runtime 已存在，无需重建
  pause
  exit /b 0
)

where curl >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 缺少 curl，需要 Windows 10 1803 以上
  pause
  exit /b 1
)
where tar >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 缺少 tar，需要 Windows 10 1809 以上
  pause
  exit /b 1
)

echo 正在下载 Node %VER% win-x64（约 34MB）...
curl -L --retry 2 --max-time 900 -o "%DIR%node.zip" "https://nodejs.org/dist/v%VER%/%ZIP%"
if errorlevel 1 (
  echo [ERROR] 下载失败，可手动下载后解压到 %DIR%runtime
  echo         https://nodejs.org/dist/v%VER%/%ZIP%
  pause
  exit /b 1
)

echo 正在解压...
tar -xf "%DIR%node.zip" -C "%DIR%"
if errorlevel 1 (
  echo [ERROR] 解压失败
  pause
  exit /b 1
)

move /y "%DIR%node-v%VER%-win-x64" "%DIR%runtime" >nul
del "%DIR%node.zip"

if exist "%DIR%runtime\node.exe" (
  echo [OK] 运行时已就绪
  "%DIR%runtime\node.exe" -v
) else (
  echo [ERROR] 解压后未找到 runtime\node.exe
)
pause
