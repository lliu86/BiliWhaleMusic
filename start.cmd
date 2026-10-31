@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Force 1x device scale: on 150% DPI VMs Windows enlarges transparent windows
rem and can push the widget off-screen.
start "BiuWhale" "%~dp0runtime\nekobiu.exe" . --no-sandbox --force-device-scale-factor=1 --user-data-dir="%~dp0userdata"
