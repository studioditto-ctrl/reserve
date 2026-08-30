const COLORS = {
  gray: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m',
} as const;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c: keyof typeof COLORS, s: string) => (useColor ? COLORS[c] + s + COLORS.reset : s);

function stamp(): string {
  return new Date().toLocaleTimeString('ko-KR', { hour12: false });
}

function line(tag: string, color: keyof typeof COLORS, msg: string) {
  console.log(`${paint('gray', stamp())} ${paint(color, tag)} ${msg}`);
}

export const log = {
  info: (msg: string) => line('·', 'cyan', msg),
  ok: (msg: string) => line('✓', 'green', msg),
  warn: (msg: string) => line('!', 'yellow', msg),
  error: (msg: string) => line('✗', 'red', msg),
  hit: (msg: string) => line('★', 'green', msg),
  /** 같은 줄을 덮어쓰는 대기 표시 (TTY 가 아니면 조용히 무시). */
  tick: (msg: string) => {
    if (!useColor) return;
    process.stdout.write(`\r${paint('gray', `${stamp()} ${msg}`)}\x1b[K`);
  },
  clearTick: () => {
    if (useColor) process.stdout.write('\r\x1b[K');
  },
  /**
   * 감시 중 진행 표시. 터미널이면 한 줄을 덮어쓰고,
   * 로그 파일로 리다이렉트된 경우엔 10회마다 한 줄씩만 남깁니다.
   */
  progress: (round: number, msg: string) => {
    if (useColor) log.tick(msg);
    else if (round % 10 === 1) line('·', 'gray', msg);
  },
};
