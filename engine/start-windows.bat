@echo off
REM CortesAI - Iniciar el motor local (doble clic en Windows)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js no esta instalado. Instalalo desde https://nodejs.org ^(LTS^).
  pause
  exit /b 1
)
node server.js
echo.
echo El motor se detuvo.
pause
