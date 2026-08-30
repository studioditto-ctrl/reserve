import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchesTarget } from '../src/adapters/profile.js';
import { inQuietHours } from '../src/watcher.js';
import type { Slot } from '../src/types.js';

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 'x', label: '2026-09-05 19:00 · 홀 2인', date: '2026-09-05', time: '19:00', ...over,
});

test('시간 범위 안의 슬롯만 통과한다', () => {
  const target = { dates: ['2026-09-05'], timeFrom: '18:00', timeTo: '20:00' };
  assert.equal(matchesTarget(slot(), target), true);
  assert.equal(matchesTarget(slot({ time: '17:30' }), target), false);
  assert.equal(matchesTarget(slot({ time: '20:30' }), target), false);
  assert.equal(matchesTarget(slot({ time: '18:00' }), target), true, '경계값 포함');
  assert.equal(matchesTarget(slot({ time: '20:00' }), target), true, '경계값 포함');
});

test('시간을 못 읽은 슬롯은 시간 조건이 있으면 제외한다', () => {
  const noTime = slot({ time: undefined, label: '2026-09-05 잔여석' });
  assert.equal(matchesTarget(noTime, { dates: ['2026-09-05'], timeFrom: '18:00' }), false);
  assert.equal(matchesTarget(noTime, { dates: ['2026-09-05'] }), true, '시간 조건이 없으면 통과');
});

test('keywords 는 모두 포함, exclude 는 하나만 걸려도 제외', () => {
  const s = slot({ label: '2026-09-05 19:00 · 창가 2인석' });
  assert.equal(matchesTarget(s, { dates: [], keywords: ['창가', '2인'] }), true);
  assert.equal(matchesTarget(s, { dates: [], keywords: ['창가', '룸'] }), false);
  assert.equal(matchesTarget(s, { dates: [], exclude: ['창가'] }), false);
});

test('조용한 시간대는 자정을 넘겨도 올바르게 판정한다', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 5, h, m);
  assert.equal(inQuietHours(['01:00', '07:00'], at(3)), true);
  assert.equal(inQuietHours(['01:00', '07:00'], at(9)), false);
  assert.equal(inQuietHours(['01:00', '07:00'], at(7)), false, '끝 시각은 제외');
  // 23:00 ~ 06:00 처럼 자정을 넘는 범위
  assert.equal(inQuietHours(['23:00', '06:00'], at(23, 30)), true);
  assert.equal(inQuietHours(['23:00', '06:00'], at(2)), true);
  assert.equal(inQuietHours(['23:00', '06:00'], at(12)), false);
  assert.equal(inQuietHours(undefined, at(3)), false);
});

// ── 반복 일정 계산 ────────────────────────────────────────
import { nextOpenAt, nthWeekdayOfMonth, parseWeekday, toDateString, upcomingDates } from '../src/schedule.js';

test('요일 표기는 한글과 영문을 모두 받는다', () => {
  assert.equal(parseWeekday('토'), 6);
  assert.equal(parseWeekday('sat'), 6);
  assert.equal(parseWeekday('Saturday'), 6);
  assert.equal(parseWeekday('토요일'), 6, '첫 글자로 판정');
  assert.throws(() => parseWeekday('xyz'));
  assert.throws(() => parseWeekday(''));
});

test('그 달의 n번째 요일을 구한다', () => {
  // 2026년 9월: 토요일은 5·12·19·26일
  assert.equal(toDateString(nthWeekdayOfMonth(2026, 8, 6, 2)!), '2026-09-12', '둘째주 토요일');
  assert.equal(toDateString(nthWeekdayOfMonth(2026, 8, 6, 4)!), '2026-09-26', '넷째주 토요일');
  assert.equal(nthWeekdayOfMonth(2026, 8, 6, 5), undefined, '다섯째 토요일은 없음');
});

test('다가오는 둘째·넷째주 토요일을 나열한다', () => {
  const dates = upcomingDates(
    { weekday: '토', weeksOfMonth: [2, 4], monthsAhead: 2 },
    new Date(2026, 8, 1),
  );
  assert.deepEqual(dates, [
    '2026-09-12', '2026-09-26',
    '2026-10-10', '2026-10-24',
    '2026-11-14', '2026-11-28',
  ]);
});

test('이미 지난 날짜는 제외한다', () => {
  const dates = upcomingDates({ weekday: '토', weeksOfMonth: [2, 4], monthsAhead: 0 }, new Date(2026, 8, 20));
  assert.deepEqual(dates, ['2026-09-26'], '9/12 는 지났으므로 빠진다');
});

test('다음 예약 오픈 시각을 구한다', () => {
  const sched = { weekday: '토', weeksOfMonth: [1, 3], time: '21:00', monthsAhead: 1 };
  // 2026년 9월 첫째 토요일 5일, 셋째 토요일 19일
  assert.equal(nextOpenAt(sched, new Date(2026, 8, 1))?.toISOString(),
               new Date(2026, 8, 5, 21, 0).toISOString());
  assert.equal(nextOpenAt(sched, new Date(2026, 8, 5, 21, 30))?.toISOString(),
               new Date(2026, 8, 19, 21, 0).toISOString(), '이미 지난 오픈은 건너뛴다');
});
