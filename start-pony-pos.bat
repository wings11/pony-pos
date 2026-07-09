@echo off
REM Pony POS System Startup Script
REM This script sets the correct printer name and starts the application

echo Starting Pony POS System...

REM Set the printer interface to your XP-58 printer
set PRINTER_INTERFACE=printer:XP-58 (copy 1)

REM Start the application
npm start

pause