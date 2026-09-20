import { log } from './logger.js';
import { nextOpenAt, formatKST } from './schedule.js';
import { runWatch } from './operations.js';
import { getJob, listJobs, recordRun, type SavedJob } from './store.js';

/**
 * 저장된 작업들을 오픈 시각에 맞춰 알아서 실행합니다.
 *
 * 브라우저는 오픈 직전에만 띄웁니다. 2주 뒤 오픈을 위해 창을 계속 열어 두는 건
 * 낭비이고, 그사이 세션이 끊기면 오히려 위험합니다.
 */
const LEAD_MS = 10 * 60 * 1000;
const TICK_MS = 60_000;

export interface JobStatus {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  nextOpen?: string;
  startsAt?: string;
  lastRun?: SavedJob['lastRun'];
}

export class Scheduler {
  private readonly running = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    log.ok('예약 스케줄러 시작 — 오픈 10분 전에 자동으로 준비합니다.');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  status(): JobStatus[] {
    return listJobs().map((job) => {
      const open = job.watch?.openAt ? nextOpenAt(job.watch.openAt) : undefined;
      return {
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        running: this.running.has(job.id),
        ...(open ? { nextOpen: open.toISOString(), startsAt: new Date(open.getTime() - LEAD_MS).toISOString() } : {}),
        ...(job.lastRun ? { lastRun: job.lastRun } : {}),
      };
    });
  }

  private tick(): void {
    for (const job of listJobs()) {
      if (!job.enabled || this.running.has(job.id)) continue;

      const openAt = job.watch?.openAt;
      if (openAt) {
        const next = nextOpenAt(openAt);
        if (!next) continue;
        const afterMs = (job.watch?.burst?.afterSec ?? 300) * 1000;
        const from = next.getTime() - LEAD_MS;
        const until = next.getTime() + afterMs;
        const now = Date.now();
        if (now < from || now > until) continue;
        log.info(`오픈 준비 — ${job.name} (오픈 ${formatKST(next)})`);
      }
      void this.launch(job.id);
    }
  }

  /** 작업 하나를 지금 실행합니다. 어드민의 "지금 실행" 도 이 경로를 씁니다. */
  async launch(id: string, override?: { dryRun?: boolean }): Promise<void> {
    if (this.running.has(id)) return;
    const job = getJob(id);
    if (!job) return;

    this.running.add(id);
    try {
      // 저장된 작업의 설정을 따릅니다 (어드민에서 켜고 끕니다).
      const dryRun = override?.dryRun ?? job.dryRun !== false;
      const result = await runWatch(job, dryRun);
      const ok = result.reason === 'booked';
      const message =
        result.reason === 'booked'
          ? `예약 ${dryRun ? '예행연습' : '성공'}: ${result.booked?.label ?? ''}`
          : `종료 (${result.reason})`;
      recordRun(id, { at: new Date().toISOString(), ok, message });
      log[ok ? 'ok' : 'info'](`${job.name} — ${message}`);
    } catch (e) {
      const message = (e as Error).message;
      recordRun(id, { at: new Date().toISOString(), ok: false, message });
      log.error(`${job.name} — ${message}`);
    } finally {
      this.running.delete(id);
    }
  }
}
