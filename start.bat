@echo off
chcp 65001 >nul
title wesaid
setlocal enabledelayedexpansion

echo.
echo   ==========================================
echo     wesaid
echo   ==========================================
echo.

cd /d "%~dp0"

REM ── Node.js check ─────────────────────────────────────────────────────────
REM The old script only checked whether node existed and printed the version
REM without ever validating it. Node 16 then failed later with a stack trace.
where node >nul 2>&1
if %errorlevel% neq 0 goto :no_node

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
set "VER=!NODE_VER:v=!"
for /f "tokens=1 delims=." %%a in ("!VER!") do set "MAJOR=%%a"

if !MAJOR! LSS 18 (
    echo   [!] Установлен Node.js !NODE_VER!, а нужен 18 или новее.
    echo.
    echo   Обновите его: https://nodejs.org
    echo   Скачивайте версию LTS, затем запустите этот файл снова.
    echo.
    pause
    exit /b 1
)

echo   Node.js !NODE_VER! — подходит
echo.

REM ── Dependencies ──────────────────────────────────────────────────────────
if not exist "node_modules\" (
    echo   Первый запуск: скачиваю необходимые файлы.
    echo   Это займёт около минуты, нужен интернет.
    echo.
    call npm install --no-audit --no-fund
    if !errorlevel! neq 0 (
        echo.
        echo   [!] Не удалось скачать файлы.
        echo       Проверьте интернет и запустите этот файл снова.
        echo.
        pause
        exit /b 1
    )
    echo.
)

REM Open the browser only once the server actually answers — the old script
REM waited a fixed second and often opened "page not available" on a slow PC.
REM curl ships with Windows 10 1803 and later; without it we simply fall back to
REM opening the page after a short wait.
where curl >nul 2>&1
if %errorlevel% equ 0 (
    start "" /b cmd /c "for /l %%i in (1,1,60) do (curl -s -o nul http://localhost:3000 && start http://localhost:3000 && exit) & timeout /t 1 >nul"
) else (
    start "" /b cmd /c "timeout /t 4 >nul && start http://localhost:3000"
)

node server/index.js

echo.
echo   Сервер остановлен.
pause
exit /b 0

REM ── Node.js missing ───────────────────────────────────────────────────────
:no_node
echo   Для работы нужен Node.js — он не установлен.
echo.

where winget >nul 2>&1
if %errorlevel% neq 0 goto :manual_node

echo   Могу установить автоматически (около 30 МБ, один раз).
echo.
set /p "ANSWER=  Установить сейчас? [Y/n]: "
if /i "!ANSWER!"=="n" goto :manual_node

echo.
echo   Устанавливаю Node.js, подождите...
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo   Готово. Закройте это окно и запустите start.bat заново —
echo   это нужно, чтобы Windows увидела новую программу.
echo.
pause
exit /b 0

:manual_node
echo   Установите его вручную:
echo.
echo     1. Откройте https://nodejs.org
echo     2. Скачайте версию с пометкой LTS
echo     3. Установите, нажимая "Далее"
echo     4. Запустите start.bat снова
echo.
pause
exit /b 1
