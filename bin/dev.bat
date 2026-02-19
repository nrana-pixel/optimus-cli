@echo off
REM Windows batch file wrapper for cli-project
REM This file allows running the CLI on Windows without file association issues

setlocal enabledelayedexpansion

REM Get the directory where this batch file is located
set SCRIPT_DIR=%~dp0

REM Run the Node.js script with all arguments passed through
node "%SCRIPT_DIR%dev.js" %*

REM Exit with the same code as Node.js
exit /b %ERRORLEVEL%
