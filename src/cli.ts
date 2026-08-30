#!/usr/bin/env -S npx tsx
import { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { env, loadJob, requireCredentials } from './config.js';
import { openSession, sessionPath, type Session } from './browser.js';
import { loadAdapter } from './adapters/registry.js';
import { log } from './logger.js';
import { notify } from './notify/index.js';
import { watch } from './watcher.js';
import type { JobConfig, SiteAdapter, Slot } from './types.js';

const DEFAULT_JOB = 'config/mock.job.json';

interface CommonOpts {
  headed?: boolean;
  /** 지정하면 최종 확정 단계까지 실제로 진행합니다. 없으면 .env 의 DRY_RUN 을 따릅니다. */
  confirm?: boolean;
}

/** 작업 파일 + 어댑터 + 브라우저 세션을 한 번에 준비합니다. */
async function bootstrap(
  jobPath: string,
  opts: CommonOpts,
): Promise<{ job: JobConfig; adapter: SiteAdapter; session: Session; dryRun: boolean }> {
  const job = loadJob(jobPath);
  const adapter = loadAdapter(job.adapter);
  const session = await openSession(adapter.name, { headless: opts.headed ? false : env.headless });
  const dryRun = opts.confirm ? false : env.dryRun;
  return { job, adapter, session, dryRun };
}

/** 저장된 세션이 살아있는지 보고, 죽었으면 .env 자격증명으로 다시 로그인합니다. */
async function ensureLogin(page: Page, adapter: SiteAdapter): Promise<void> {
  if (await adapter.isLoggedIn(page)) {
    log.ok(`세션 유효 — ${adapter.name}`);
    return;
  }
  log.warn('저장된 세션이 없거나 만료됐습니다. 자동 로그인을 시도합니다.');
  await adapter.login(page, requireCredentials(), { manual: false });
  log.ok('로그인 성공');
}

function printSlots(slots: Slot[]): void {
  if (slots.length === 0) {
    log.info('조건에 맞는 빈자리가 없습니다.');
    return;
  }
  log.ok(`빈자리 ${slots.length}건`);
  for (const s of slots) {
    console.log(`  [${s.id}] ${s.label}${s.price ? `  ${s.price}` : ''}${s.url ? `\n         ${s.url}` : ''}`);
  }
}

const program = new Command();
program
  .name('reserve')
  .description('예약 사이트에 로그인해 빈자리를 실시간 감시하고 예약하는 CLI')
  .version('0.1.0');

program
  .command('login')
  .description('사이트에 로그인해 세션을 저장합니다 (이후 명령은 이 세션을 재사용).')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('--manual', '브라우저 창에서 직접 로그인 (2FA·캡차가 있는 사이트)')
  .option('--headed', '브라우저 창을 띄웁니다 (--manual 이면 자동으로 켜집니다)')
  .action(async (jobPath: string, opts: { manual?: boolean; headed?: boolean }) => {
    const headed = opts.manual ? true : opts.headed;
    const { adapter, session } = await bootstrap(jobPath, { headed });
    try {
      if (!opts.manual && (await adapter.isLoggedIn(session.page))) {
        log.ok('이미 로그인되어 있습니다.');
      } else {
        const creds = opts.manual ? { username: '', password: '' } : requireCredentials();
        await adapter.login(session.page, creds, { manual: Boolean(opts.manual) });
        log.ok('로그인 성공');
      }
      await session.save();
      log.ok(`세션 저장: ${sessionPath(adapter.name)}`);
    } finally {
      await session.close();
    }
  });

program
  .command('check')
  .description('지금 빈자리가 있는지 한 번만 확인합니다.')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('--headed', '브라우저 창을 띄웁니다')
  .action(async (jobPath: string, opts: CommonOpts) => {
    const { job, adapter, session } = await bootstrap(jobPath, opts);
    try {
      await ensureLogin(session.page, adapter);
      await session.save();
      printSlots(await adapter.findSlots(session.page, job.target));
    } finally {
      await session.close();
    }
  });

program
  .command('watch')
  .description('빈자리가 날 때까지 계속 감시합니다. 조건에 맞으면 알림 또는 자동 예약.')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('--headed', '브라우저 창을 띄웁니다')
  .option('--interval <sec>', '폴링 간격(초). 작업 파일 설정을 덮어씁니다.')
  .option('--auto-book', '빈자리를 찾으면 예약까지 자동으로 진행합니다')
  .option('--confirm', '최종 확정 버튼까지 실제로 누릅니다 (진짜 예약됩니다). 기본은 dry-run.')
  .action(async (jobPath: string, opts: CommonOpts & { interval?: string; autoBook?: boolean }) => {
    const { job, adapter, session, dryRun } = await bootstrap(jobPath, opts);
    job.watch ??= {};
    if (opts.interval) job.watch.intervalSec = Number(opts.interval);
    if (opts.autoBook) job.watch.autoBook = true;

    try {
      await ensureLogin(session.page, adapter);
      await session.save();

      const mode = job.watch.autoBook ? (dryRun ? '자동예약(dry-run)' : '자동예약(실제)') : '알림만';
      log.info(`감시 시작 · ${job.name} · ${mode} · ${job.watch.intervalSec ?? 30}초 간격`);
      if (job.watch.autoBook && !dryRun) {
        log.warn('DRY_RUN 이 꺼져 있습니다. 조건이 맞으면 실제로 예약이 확정됩니다.');
      }

      const result = await watch({
        page: session.page,
        adapter,
        job,
        dryRun,
        saveSession: () => session.save(),
      });
      log.info(`감시 종료 (${result.reason})`);
      if (result.reason === 'errors') process.exitCode = 1;
    } finally {
      await session.close();
    }
  });

program
  .command('book')
  .description('check 로 확인한 슬롯 ID 를 지정해 예약합니다.')
  .argument('<slotId>', 'check 결과의 [대괄호] 안 ID')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('--headed', '브라우저 창을 띄웁니다')
  .option('--confirm', '최종 확정 버튼까지 실제로 누릅니다 (진짜 예약됩니다). 기본은 dry-run.')
  .action(async (slotId: string, jobPath: string, opts: CommonOpts) => {
    const { job, adapter, session, dryRun } = await bootstrap(jobPath, opts);
    try {
      await ensureLogin(session.page, adapter);
      const slots = await adapter.findSlots(session.page, job.target);
      const slot = slots.find((s) => s.id === slotId);
      if (!slot) {
        log.error(`슬롯 ${slotId} 을(를) 찾을 수 없습니다. 이미 나갔을 수 있습니다.`);
        printSlots(slots);
        process.exitCode = 1;
        return;
      }
      const result = await adapter.book(session.page, slot, { dryRun });
      await session.save();
      await notify({
        level: result.ok ? 'hit' : 'error',
        title: result.ok ? `예약 처리 완료 · ${job.name}` : `예약 실패 · ${job.name}`,
        body: result.message,
      });
      if (!result.ok) process.exitCode = 1;
    } finally {
      await session.close();
    }
  });

program
  .command('init')
  .description('새 사이트용 프로필/작업 파일을 예제에서 복사해 만듭니다.')
  .argument('<name>', '사이트 이름 (예: myrestaurant)')
  .action((name: string) => {
    mkdirSync('config', { recursive: true });
    const pairs = [
      ['config/example.profile.json', `config/${name}.profile.json`],
      ['config/example.job.json', `config/${name}.job.json`],
    ] as const;
    for (const [from, to] of pairs) {
      if (existsSync(to)) {
        log.warn(`이미 있어 건너뜁니다: ${to}`);
        continue;
      }
      copyFileSync(resolve(from), resolve(to));
      log.ok(`생성: ${to}`);
    }
    console.log(
      `\n다음 순서로 진행하세요:\n` +
        `  1. config/${name}.profile.json 에 사이트 셀렉터를 채웁니다 (README 의 "셀렉터 찾는 법" 참고)\n` +
        `  2. config/${name}.job.json 에 원하는 날짜·시간·인원을 적습니다\n` +
        `  3. npx tsx src/cli.ts login config/${name}.job.json --manual\n` +
        `  4. npx tsx src/cli.ts check config/${name}.job.json\n` +
        `  5. npx tsx src/cli.ts watch config/${name}.job.json --auto-book\n`,
    );
  });

program.parseAsync(process.argv).catch((e: Error) => {
  log.error(e.message);
  process.exit(1);
});
