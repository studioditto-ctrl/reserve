@echo off
chcp 65001 > nul
title 자동 실행 해제

powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'ReserveApp.lnk') -ErrorAction SilentlyContinue"

echo 자동 실행 등록을 해제했습니다.
echo.
pause
