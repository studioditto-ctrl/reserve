# 이 저장소에서 일하는 방식

## 머지와 배포는 묻지 말고 진행한다

작업이 끝나면 PR 을 열고, **CI 가 초록이면 그대로 머지한다.** 머지해도 되냐고
묻지 않는다. 머지 뒤에는 `docs/` 가 바뀐 경우 Pages 배포가 성공했는지까지
확인하고, 그 결과를 한 번에 보고한다.

확인을 기다리느라 멈추지 않는다. 문제가 생기면 고쳐서 다시 올리고, 스스로
판단이 안 서는 것만 묻는다.

### 그래도 확인을 받는 것

- **실제 예약 확정** — `confirm: true` 로 Actions 를 돌리는 것. 되돌릴 수 없고
  실제로 방이 잡힌다. 예행연습(`confirm` 끔)은 묻지 않고 돌려도 된다.
- **되돌리기 어려운 것** — 저장소 삭제, 히스토리 재작성, 설정 일괄 초기화.

## 오래 도는 자기 점검을 걸지 않는다

PR 상태를 몇 시간·며칠씩 반복해서 확인하는 예약(`send_later` 자기 호출 루프)을
걸지 않는다. CI 한 번 기다리는 정도는 괜찮지만, 끝나면 멈춘다.

## 개인정보

이름·연락처·아이디·비밀번호는 저장소에 커밋하지 않는다. GitHub Secret
(`SITE_USERNAME`, `SITE_PASSWORD`, `BOOKING_VALUES`) 으로만 넘긴다.
`data/` 는 gitignore 되어 있다.

## 구조

```
docs/index.html          클라우드 어드민 (GitHub Pages)
config/*.profile.json    사이트 셀렉터
config/*.job.json        무엇을 언제 잡을지
src/                     CLI · 감시 루프 · 로컬 어드민
.github/workflows/       reserve.yml(예약) · ci.yml(검사) · pages.yml(배포)
```

`config/*.job.json` 에 `schedule` 이 있으면 반복 일정으로 날짜를 계산하고,
없으면 `target.dates` 를 그대로 쓴다 (`src/operations.ts` 의 `resolveDates`).

## 손대기 전에

`npm run typecheck` 와 `npm test` 를 돌린다. 브라우저 동작을 바꿨으면
`npm run mock` 으로 모의 사이트를 띄워 실제로 확인한다. manna.or.kr 은
개발 컨테이너에서 막혀 있어 직접 붙지 못한다.
