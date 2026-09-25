@echo off
title ProjectCost
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again. & pause & exit /b 1)
if not exist node_modules (echo Installing packages - first run only, about 1-2 minutes... & call npm install || (pause & exit /b 1))
if not exist .env.local copy .env.example .env.local >nul
call npm run db:migrate || (pause & exit /b 1)
echo.
echo ProjectCost is starting at http://localhost:3000
echo Keep this window open while you use the app. Close it to stop.
echo.
call npm run dev
