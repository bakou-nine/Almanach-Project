@echo off
REM Almanach launcher: sets working dir to 02_code, activates venv (if any),
REM opens browser, then runs the server in the foreground (Ctrl+C to stop).

setlocal
title Almanach

REM Working directory = 02_code/ (parent of this scripts folder)
cd /d "%~dp0\.."

REM Activate venv if present (PowerShell-style or cmd-style)
if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

REM Open browser ~3s after launch so uvicorn has time to bind the port
REM (hidden PowerShell — no second terminal window appears)
start "" /b powershell -WindowStyle Hidden -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8000/'"

REM Run the app in the foreground; closing this window stops the server.
REM --reload makes uvicorn watch the source tree and restart the worker when a
REM .py file changes, so server-code edits (e.g. the static no-cache middleware)
REM take effect without a manual relaunch. Static CSS/JS are cache-busted via
REM the ?v= mtime token in base.html, so a plain browser reload always gets the
REM current bytes.
python -m almanach --reload %*

endlocal
