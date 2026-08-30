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

가짜 사이트에는 두 가지 모드가 있습니다.

| 모드 | URL | 시험하는 것 | 작업 파일 |
|---|---|---|---|
| 식당 예약 | `/booking?date=…&party=2` | 기본 흐름 | `config/mock.job.json` |
| 장소 예약 | `/booking?date=…&room=311` | 호실 순회 + 반복 일정 | `config/mock-room.job.json` |

`MOCK_FREE_ROOM=315 npm run mock` 으로 띄우면 315호만 비어 있어, 311호부터 순회하다 315호를 잡는 동작을 볼 수 있습니다.

---

## 실제 사이트에 붙이기

```bash
npx tsx src/cli.ts init myrestaurant
# → config/myrestaurant.profile.json, config/myrestaurant.job.json 생성
```

### 1. 프로필 채우기 — 셀렉터 찾는 법

가장 빠른 방법은 `inspect` 명령입니다. 페이지를 열어 셀렉터 후보와 **프로필 초안**을 뽑아 줍니다.

```bash
npx tsx src/cli.ts inspect https://example.com/login              # 로그인 폼 찾기
npx tsx src/cli.ts inspect 'https://example.com/booking?date=2026-09-05' \
    --profile config/myrestaurant.profile.json --wait 3          # 목록 찾기 (로그인 세션 사용)
```

목록이 늦게 그려지는 사이트는 `--wait <초>` 를 늘리고, 눈으로 확인하려면 `--headed` 를 붙이세요.

**아직 셀렉터를 몰라 로그인조차 못 하는 상태라면** `--pause` 를 쓰세요.
창을 띄운 채 기다리므로 직접 로그인하고 원하는 화면까지 이동한 뒤 Enter 를 누르면,
**그 시점의 화면**을 조사하고 세션까지 저장합니다. 셀렉터를 몰라 로그인을 못 하고,
로그인을 못 해 셀렉터를 못 찾는 순환을 여기서 끊습니다.

```bash
npx tsx src/cli.ts inspect https://example.com/booking --profile config/mysite.profile.json --pause
```

`inspect` 가 못 잡는 경우에는 **F12 → 요소 검사**로 아래 5가지를 직접 찾으면 됩니다.

| 항목 | 무엇을 찾나 | 예시 |
|---|---|---|
| `login.successSelector` | **로그인했을 때만** 보이는 요소 (닉네임, 로그아웃 버튼) | `.gnb__logout` |
| `login.usernameSelector` / `passwordSelector` | 아이디·비밀번호 입력칸 | `#loginId`, `#loginPw` |
| `search.urlTemplate` | 날짜를 바꿔가며 조회할 때 주소창에 찍히는 URL | `https://…/booking?date={date}&people={party}` |
| `search.slotSelector` | 시간대 하나에 해당하는 요소 (여러 개가 잡혀야 정상) | `.timeslot` |
| `search.unavailableSelector` | 그 요소 안의 "매진/마감" 표시 | `.is-soldout` |

공지 팝업이 떠서 클릭이 막히는 사이트라면 프로필에 닫기 버튼을 적어 둡니다.
**보일 때만** 누르고 없으면 조용히 넘어가므로, 후보를 여러 개 적어도 안전합니다.

```json
"dismiss": ["#popup_close", ".popup-close", "button.close"],
"closePopupWindows": true
```

`closePopupWindows` 는 `window.open` 으로 뜨는 **별도 창**을 자동으로 닫습니다.

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

#### 여러 곳 중 먼저 나는 한 곳만 (장소예약)

`target.rooms` 에 후보를 적으면 **적힌 순서대로** 확인하며, 먼저 비어 있는 곳을 잡습니다.
`stopAfterBooking: true` 와 함께 쓰면 한 곳만 예약하고 종료합니다.
프로필의 `urlTemplate` 안 `{room}` 이 각 값으로 치환됩니다.

```json
"target": { "rooms": ["311", "312", "313", "314", "315", "316", "317", "318"] }
```

사이트가 호실명 대신 내부 코드를 쓰면(`?location=26` 같은) 코드와 표시 이름을 함께 적습니다.
URL 에는 `id` 가, 로그와 알림에는 `label` 이 쓰입니다.

```json
"target": { "rooms": [
  { "id": "26", "label": "311호" },
  { "id": "27", "label": "312호" }
] }
```

내부 코드는 **`inspect` 가 드롭다운에서 뽑아 줍니다.**

```
── 드롭다운 (장소·호실 코드 확인용) ──────────
  #location  name="location"  (8개)
     20       311호
     21       312호
     …
```

#### 매월 n째주 반복 일정

날짜를 직접 적는 대신 `schedule` 을 쓰면 대상 날짜를 자동으로 계산합니다.
장기 감시 중에도 회차마다 다시 계산하므로 달이 바뀌어도 알아서 따라갑니다.

```json
"schedule": { "weekday": "토", "weeksOfMonth": [2, 4], "monthsAhead": 2 }
```

여기서 **"둘째주 토요일"은 그 달의 두 번째 토요일**을 뜻합니다 (주차를 세는 방식이 아니라 해당 요일의 n번째 등장).
`weekday` 는 `토` `sat` `Saturday` 를 모두 받습니다.

#### 오픈런 — 예약이 열리는 시각에 맞춰 몰아치기

선착순 예약처럼 **정해진 시각에 자리가 풀리는** 경우입니다.
`openAt` 을 지정하면 그때까지 조용히 기다리다가, 오픈 직전부터 `burst` 간격으로 몰아서 확인합니다.

```json
"watch": {
  "openAt": { "weekday": "토", "weeksOfMonth": [1, 3], "time": "21:00" },
  "burst":  { "beforeSec": 60, "afterSec": 600, "intervalMs": 1000 },
  "onlyAtOpen": true,
  "autoBook": true,
  "stopAfterBooking": true
}
```

- 오픈 `beforeSec` 초 전에 정확히 깨어나 `intervalMs` 간격으로 전환하고, 오픈 후 `afterSec` 초까지 유지합니다
- `onlyAtOpen: false` 로 두면 오픈 구간 밖에서도 `intervalSec` 간격으로 계속 확인합니다 (취소분 노리기)
- `intervalMs` 하한은 500ms 입니다
- `maxDates: 1` 을 함께 두면 **가장 가까운 날짜 하나만** 훑습니다. 예약 창이 한 회차씩 열리는 사이트에서, 오픈 순간에 아직 열리지도 않은 먼 날짜를 훑느라 초를 낭비하지 않습니다
- **시계가 정확해야 합니다.** 오픈 시각 판단은 실행하는 컴퓨터의 시계 기준입니다

#### 전체 예시

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
| `inspect <url>` | 페이지를 훑어 셀렉터 후보와 프로필 초안을 출력. `--profile`, `--wait <초>`, `--pause` |
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
src/inspect.ts         페이지에서 셀렉터 후보 추출
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
