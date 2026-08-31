@echo off
setlocal EnableExtensions
title FLOVER-FLIX local server

REM ==========================================================
REM  FLOVER-FLIX local static server
REM
REM  data/*.json is loaded via fetch(), so the page must be
REM  served over http:// (opening index.html as file:// fails
REM  with a CORS error and shows no data).
REM
REM  Usage:  serve.bat          -> http://localhost:8080
REM          serve.bat 3000     -> pick a port
REM  Stop:   Ctrl+C in this window (or just close it)
REM ==========================================================

REM cd to the folder this script lives in (= repo root)
cd /d "%~dp0"

REM port: first argument, default 8080
set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"

REM pick a Python launcher: prefer the "py" launcher, else "python"
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo.
  echo  [ERROR] Python was not found on PATH.
  echo          Install it from https://www.python.org then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   FLOVER-FLIX   http://localhost:%PORT%/
echo   Stop with Ctrl+C
echo.

REM open the default browser (server starts just below; refresh if needed)
start "" "http://localhost:%PORT%/"

REM local-only bind. This line runs the server and holds the window.
%PY% -m http.server %PORT% --bind 127.0.0.1

endlocal
