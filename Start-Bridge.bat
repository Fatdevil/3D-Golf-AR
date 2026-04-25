@echo off
title Golf OS - Launch Monitor Bridge
echo ==============================================
echo 🚀 STARTAR GOLF OS LM BRYGGA (GSPro API)
echo ==============================================
echo.
echo 1. Startar Node.js Servern...
cd gspro-bridge
call npm install
echo.
echo 2. Lyssnar nu pa port 921 (ST1 / SkyTrak anslutning)
echo    samt port 8081 (Golf OS webblasar-anslutning).
echo.
echo Tryck nu pa "Connect" i ditt SkyTrak / ST1-program!
echo.
node bridge.js
pause
