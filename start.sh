#!/usr/bin/env bash
# macOS·리눅스용 실행 파일. 터미널에서 ./start.sh 또는 파일을 더블클릭하세요.
set -e
cd "$(dirname "$0")"

echo "=========================================="
echo "  예약 프로그램"
echo "=========================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[오류] Node.js 가 설치돼 있지 않습니다."
  echo "       https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  read -r -p "엔터를 누르면 닫힙니다..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[1/2] 처음 실행이라 필요한 파일을 내려받습니다. 몇 분 걸립니다..."
  npm install
fi

if [ ! -f .playwright-installed ]; then
  echo "[2/2] 예약에 쓸 브라우저를 설치합니다..."
  npx playwright install chromium && echo ok > .playwright-installed
fi

echo
echo "프로그램을 시작합니다. 잠시 뒤 브라우저가 자동으로 열립니다."
echo "  * 이 창을 닫으면 자동 예약도 멈춥니다. 켜 두세요."
echo "  * 끝내려면 Ctrl+C 를 누르세요."
echo
exec npx tsx src/cli.ts serve
