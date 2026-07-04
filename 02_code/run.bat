@echo off
setlocal
REM Almanach launcher (cmd / double-click) — self-bootstrapping.
REM Lives in 02_code/. Project root = the PARENT of this folder. The data dir is
REM the "04_Almanach Library" subfolder at the project root, so
REM almanach-library.yaml + almanach-sync.yaml placed there are read on launch.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "ALMANACH_DATA_DIR=%ROOT%\04_Almanach Library"
echo ALMANACH_DATA_DIR=%ALMANACH_DATA_DIR%
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  python -m venv .venv
)
call ".venv\Scripts\activate.bat"
echo Installing/updating dependencies...
python -m pip install -q -r requirements.txt
REM Pre-launch smoke gate (CR-260704-0800-005): run the regression suite and
REM only open the app on PASS. On FAIL the failing checks stay visible here.
REM UAT failure toggle: set ALMANACH_SMOKE_FAIL=1 to force a deliberate failure.
echo Running pre-launch checks...
python -m pytest tests -q --tb=line
if errorlevel 1 (
  echo.
  echo Pre-launch checks FAILED — Almanach will not start. See the failures above.
  pause
  exit /b 1
)
echo Pre-launch checks passed.
echo Starting Almanach at http://127.0.0.1:8000/
python -m almanach
pause
