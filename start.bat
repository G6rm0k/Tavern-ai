@echo off
chcp 65001 >nul
title Tavern — запуск сервера

echo.
echo  ████████╗ █████╗ ██╗   ██╗███████╗██████╗ ███╗   ██╗
echo  ╚══██╔══╝██╔══██╗██║   ██║██╔════╝██╔══██╗████╗  ██║
echo     ██║   ███████║██║   ██║█████╗  ██████╔╝██╔██╗ ██║
echo     ██║   ██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║╚██╗██║
echo     ██║   ██║  ██║ ╚████╔╝ ███████╗██║  ██║██║ ╚████║
echo     ╚═╝   ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝
echo.

:: Проверка Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ОШИБКА] Node.js не найден!
    echo  Скачай и установи с https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  Node.js %NODE_VER% найден

:: Установка зависимостей если нужно
if not exist "node_modules\" (
    echo.
    echo  Первый запуск — устанавливаю зависимости...
    npm install
    if %errorlevel% neq 0 (
        echo  [ОШИБКА] npm install завершился с ошибкой
        pause
        exit /b 1
    )
)

echo.
echo  Запускаю сервер...
echo  Открой браузер: http://localhost:3000
echo  Для остановки нажми Ctrl+C
echo.

:: Открыть браузер через секунду
start "" /b cmd /c "timeout /t 1 >nul && start http://localhost:3000"

node server/index.js

echo.
echo  Сервер остановлен.
pause
