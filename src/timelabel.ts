/**
 * "9시", "11시30분", "오후 2시", "14:00" 같은 시각 표기를 분 단위 숫자로 바꿉니다.
 *
 * 한국 사이트의 시간표는 오전/오후 표시 없이 "12시 → 1시 → 2시" 로 이어지는 경우가
 * 많습니다. 목록 전체를 순서대로 넘기면 앞 칸보다 커지도록 오전·오후를 정해 줍니다.
 */

const KOREAN = /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/;
const COLON = /(\d{1,2}):(\d{2})/;
const AM = /(오전|새벽|a\.?m)/i;
const PM = /(오후|저녁|밤|p\.?m)/i;

/** 하루 중 이 시각보다 이른 첫 칸은 오후로 봅니다 (교회·공공시설 시간표는 아침에 시작). */
const EARLIEST_START_MIN = 6 * 60;

interface Parsed {
  /** 12시간제 기준 분. 오전·오후가 아직 안 정해진 값입니다. */
  base: number;
  /** 표기에 오전/오후가 명시돼 있으면 그 값. */
  fixed?: number;
}

function parseOne(label: string): Parsed | undefined {
  const colon = COLON.exec(label);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    // 24시간제 표기는 그대로 확정입니다.
    return h >= 13 || /^0\d/.test(colon[1]!) ? { base: h * 60 + m, fixed: h * 60 + m } : { base: (h % 12) * 60 + m };
  }
  const ko = KOREAN.exec(label);
  if (!ko) return undefined;
  const h = Number(ko[1]);
  const m = ko[2] ? Number(ko[2]) : 0;
  if (h > 24 || m > 59) return undefined;
  if (h >= 13) return { base: h * 60 + m, fixed: h * 60 + m };

  const base = (h % 12) * 60 + m;
  if (AM.test(label)) return { base, fixed: base };
  if (PM.test(label)) return { base, fixed: base + 720 };
  return { base };
}

export function minutesToHHMM(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * 시간표 라벨들을 **나열된 순서 그대로** 넘기면 각각의 분 단위 시각을 돌려줍니다.
 * 읽을 수 없는 칸은 undefined 입니다.
 */
export function parseTimeLabels(labels: string[]): (number | undefined)[] {
  const parsed = labels.map(parseOne);
  const out: (number | undefined)[] = [];
  let prev: number | undefined;

  for (const p of parsed) {
    if (!p) {
      out.push(undefined);
      continue;
    }
    if (p.fixed !== undefined) {
      out.push(p.fixed);
      prev = p.fixed;
      continue;
    }
    // 오전·오후가 없으면 앞 칸보다 커지는 가장 이른 시각을 고릅니다.
    const candidates = [p.base, p.base + 720, p.base + 1440];
    const floor = prev ?? EARLIEST_START_MIN;
    const picked = candidates.find((c) => (prev === undefined ? c >= floor : c > prev)) ?? p.base;
    out.push(picked);
    prev = picked;
  }
  return out;
}
