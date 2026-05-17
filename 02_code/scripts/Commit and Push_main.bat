@echo off
cd /d "%~dp0\..\.."

if not exist ".git" (
    git init
    git branch -M main
    git remote add origin https://github.com/bakou-nine/Almanach-Project.git
)

echo.
set /p msg=Commit message:
if "%msg%"=="" set "msg=Update"

git add .
git commit -m "%msg%"
git push -u origin main

echo Done.
pause
