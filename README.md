# reserve — 실시간 예약 감시·자동예약 CLI

예약 사이트에 **내 계정으로 로그인**한 뒤, 원하는 날짜/시간의 빈자리를 **실시간으로 감시**하다가
자리가 나면 알림을 보내거나 **예약까지 자동으로** 진행하는 도구입니다.

사이트마다 코드를 새로 짜지 않습니다. **셀렉터를 담은 JSON 프로필 한 장**이면 새 사이트가 붙습니다.

```
config/*.profile.json   어떤 사이트인가 (로그인·목록·예약 흐름의 셀렉터)
config/*.job.json       무엇을 잡고 싶은가 (날짜·시간·인원·감시 주기)
```

---

## GitHub 에서 돌리기 (기본)

내 컴퓨터를 켜 둘 필요가 없습니다. `.github/workflows/reserve.yml` 이
오픈 시각에 맞춰 GitHub 안에서 예약을 실행합니다.

### 한 번만 설정

저장소 **Settings → Secrets and variables → Actions** 에서:

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `SITE_USERNAME` | 사이트 아이디 |
| Secret | `SITE_PASSWORD` | 사이트 비밀번호 |
| Secret | `BOOKING_VALUES` | 신청서 값 JSON — `{"name":"김만나 집사","reason":"소그룹 모임","count":"8","phone":"010-0000-0000"}` |
| Secret | `SESSION_STATE` | (선택) 캡차 등으로 자동 로그인이 막힐 때, `.sessions/*.json` 내용 |
| Secret | `WEBHOOK_URL` | (선택) 슬랙·디스코드 알림 |
| Variable | `RESERVE_CONFIRM` | `true` 여야 실제로 예약합니다. 없으면 예행연습 |

**개인정보는 저장소에 두지 않습니다.** 날짜·시각·호실 같은 설정만 `config/*.json` 에
커밋하고, 이름·연락처는 `BOOKING_VALUES` Secret 으로 들어갑니다.

### 자동 실행

매주 **토요일 20:35(한국시간)** 에 깨어납니다. 오픈 주차(첫째·셋째)가 아니면
곧바로 끝나고, 맞으면 21:00 정각까지 기다렸다 몰아칩니다.

```
다음 예약 오픈: 2026. 10. 3. PM 9:00 (13일 14시간 뒤)
이번에는 할 일이 없습니다 — 대기 한도(90분)를 넘습니다.   ← 오픈 주차가 아닌 토요일
```

GitHub 의 cron 은 몇 분에서 십여 분까지 늦을 수 있어 **25분 일찍** 깨웁니다.
깨어난 뒤에는 프로그램이 직접 시계를 보고 기다리므로 정각을 놓치지 않습니다.

> `TZ: Asia/Seoul` 이 워크플로에 들어 있어야 합니다. 러너는 UTC 라서
> 이게 없으면 "21:00" 을 UTC 로 읽어 **한국시간 다음 날 06:00** 에 실행됩니다.

### 수동 실행

저장소 **Actions → 예약 → Run workflow** 를 누르면 입력 폼이 뜹니다.

| 입력 | 뜻 |
|---|---|
| `mode` | `check` 조회만 / `dryrun` 예행연습 / `book` 지정한 날짜를 지금 예약 / `watch` 오픈까지 대기 |
| `date` | `book` 모드에서 쓸 날짜 (YYYY-MM-DD) |
| `time`, `duration` | 비우면 작업 설정을 씁니다 |
| `confirm` | 체크해야 실제로 예약합니다 |

실행이 끝나면 **Artifacts** 에 화면 캡처가 올라옵니다. 예행연습 결과를 눈으로 확인할 수 있습니다.

### 설정을 바꾸려면

`config/manna.job.json` 을 GitHub 웹에서 바로 고치면 됩니다.
아래 로컬 앱의 화면에서 편집한 뒤 **"GitHub 에서 돌리기 → 내보내기"** 로
붙여넣을 내용을 받을 수도 있습니다.

---

## 내 PC 에서 돌리기 (테스트·조사용)

클라우드로 넘기기 전에 셀렉터를 확인하거나 예행연습을 해 볼 때 씁니다.

### 앱처럼 쓰기 — 더블클릭 실행

터미널 명령을 칠 필요가 없습니다.

| 파일 | 하는 일 |
|---|---|
| **`start.cmd`** | 윈도우 — 더블클릭하면 첫 실행 시 필요한 것을 알아서 설치하고, 프로그램을 켜고, 브라우저를 엽니다 |
| **`start.sh`** | macOS·리눅스 — 같은 일을 합니다 |
| `install-autostart.cmd` | 컴퓨터를 켤 때 자동으로 실행되도록 등록 (윈도우) |
| `remove-autostart.cmd` | 자동 실행 해제 |

처음 실행하면 `npm install` 과 브라우저 설치가 자동으로 돌아 몇 분 걸리고,
다음부터는 바로 켜집니다. Node.js 가 없으면 어디서 받는지 알려주고 멈춥니다.

**이 창을 닫으면 자동 예약도 멈춥니다.** 오픈 시각(예: 토요일 21시)에 창이 켜져 있어야
예약이 돌아갑니다. `install-autostart.cmd` 로 등록해 두면 컴퓨터를 켤 때마다 알아서 뜹니다.

포트 4100 이 이미 쓰이고 있으면 4101, 4102 … 로 알아서 넘어갑니다.

> **단일 .exe 로는 만들지 않았습니다.** 예약에 쓰는 Chromium 이 150MB 가 넘어
> 실행 파일 하나에 넣을 수 없고, 넣더라도 실행할 때 결국 풀어야 합니다.
> 대신 위 런처가 같은 더블클릭 경험을 주면서, 설치가 한 번만 일어나도록 했습니다.

## 어드민 페이지로 쓰기 (권장)

터미널에서 JSON 을 고치는 대신, 브라우저 화면에서 값을 넣고 저장하면
**오픈 시각에 자동으로 예약**합니다.

```bash
npm run serve        # → http://localhost:4100 (start.cmd 가 하는 일과 같습니다)
```

화면에서 하는 일:

1. **로그인 정보** — 아이디·비밀번호를 저장합니다. 오픈 시각에 사람 없이 로그인하려면 필요합니다
2. **예약 내용** — 요일·주차·시각·길이·호실 순서
3. **신청서 값** — 예약자·사용목적·인원·연락처
4. **언제 예약할지** — 오픈 요일·주차·시각, 예행연습 모드
5. **예행연습** — 오픈 전에 미리 돌려 보고 **신청 직전 화면을 스크린샷으로 확인**

`npm run serve` 를 켜 둔 동안 스케줄러가 돌면서, 오픈 **10분 전에** 브라우저를
준비하고 몰아치기에 들어갑니다. 2주 뒤 오픈을 위해 창을 계속 열어 두지는 않습니다.

### 호실 우선순위

호실 목록은 **체크한 것만, 위에서부터 순서대로** 시도합니다.
`↑ ↓` 로 순서를 바꾸면 먼저 잡을 방이 바뀌고, 체크를 끄면 아예 건너뜁니다.
정원이 안 맞는 방(예: 8명 모임에 1~5인 방)을 빼 두는 데 씁니다.

### 어느 날짜가 열려 있나 — 훑어보기

언제부터 예약이 열리는지 모를 때 씁니다. 날짜를 하루씩 넘기며
**시간표가 뜨는 날**을 찾습니다. 예약은 하지 않습니다.

```bash
npx tsx src/cli.ts probe config/manna.job.json --from 2026-10-01 --days 14 --room 29
```

결과는 세 가지로 갈리고, 그 구분이 핵심입니다.

| 결과 | 뜻 |
|---|---|
| 시간표 있음 · N칸 | 그날은 예약 가능. N칸이 남아 있음 |
| 시간표 있음 · 0칸 | 그날은 열렸지만 **다 찼음** |
| 시간표 없음 | 아직 안 열렸거나, 주소·권한 문제 |

전부 "시간표 없음" 이고 도착한 주소가 모두 같다면, 날짜 문제가 아니라
주소나 권한 문제입니다. 그 주소를 함께 출력하므로 바로 구분됩니다.

Actions 에서는 `mode: probe` 로 같은 일을 합니다 (`date` 가 시작일, `days`, `room`).

### 수동 모드 — 날짜·시각 직접 지정

반복 일정이나 오픈 시각과 **무관하게** 특정 날짜를 처리합니다.
취소분을 노리거나, 일정에 없는 날을 한 번만 잡을 때 씁니다.

| 버튼 | 하는 일 |
|---|---|
| 지금 조회 | 그 날짜·시각에 비어 있는 호실만 보여줍니다 |
| 지금 예약 | 첫 번째로 비어 있는 호실을 바로 잡습니다 |
| 빈자리 날 때까지 대기 | 계속 확인하다 자리가 나면 잡습니다 |

호실 순서는 위에서 정한 것을 그대로 씁니다. 여기에도 예행연습 모드가 있고,
끄면 **실제 예약 전에 한 번 더 확인**을 묻습니다.

터미널에서도 같은 일을 할 수 있습니다.

```bash
npx tsx src/cli.ts book-now 2026-11-05 config/manna.job.json --time 14:00 --check
npx tsx src/cli.ts book-now 2026-11-05 config/manna.job.json --time 14:00 --confirm
```

### 저장되는 곳과 안전장치

- 아이디·비밀번호는 `data/secrets.json`, 작업은 `data/jobs/*.json` 에 저장됩니다
- `data/` 는 `.gitignore` 에 있고, 파일 권한은 본인만 읽도록(0600) 좁힙니다
- **비밀번호는 암호화되지 않은 평문으로 이 컴퓨터에 저장됩니다.** 사람 없이 로그인하려면 불가피합니다. 공용 PC 라면 저장하지 말고 `login --manual` 을 쓰세요
- 어드민 페이지는 `127.0.0.1` 에만 열립니다 (같은 네트워크의 다른 기기에서 접속 불가)
- **예행연습 모드가 기본값**입니다. 실제로 예약하려면 체크를 꺼야 합니다

## Windows (PowerShell) 쓰신다면

아래 예시들은 줄 끝의 `\` 로 명령을 이어 쓰는 bash 문법입니다.
PowerShell 에서는 **한 줄로 붙여서** 쓰거나, 줄을 나누려면 `\` 대신 백틱(`` ` ``)을 쓰세요.
URL 에 `&` 가 들어가므로 **따옴표로 감싸야** 합니다.

```powershell
git clone -b claude/realtime-booking-service-g6u0gr https://github.com/studioditto-ctrl/reserve.git
cd reserve
npm install
npx playwright install chromium
Copy-Item .env.example .env
```

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

#### 시간대가 체크박스인 사이트 (30분 칸 두 개로 1시간)

시간표가 링크가 아니라 체크박스이고, 30분 칸을 여러 개 골라 한 번에 신청하는 사이트가 있습니다.
프로필에 `checkboxTimes` 를 적고, 작업 파일에 `durationMin` 으로 예약 길이를 주면 됩니다.

```json
"search": {
  "checkboxTimes": { "selector": "input[name=\"reservation[time]\"]", "labelFrom": "label" }
}
```
```json
"target": { "timeFrom": "11:00", "durationMin": 60 }
```

- 칸 간격(30분)은 시간표에서 **직접 알아냅니다** — 따로 적지 않아도 됩니다
- `11시~12시` 면 `11시`·`11시30분` 두 칸을 모두 체크합니다. **한 칸이라도 막혀 있으면 후보로 내놓지 않습니다** (1시간을 통째로 못 잡으면 의미가 없으므로)
- 이미 찬 칸은 `disabled` 면 자동으로 걸러지고, class 로만 표시된다면 `unavailableSelector` 에 적으세요

`9시`, `11시30분` 같은 **오전·오후 표시 없는 한국어 시각**도 읽습니다.
`12시 → 1시 → 2시` 로 이어지는 목록은 순서를 보고 오후로 판정합니다.

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
| `serve` | 어드민 페이지를 열고 저장된 작업을 오픈 시각에 자동 실행. `--port <번호>` |
| `book-now <date> [job]` | 날짜를 직접 지정해 지금 예약 (수동 모드). `--time`, `--duration`, `--check`, `--confirm` |

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
src/admin/server.ts    어드민 페이지 (HTTP API)
src/admin/ui.html      어드민 화면
src/store.ts           작업·로그인 정보 저장 (data/)
src/runner.ts          오픈 시각에 맞춰 작업을 실행하는 스케줄러
src/operations.ts      로그인 확인·조회·예행연습 (어드민과 CLI 공용)
src/timelabel.ts       "11시30분" 같은 한국어 시각 읽기
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
