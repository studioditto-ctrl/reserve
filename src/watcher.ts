import type { Page } from 'playwright';
import { log } from './logger.js';
import { notify } from './notify/index.js';
import { snapshot } from './browser.js';
import { formatKST, nextOpenAt, upcomingDates } from './schedule.js';
import type { JobConfig, SiteAdapter, Slot } from './types.js';

/** 사이트에 과한 부하를 주지 않기 위한 하한선. */
const MIN_INTERVAL_SEC = 5;
const DEFAULT_INTERVAL_SEC = 30;
const DEFAULT_JITTER_SEC = 5;
const DEFAULT_MAX_ERRORS = 5;
/** 오픈런 구간에서 허용하는 최단 간격. 이보다 짧으면 사이트에 무리를 줍니다. */
const MIN_BURST_MS = 500;
const DEFAULT_BURST = { beforeSec: 30, afterSec: 300, intervalMs: 1000 };

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hhmmToMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** 지금이 조용한 시간대(폴링 중지 구간)인지. 자정을 넘는 범위도 처리합니다. */
export function inQuietHours(range: [string, string] | undefined, now = new Date()): boolean {
  if (!range) return false;
  const [start, end] = range;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

export interface WatchDeps {
  page: Page;
  adapter: SiteAdapter;
  job: JobConfig;
  dryRun: boolean;
  /** 세션 쿠키를 디스크에 다시 저장 (예약 후 상태 보존용). */
  saveSession: () => Promise<void>;
}

export interface WatchResult {
  reason: 'booked' | 'deadline' | 'errors' | 'interrupted';
  booked?: Slot;
}

/**
 * 빈자리를 주기적으로 확인하고, 조건에 맞으면 알림 또는 자동 예약을 수행합니다.
 */
export async function watch(deps: WatchDeps): Promise<WatchResult> {
  const { page, adapter, job, dryRun } = deps;
  const w = job.watch ?? {};
  const interval = Math.max(MIN_INTERVAL_SEC, w.intervalSec ?? DEFAULT_INTERVAL_SEC);
  const jitter = Math.max(0, w.jitterSec ?? DEFAULT_JITTER_SEC);
  const maxErrors = w.maxConsecutiveErrors ?? DEFAULT_MAX_ERRORS;
  const deadline = w.until ? new Date(w.until).getTime() : undefined;

  const openSched = w.openAt;
  const beforeMs = (w.burst?.beforeSec ?? DEFAULT_BURST.beforeSec) * 1000;
  const afterMs = (w.burst?.afterSec ?? DEFAULT_BURST.afterSec) * 1000;
  const burstMs = Math.max(MIN_BURST_MS, w.burst?.intervalMs ?? DEFAULT_BURST.intervalMs);
  // 오픈 시각이 지정되면 기본적으로 그 구간에만 확인합니다.
  const waitForOpen = openSched ? w.onlyAtOpen !== false : false;
  let nextOpen = openSched ? nextOpenAt(openSched) : undefined;
  const announced = new Set<number>();

  if (openSched && nextOpen) {
    log.info(`다음 예약 오픈: ${formatKST(nextOpen)} (${fmtDuration(nextOpen.getTime() - Date.now())} 뒤)`);
  }

  if (w.intervalSec !== undefined && w.intervalSec < MIN_INTERVAL_SEC) {
    log.warn(`intervalSec 이 너무 짧아 ${MIN_INTERVAL_SEC}초로 올렸습니다.`);
  }

  let stop = false;
  const onSigint = () => {
    stop = true;
    log.clearTick();
    log.warn('중단 신호를 받았습니다. 정리하는 중…');
  };
  process.on('SIGINT', onSigint);

  const seen = new Set<string>();
  const attempted = new Set<string>();
  let consecutiveErrors = 0;
  let round = 0;

  try {
    while (!stop) {
      if (deadline && Date.now() >= deadline) {
        log.clearTick();
        log.info(`마감 시각(${w.until})이 지나 감시를 종료합니다.`);
        return { reason: 'deadline' };
      }

      round++;
      let inBurst = false;

      // 반복 일정이 있으면 대상 날짜를 매 회차 다시 계산합니다 (장기 감시 대비).
      if (job.schedule) {
        const all = upcomingDates(job.schedule);
        const dates = w.maxDates && w.maxDates > 0 ? all.slice(0, w.maxDates) : all;
        if (dates.join() !== job.target.dates.join()) {
          job.target.dates = dates;
          log.clearTick();
          log.info(`대상 날짜 갱신: ${dates.join(', ') || '(해당 없음)'}`);
        }
      }

      if (inQuietHours(w.quietHours)) {
        log.progress(round, `조용한 시간대(${w.quietHours?.join('~')}) — 대기 중`);
        await sleep(60_000);
        continue;
      }

      // ── 오픈런: 예약이 열리는 시각까지 기다렸다가 그 전후로 몰아서 확인 ──
      if (openSched) {
        const now = Date.now();
        if (!nextOpen || now > nextOpen.getTime() + afterMs) nextOpen = nextOpenAt(openSched, new Date());
        if (!nextOpen) {
          log.clearTick();
          log.info('남은 예약 오픈 일정이 없어 종료합니다.');
          return { reason: 'deadline' };
        }
        const burstStart = nextOpen.getTime() - beforeMs;
        const burstEnd = nextOpen.getTime() + afterMs;

        if (now < burstStart && waitForOpen) {
          log.progress(round, `오픈 대기 중 — ${formatKST(nextOpen)} (${fmtDuration(burstStart - now)} 남음)`);
          // 한 번에 오래 자지 않고 쪼개서 기다립니다 (중단 신호에 바로 반응하도록).
          await sleep(Math.min(burstStart - now, 60_000));
          continue;
        }

        inBurst = now >= burstStart && now <= burstEnd;
        if (inBurst && !announced.has(nextOpen.getTime())) {
          announced.add(nextOpen.getTime());
          log.clearTick();
          log.info(`오픈 임박 — ${formatKST(nextOpen)} · ${burstMs}ms 간격으로 확인합니다`);
        }
      }

      try {
        const slots = await adapter.findSlots(page, job.target);
        consecutiveErrors = 0;

        const fresh = slots.filter((s) => !seen.has(s.id));
        for (const s of slots) seen.add(s.id);

        if (fresh.length === 0) {
          log.progress(round, `#${round} 빈자리 없음 — ${interval}초 후 재확인`);
        } else {
          log.clearTick();
          await notify({
            level: 'hit',
            title: `빈자리 ${fresh.length}건 발견 · ${job.name}`,
            body: fresh.map((s) => `• ${s.label}${s.price ? ` (${s.price})` : ''}`).join('\n'),
            ...(fresh[0]?.url ? { url: fresh[0].url } : {}),
          });

          if (w.autoBook) {
            for (const slot of fresh) {
              if (attempted.has(slot.id)) continue;
              attempted.add(slot.id);
              log.info(`예약 시도: ${slot.label}${dryRun ? ' (dry-run)' : ''}`);

              const result = await adapter.book(page, slot, { dryRun });
              await deps.saveSession().catch(() => {});

              if (result.ok) {
                await notify({
                  level: 'hit',
                  title: result.stoppedBeforeConfirm
                    ? `dry-run 완료 · ${job.name}`
                    : `예약 성공 · ${job.name}`,
                  body: result.message,
                });
                if (w.stopAfterBooking !== false) return { reason: 'booked', booked: slot };
              } else {
                log.warn(result.message);
              }
            }
          }
        }
      } catch (e) {
        consecutiveErrors++;
        log.clearTick();
        const msg = (e as Error).message;
        log.error(`#${round} 확인 실패 (${consecutiveErrors}/${maxErrors}): ${msg}`);
        await snapshot(page, 'watch-error').catch(() => {});

        if (consecutiveErrors >= maxErrors) {
          await notify({
            level: 'error',
            title: `감시 중단 · ${job.name}`,
            body: `연속 ${consecutiveErrors}회 실패했습니다. 마지막 오류: ${msg}\n세션이 만료됐다면 \`npm run login\` 을 다시 실행하세요.`,
          });
          return { reason: 'errors' };
        }
        // 실패가 이어지면 간격을 늘려 사이트를 두드리지 않습니다.
        await sleep((inBurst ? burstMs : interval * 1000) * consecutiveErrors);
        continue;
      }

      const waitMs = inBurst
        ? burstMs
        : Math.max(MIN_INTERVAL_SEC * 1000, (interval + (Math.random() * 2 - 1) * jitter) * 1000);
      await sleep(waitMs);
    }
    return { reason: 'interrupted' };
  } finally {
    process.off('SIGINT', onSigint);
    log.clearTick();
  }
}
