@echo off
setlocal
cd /d "%~dp0"

rem Make the project-local Corepack pnpm shim available to child processes.
set "PATH=%~dp0;%PATH%"

set "NODE_EXE=C:\Users\Gs\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo Install Node.js 22 or start this project from Codex.
    pause
    exit /b 1
  )
  set "NODE_EXE=node.exe"
)

if not exist "%~dp0node_modules\vinext\dist\cli.js" (
  echo Project dependencies are missing. Please ask Codex to install them.
  pause
  exit /b 1
)

echo Starting Huaya at http://localhost:3000
echo Keep this window open. Press Ctrl+C to stop the site.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3000'"
"%NODE_EXE%" "%~dp0node_modules\vinext\dist\cli.js" dev

endlocal
