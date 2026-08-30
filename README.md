# reserve — 실시간 예약 감시·자동예약 CLI

예약 사이트에 **내 계정으로 로그인**한 뒤, 원하는 날짜/시간의 빈자리를 **실시간으로 감시**하다가
자리가 나면 알림을 보내거나 **예약까지 자동으로** 진행하는 도구입니다.

사이트마다 코드를 새로 짜지 않습니다. **셀렉터를 담은 JSON 프로필 한 장**이면 새 사이트가 붙습니다.

```
config/*.profile.json   어떤 사이트인가 (로그인·목록·예약 흐름의 셀렉터)
config/*.job.json       무엇을 잡고 싶은가 (날짜·시간·인원·감시 주기)
```

---

## 빠른 시작 (가짜 사이트로 5분 만에 체험)

실제 사이트를 건드리지 않고 전 과정을 돌려볼 수 있는 로컬 데모 사이트가 들어 있습니다.

```bash
npm install
npx playwright install chromium      # 브라우저 1회 설치

cp .env.example .env                 # 아래 값만 채우면 됩니다
#   SITE_USERNAME=demo
#   SITE_PASSWORD=demo1234
#   BOOKING_NAME=홍길동
#   BOOKING_PHONE=010-0000-0000

npm run mock                         # 터미널 1: 가짜 예약 사이트 (localhost:8787)
```

```bash
# 터미널 2
npm run login                        # 로그인해서 세션 저장
npm run check                        # 지금 빈자리 확인
npx tsx src/cli.ts watch config/mock.job.json --auto-book   # 감시 + 자동예약 (dry-run)
```

빈자리가 20초 뒤에 열리는 상황을 보고 싶다면 `MOCK_OPEN_AFTER=20 npm run mock` 으로 띄우세요.

---

## 실제 사이트에 붙이기

```bash
npx tsx src/cli.ts init myrestaurant
# → config/myrestaurant.profile.json, config/myrestaurant.job.json 생성
```

### 1. 프로필 채우기 — 셀렉터 찾는 법

브라우저에서 대상 사이트를 열고 **F12 → 요소 검사**로 아래 5가지를 찾으면 끝입니다.

| 항목 | 무엇을 찾나 | 예시 |
|---|---|---|
| `login.successSelector` | **로그인했을 때만** 보이는 요소 (닉네임, 로그아웃 버튼) | `.gnb__logout` |
| `login.usernameSelector` / `passwordSelector` | 아이디·비밀번호 입력칸 | `#loginId`, `#loginPw` |
| `search.urlTemplate` | 날짜를 바꿔가며 조회할 때 주소창에 찍히는 URL | `https://…/booking?date={date}&people={party}` |
| `search.slotSelector` | 시간대 하나에 해당하는 요소 (여러 개가 잡혀야 정상) | `.timeslot` |
| `search.unavailableSelector` | 그 요소 안의 "매진/마감" 표시 | `.is-soldout` |

콘솔에서 `document.querySelectorAll('.timeslot').length` 로 개수를 세어 보면 셀렉터가 맞는지 바로 확인됩니다.

`{date}` `{party}` `{time}` 은 작업 파일의 값으로 치환됩니다.
URL만으로 목록이 안 나오는 사이트(인원 수를 드롭다운으로 골라야 하는 등)는 `search.preSteps` 에 조작 단계를 적으세요.

### 2. 예약 단계 기술하기

`book.steps` 는 자리를 클릭한 다음의 화면 흐름을 순서대로 적은 것입니다.

```json
{ "action": "fill",  "selector": "#booker-name", "valueFrom": "env:BOOKING_NAME" },
{ "action": "check", "selector": "#agree-terms" },
{ "action": "check", "selector": "#agree-marketing", "optional": true },
{ "action": "click", "selector": "#submit-reservation", "final": true }
```

- `action`: `goto` `click` `fill` `select` `check` `press` `waitFor` `wait`
- `valueFrom: "env:XXX"` — 이름·연락처 같은 값을 `.env` 에서 가져옵니다 (프로필에 개인정보를 적지 않아도 됩니다)
- `optional: true` — 요소가 없어도 그냥 넘어갑니다 (선택 약관 등)
- **`final: true` — 되돌릴 수 없는 최종 확정 버튼.** dry-run 은 이 단계 **직전에** 멈춥니다. 결제/확정 버튼에는 반드시 붙이세요.

### 3. 작업 파일에 조건 적기

```json
{
  "name": "9월 첫 주 저녁 2인",
  "adapter": "config/myrestaurant.profile.json",
  "target": {
    "dates": ["2026-09-05", "2026-09-06"],
    "party": 2,
    "timeFrom": "18:00",
    "timeTo": "20:30",
    "exclude": ["바 좌석"]
  },
  "watch": {
    "intervalSec": 30,
    "jitterSec": 5,
    "autoBook": false,
    "quietHours": ["01:00", "07:00"],
    "until": "2026-09-04T23:59:59+09:00"
  }
}
```

### 4. 실행

```bash
JOB=config/myrestaurant.job.json
npx tsx src/cli.ts login $JOB --manual   # 2FA·캡차가 있으면 --manual 로 직접 로그인
npx tsx src/cli.ts check $JOB            # 잘 파싱되는지 먼저 확인
npx tsx src/cli.ts watch $JOB            # 알림만
npx tsx src/cli.ts watch $JOB --auto-book           # 자동예약 (dry-run: 확정 직전 정지)
npx tsx src/cli.ts watch $JOB --auto-book --confirm # 진짜로 확정까지
```

---

## 명령어

| 명령 | 설명 |
|---|---|
| `login [job]` | 로그인해 세션을 `.sessions/` 에 저장. `--manual` 은 창을 띄워 직접 로그인 |
| `check [job]` | 지금 빈자리를 한 번만 조회하고 슬롯 ID 를 출력 |
| `watch [job]` | 빈자리가 날 때까지 감시. `--auto-book`, `--interval <초>`, `--confirm` |
| `book <slotId> [job]` | `check` 에서 본 슬롯 ID 를 직접 지정해 예약 |
| `init <name>` | 새 사이트용 프로필/작업 파일 생성 |

공통 옵션: `--headed` (브라우저 창 표시 — 디버깅에 유용)

---

## 안전장치

- **기본이 dry-run입니다.** `final: true` 단계 직전에 멈추고 스크린샷을 남깁니다.
  실제로 확정하려면 `--confirm` 을 붙이거나 `.env` 의 `DRY_RUN=false` 로 바꿔야 합니다.
- **폴링 간격 하한 5초.** 그보다 짧게 설정해도 5초로 올라가며, `jitterSec` 만큼 무작위로 흔들어 일정한 패턴을 만들지 않습니다.
- **연속 실패 시 자동 중단.** `maxConsecutiveErrors` 회 연속 실패하면 간격을 늘리다가 알림을 보내고 종료합니다.
- **자리 재확인.** 예약 직전에 목록을 다시 읽어 **라벨로** 같은 자리를 찾습니다. 목록 순서가 바뀌어도 엉뚱한 자리를 잡지 않고, 이미 나간 자리는 "자리가 사라졌습니다" 로 안전하게 실패합니다.
- **실패하면 스크린샷.** `screenshots/` 에 그 순간 화면이 남아 원인 파악이 쉽습니다.

## 자격증명 보관

`.env` 파일에 두고 `.gitignore` 로 커밋에서 제외합니다. 로그인 후에는 세션 쿠키가 `.sessions/` 에 저장되어
매번 다시 로그인하지 않습니다 (이 디렉터리도 커밋되지 않습니다).

2FA·캡차가 있는 사이트라면 `.env` 에 비밀번호를 아예 넣지 말고 `login --manual` 로 한 번만 직접 로그인하세요.
그 뒤로는 저장된 세션으로 동작하다가, 세션이 만료되면 다시 `login --manual` 을 실행하면 됩니다.

## 알림

`.env` 에 값을 채우면 빈자리 발견·예약 성공·감시 중단 시 알림이 갑니다. 둘 다 선택 사항입니다.

```bash
WEBHOOK_URL=            # Slack / Discord 웹훅 또는 임의의 JSON 엔드포인트
TELEGRAM_BOT_TOKEN=     # 텔레그램 봇
TELEGRAM_CHAT_ID=
```

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm test            # 조건 매칭·조용한 시간대 판정 단위 테스트
npm run mock        # 로컬 가짜 예약 사이트
```

구조:

```
src/cli.ts             명령어 진입점
src/watcher.ts         폴링 루프 (지터·백오프·조용한 시간대·중복 알림 방지)
src/adapters/profile.ts  JSON 프로필로 동작하는 범용 어댑터
src/adapters/registry.ts 프로필 로딩
src/notify/index.ts    웹훅·텔레그램 알림
src/browser.ts         Playwright 세션 (쿠키 저장/재사용, 스크린샷)
src/mock/server.ts     테스트용 가짜 예약 사이트
```

JSON으로 표현하기 어려운 사이트(로그인이 API 호출이거나 슬롯이 WebSocket으로 오는 등)는
`src/types.ts` 의 `SiteAdapter` 인터페이스를 직접 구현하면 감시 루프·알림·CLI를 그대로 재사용할 수 있습니다.

## 알아두실 점

- 사이트의 **이용약관과 robots 정책**을 먼저 확인하세요. 자동화를 금지하거나 계정을 제한하는 곳이 있습니다.
- 결제가 포함된 예약은 `final: true` 를 결제 **직전** 단계에 두고, `--confirm` 없이 dry-run 으로 충분히 확인한 뒤 실행하세요.
- 사이트가 개편되면 셀렉터가 깨집니다. `check` 가 갑자기 0건을 내놓으면 프로필부터 확인하세요.
