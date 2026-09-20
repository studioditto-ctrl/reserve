@echo off
chcp 65001 > nul
title 자동 실행 등록
cd /d "%~dp0"

echo 컴퓨터를 켤 때 예약 프로그램이 자동으로 실행되도록 등록합니다.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'ReserveApp.lnk'; $s = (New-Object -ComObject WScript.Shell).CreateShortcut($link); $s.TargetPath = '%~dp0start.cmd'; $s.WorkingDirectory = '%~dp0'; $s.Description = '예약 프로그램'; $s.Save(); Write-Host $link"

if errorlevel 1 (
  echo.
  echo [오류] 등록에 실패했습니다. 시작프로그램 폴더에 직접 넣으셔도 됩니다.
  echo        Win+R 로 shell:startup 을 열고 start.cmd 의 바로가기를 넣으세요.
) else (
  echo.
  echo 등록했습니다. 이제 컴퓨터를 켜면 자동으로 실행됩니다.
  echo 해제하려면 remove-autostart.cmd 를 실행하세요.
)
echo.
pause
