import { loadAdapter } from './adapters/registry.js';
import { openSession, snapshot, type Session } from './browser.js';
import { env, requireCredentials } from './config.js';
import { log } from './logger.js';
import { toDateString, upcomingDates } from './schedule.js';
import { watch, type WatchResult } from './watcher.js';
import type { BookingResult, JobConfig, ProbeResult, RoomRef, SiteAdapter, Slot } from './types.js';

/**
 * 어드민 페이지와 스케줄러가 함께 쓰는 동작들.
 * CLI 와 같은 코드를 타므로, 여기서 잘 되면 실제 예약도 같은 경로로 돕니다.
 */

async function open(job: JobConfig, headless = env.headless): Promise<{ adapter: SiteAdapter; session: Session }> {
  const adapter = loadAdapter(job.adapter);
  const session = await openSession(adapter.name, { headless });
  return { adapter, session };
}

/** schedule 이 있으면 대상 날짜를 지금 기준으로 다시 계산합니다. */
export function resolveDates(job: JobConfig): string[] {
  if (!job.schedule) return job.target.dates;
  const all = upcomingDates(job.schedule);
  const max = job.watch?.maxDates;
  return max && max > 0 ? all.slice(0, max) : all;
}

export interface LoginStatus {
  ok: boolean;
  message: string;
  /** 저장된 세션만으로 됐는지, 아이디·비밀번호로 새로 로그인했는지. */
  method: 'session' | 'password' | 'none';
}

/** 저장된 세션이 살아있는지 보고, 아니면 저장된 자격증명으로 로그인해 봅니다. */
export async function checkLogin(job: JobConfig): Promise<LoginStatus> {
  const { adapter, session } = await open(job);
  try {
    if (await adapter.isLoggedIn(session.page)) {
      await session.save();
      return { ok: true, method: 'session', message: '저장된 세션이 아직 유효합니다.' };
    }
    try {
      await adapter.login(session.page, requireCredentials(), { manual: false });
    } catch (e) {
      return { ok: false, method: 'none', message: `로그인 실패: ${(e as Error).message}` };
    }
    await session.save();
    return { ok: true, method: 'password', message: '저장된 아이디·비밀번호로 새로 로그인했습니다.' };
  } finally {
    await session.close();
  }
}

/** 브라우저 창을 띄워 사람이 직접 로그인하게 합니다 (2FA·캡차용). */
export async function manualLogin(job: JobConfig, waitMs = 300_000): Promise<LoginStatus> {
  const { adapter, session } = await open(job, false);
  try {
    await adapter.login(session.page, { username: '', password: '' }, { manual: true });
    await session.save();
    return { ok: true, method: 'session', message: '로그인이 확인되어 세션을 저장했습니다.' };
  } catch (e) {
    return { ok: false, method: 'none', message: `로그인 확인 실패: ${(e as Error).message}` };
  } finally {
    void waitMs;
    await session.close();
  }
}

/** 지금 예약 가능한 자리를 조회합니다 (예약하지 않음). */
export async function runCheck(job: JobConfig): Promise<{ slots: Slot[]; dates: string[] }> {
  const target = { ...job.target, dates: resolveDates(job) };
  const { adapter, session } = await open(job);
  try {
    if (!(await adapter.isLoggedIn(session.page))) {
      await adapter.login(session.page, requireCredentials(), { manual: false });
      await session.save();
    }
    return { slots: await adapter.findSlots(session.page, target), dates: target.dates };
  } finally {
    await session.close();
  }
}

/**
 * 지정한 날짜에 지금 당장 예약해 봅니다. 수동 모드의 알맹이입니다.
 * schedule 을 떼고 날짜 하나만 남겨, 반복 일정과 무관하게 동작합니다.
 */
export interface ManualRequest {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  timeFrom: string;
  durationMin?: number;
  /** 비워 두면 작업에 저장된 호실 순서를 그대로 씁니다. */
  rooms?: (string | RoomRef)[];
}

export function manualJob(job: JobConfig, req: ManualRequest): JobConfig {
  const { schedule: _schedule, ...rest } = job;
  return {
    ...rest,
    name: `${job.name} — ${req.date} ${req.timeFrom} 수동`,
    target: {
      ...job.target,
      dates: [req.date],
      timeFrom: req.timeFrom,
      ...(req.durationMin ? { durationMin: req.durationMin } : {}),
      ...(req.rooms?.length ? { rooms: req.rooms } : {}),
    },
    watch: {
      ...job.watch,
      // 오픈 시각을 기다리지 않습니다. 지금 확인하고 지금 잡습니다.
      openAt: undefined,
      onlyAtOpen: false,
      maxDates: undefined,
    },
  };
}

/**
 * 예행연습. 실제 신청 직전까지 똑같이 진행하고 최종 버튼만 누르지 않습니다.
 * 스크린샷을 남겨 폼이 제대로 채워졌는지 눈으로 확인할 수 있습니다.
 */
export async function runDryRun(job: JobConfig): Promise<BookingResult & { slot?: Slot }> {
  return runBookFirst(job, true);
}

/** 조건에 맞는 첫 자리를 예약합니다. dryRun 이면 최종 버튼 직전에 멈춥니다. */
export async function runBookFirst(job: JobConfig, dryRun: boolean): Promise<BookingResult & { slot?: Slot }> {
  const target = { ...job.target, dates: resolveDates(job) };
  const { adapter, session } = await open(job);
  try {
    if (!(await adapter.isLoggedIn(session.page))) {
      await adapter.login(session.page, requireCredentials(), { manual: false });
      await session.save();
    }
    const slots = await adapter.findSlots(session.page, target);
    const slot = slots[0];
    if (!slot) {
      return { ok: false, message: '지금은 조건에 맞는 빈자리가 없습니다.' };
    }
    log.info(`${dryRun ? '예행연습' : '예약 시도'}: ${slot.label}`);
    const result = await adapter.book(session.page, slot, { dryRun, values: job.values });
    return { ...result, slot };
  } catch (e) {
    const shot = await snapshot(session.page, 'book-error').catch(() => undefined);
    return { ok: false, message: `실패: ${(e as Error).message}`, ...(shot ? { screenshot: shot } : {}) };
  } finally {
    await session.close();
  }
}

/**
 * 날짜를 하루씩 넘기며 시간표가 뜨는 날을 찾습니다. 예약은 하지 않습니다.
 * "어느 날짜가 예약 가능한가" 를 모를 때 쓰는 탐색 도구입니다.
 */
export async function runProbe(
  job: JobConfig,
  opts: { from?: string; days: number; room?: string },
): Promise<ProbeResult[]> {
  const { adapter, session } = await open(job);
  try {
    if (!adapter.probe) throw new Error('이 어댑터는 날짜 탐색을 지원하지 않습니다.');
    if (!(await adapter.isLoggedIn(session.page))) {
      await adapter.login(session.page, requireCredentials(), { manual: false });
      await session.save();
    }

    // 호실을 하나만 골라 돕니다. 날짜가 열렸는지만 보면 되므로 여덟 곳을 돌 필요가 없습니다.
    const first = job.target.rooms?.[0];
    const asRef = (r: string | RoomRef | undefined): RoomRef | undefined =>
      r === undefined ? undefined : typeof r === 'string' ? { id: r } : r;
    const room = opts.room ? { id: opts.room } : asRef(first);

    const start = opts.from ? new Date(`${opts.from}T00:00:00`) : new Date();
    const results: ProbeResult[] = [];
    for (let i = 0; i < opts.days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const date = toDateString(d);
      const r = await adapter.probe(session.page, date, room);
      const mark = r.formFound ? `시간표 있음 · 선택 가능 ${r.openSlots}칸` : '시간표 없음';
      log.info(`  ${date} (${'일월화수목금토'[d.getDay()]})  ${mark}`);
      results.push(r);
    }
    return results;
  } finally {
    await session.close();
  }
}

/** 실제 감시·예약. 오픈 시각까지 기다렸다가 진행합니다. */
export async function runWatch(job: JobConfig, dryRun: boolean): Promise<WatchResult> {
  const { adapter, session } = await open(job);
  try {
    if (!(await adapter.isLoggedIn(session.page))) {
      await adapter.login(session.page, requireCredentials(), { manual: false });
      await session.save();
    }
    return await watch({
      page: session.page,
      adapter,
      job: { ...job, target: { ...job.target, dates: resolveDates(job) } },
      dryRun,
      saveSession: () => session.save(),
    });
  } finally {
    await session.close();
  }
}
