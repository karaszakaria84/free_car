@echo off
chcp 65001 >nul
title Open World City - Server
echo ========================================
echo   Open World City - Server
echo ========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js مش متثبت!
    echo [!] نزله من: https://nodejs.org
    pause
    exit /b
)

if not exist "node_modules\ws" (
    echo [*] بيثبت المكتبات أول مرة...
    call npm install ws
    echo.
)

echo [*] بيشغل السيرفر...
start "OpenWorldServer" cmd /k "node server.js"

timeout /t 3 /nobreak >nul

if exist "server-ip.txt" (
    set /p SERVER_IP=<server-ip.txt
    echo.
    echo ========================================
    echo   IP السيرفر: %SERVER_IP%
    echo   افتح اللعبة من: http://%SERVER_IP%/
    echo ========================================
    echo.
    start "" "http://%SERVER_IP%/"
) else (
    start "" "http://localhost:8080/"
)

echo.
echo [OK] كل حاجة شغالة!
echo.
pause