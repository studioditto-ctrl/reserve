/**
 * "매월 둘째주·넷째주 토요일" 같은 반복 일정을 실제 날짜로 바꿉니다.
 *
 * 여기서 "둘째주 토요일"은 **그 달의 두 번째 토요일**을 뜻합니다
 * (달의 주차를 세는 방식이 아니라, 해당 요일의 n번째 등장).
 */

const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6,
};

export interface RecurringSchedule {
  /** 요일. "sat" 또는 "토" */
  weekday: string;
  /** 그 달의 몇 번째 해당 요일인가. [2, 4] = 둘째주·넷째주 */
  weeksOfMonth: number[];
  /** 몇 달 앞까지 계산할지. 기본 2 */
  monthsAhead?: number;
}

export interface OpenSchedule extends RecurringSchedule {
  /** 예약이 열리는 시각. "21:00" */
  time: string;
}

export function parseWeekday(w: string): number {
  const key = w.trim().toLowerCase().slice(0, 3);
  const day = WEEKDAYS[key] ?? WEEKDAYS[w.trim().charAt(0)];
  if (day === undefined) throw new Error(`요일을 알 수 없습니다: "${w}" (sat / 토 형식으로 적어주세요)`);
  return day;
}

export function toDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 그 달의 n번째 해당 요일. 그 달에 없으면 undefined. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date | undefined {
  const first = new Date(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  const day = 1 + shift + (nth - 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? d : undefined;
}

/** 오늘 이후로 다가오는 일정 날짜들을 YYYY-MM-DD 로 돌려줍니다. */
export function upcomingDates(sched: RecurringSchedule, from: Date = new Date()): string[] {
  const weekday = parseWeekday(sched.weekday);
  const months = sched.monthsAhead ?? 2;
  const today = toDateString(from);
  const out: string[] = [];

  for (let i = 0; i <= months; i++) {
    const cursor = new Date(from.getFullYear(), from.getMonth() + i, 1);
    for (const nth of sched.weeksOfMonth) {
      const d = nthWeekdayOfMonth(cursor.getFullYear(), cursor.getMonth(), weekday, nth);
      if (d && toDateString(d) >= today) out.push(toDateString(d));
    }
  }
  return [...new Set(out)].sort();
}

/** 다음 예약 오픈 시각. 이미 지난 오픈은 건너뜁니다. */
export function nextOpenAt(sched: OpenSchedule, from: Date = new Date()): Date | undefined {
  const weekday = parseWeekday(sched.weekday);
  const [h = '0', m = '0'] = sched.time.split(':');
  const months = sched.monthsAhead ?? 2;

  const candidates: Date[] = [];
  for (let i = 0; i <= months; i++) {
    const cursor = new Date(from.getFullYear(), from.getMonth() + i, 1);
    for (const nth of sched.weeksOfMonth) {
      const d = nthWeekdayOfMonth(cursor.getFullYear(), cursor.getMonth(), weekday, nth);
      if (!d) continue;
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(h), Number(m), 0, 0);
      if (at.getTime() > from.getTime()) candidates.push(at);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}

export function formatKST(d: Date): string {
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}
