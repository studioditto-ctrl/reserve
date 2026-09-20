@echo off
chcp 65001 > nul
title 예약 프로그램
cd /d "%~dp0"

echo ==========================================
echo   예약 프로그램
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js 가 설치돼 있지 않습니다.
  echo.
  echo   https://nodejs.org 에서 LTS 버전을 내려받아 설치한 뒤
  echo   이 파일을 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] 처음 실행이라 필요한 파일을 내려받습니다. 몇 분 걸립니다...
  call npm install
  if errorlevel 1 (
    echo [오류] 설치에 실패했습니다. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
)

if not exist .playwright-installed (
  echo [2/2] 예약에 쓸 브라우저를 설치합니다...
  call npx playwright install chromium
  if not errorlevel 1 echo ok> .playwright-installed
)

echo.
echo 프로그램을 시작합니다. 잠시 뒤 브라우저가 자동으로 열립니다.
echo.
echo   * 이 창을 닫으면 자동 예약도 멈춥니다. 켜 두세요.
echo   * 끝내려면 이 창에서 Ctrl+C 를 누르세요.
echo.

call npx tsx src/cli.ts serve

echo.
echo 프로그램이 종료되었습니다.
pause
