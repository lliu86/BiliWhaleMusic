@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building BiuWhale installer (work dir D:iuwhale-build) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scriptsuild-installer.ps1"
echo.
echo Output: dist\BiuWhale-Setup-1.0.0.exe
pause
