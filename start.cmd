@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 使用系统默认 DPI 缩放，避免 150% 缩放下桌宠被推到屏幕外
start "BiliWhaleMusic" "%~dp0runtime\nekobiu.exe" . --no-sandbox --user-data-dir="%~dp0userdata"
