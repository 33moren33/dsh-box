@echo off
rem Build setup.exe + portable zip from current source into Releases\.
chcp 65001 >nul
cd /d "%~dp0"
node tools\build-releases.mjs
pause
