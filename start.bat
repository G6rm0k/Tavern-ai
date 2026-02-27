@echo off
title Tavern

echo.
echo   Tavern - AI Companion
echo   Starting server...
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Download and install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo Node.js %NODE_VER% found

if not exist "node_modules\" (
    echo First run - installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
)

echo.
echo Server running at: http://localhost:3000
echo Press Ctrl+C to stop
echo.

start "" /b cmd /c "timeout /t 1 >nul && start http://localhost:3000"

node server/index.js

echo.
echo Server stopped.
pause
