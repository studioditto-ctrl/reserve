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
import { isFailure, manualJob, reportResult, runBookFirst, runCheck, runProbe } from './operations.js';
import { startAdminServer } from './admin/server.js';
import { Scheduler } from './runner.js';
import { formatReport, inspectPage } from './inspect.js';
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

/** 사용자가 Enter 를 누를 때까지 기다립니다. */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
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
      const slots = await adapter.findSlots(session.page, job.target);
      printSlots(slots);
      reportResult(slots.length
        ? `빈자리 ${slots.length}건 — ${slots.map((x) => x.label).join(' / ')}`
        : '조건에 맞는 빈자리가 없습니다.');
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
    // 잡을 날짜가 없으면 브라우저를 띄우지도 않고 조용히 끝냅니다.
    // 자동 건을 지운 것은 고장이 아니므로 빨갛게 실패하면 안 됩니다.
    const peek = loadJob(jobPath, { allowNoDates: true });
    if (!peek.target.dates?.length) {
      const msg = peek.schedule
        ? '지금 열려 있는 날짜가 없습니다. 다음 오픈 때 다시 돕니다.'
        : '자동 예약 건이 없습니다. 어드민에서 자동 건을 만들어 주세요.';
      log.warn(msg);
      reportResult(msg);
      return;
    }
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
      reportResult(
        result.booked ? `예약 완료: ${result.booked.label}`
        : result.reason === 'deadline' ? '오픈 구간이 끝날 때까지 빈자리를 잡지 못했습니다.'
        : result.reason === 'errors' ? '오류가 반복돼 감시를 멈췄습니다.'
        : '감시를 중단했습니다.',
      );
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
      const result = await adapter.book(session.page, slot, { dryRun, values: job.values });
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
  .command('probe')
  .description('날짜를 하루씩 넘겨가며 시간표가 뜨는 날을 찾습니다 (예약하지 않음).')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('-f, --from <date>', '시작 날짜 YYYY-MM-DD. 없으면 오늘부터')
  .option('-d, --days <n>', '며칠치를 볼지', '14')
  .option('-r, --room <id>', '확인할 호실 코드. 없으면 작업의 첫 호실')
  .action(async (jobPath: string, opts: { from?: string; days: string; room?: string }) => {
    const job = loadJob(jobPath);
    const days = Number(opts.days);
    log.info(`${days}일치를 훑습니다 (예약하지 않습니다)`);

    const results = await runProbe(job, {
      ...(opts.from ? { from: opts.from } : {}),
      days,
      ...(opts.room ? { room: opts.room } : {}),
    });

    const open = results.filter((r) => r.formFound);
    console.log();
    if (open.length === 0) {
      log.warn('시간표가 뜨는 날짜가 하나도 없었습니다.');
      const landed = new Set(results.map((r) => r.landedUrl));
      log.warn(`도착한 주소: ${[...landed].join(', ')}`);
      for (const nav of new Set(results.map((r) => r.navigation).filter(Boolean))) {
        log.warn(`이동 경위: ${nav}`);
      }
      log.warn('모두 같은 주소로 튕겼다면 날짜 문제가 아니라 주소·권한 문제입니다.');
      process.exitCode = 1;
      return;
    }
    log.ok(`시간표가 뜨는 날짜 ${open.length}일`);
    for (const r of open) console.log(`  ${r.date}  선택 가능 ${r.openSlots}칸`);
  });

program
  .command('book-now')
  .description('날짜와 시각을 직접 지정해 지금 예약합니다 (반복 일정과 무관한 수동 모드).')
  .argument('<date>', '예약할 날짜. YYYY-MM-DD')
  .argument('[job]', '작업 파일 경로', DEFAULT_JOB)
  .option('-t, --time <hh:mm>', '시작 시각. 없으면 작업 설정을 씁니다.')
  .option('-d, --duration <min>', '길이(분). 없으면 작업 설정을 씁니다.')
  .option('-r, --rooms <codes>', '노릴 호실 코드를 순위대로, 쉼표로 구분. 없으면 작업 설정을 씁니다.')
  .option('-c, --count <n>', '신청서에 넣을 인원. 없으면 BOOKING_VALUES 의 값을 씁니다.')
  .option('--check', '예약하지 않고 조회만 합니다')
  .option('--confirm', '최종 신청 버튼까지 누릅니다 (진짜 예약됩니다). 기본은 dry-run.')
  .action(async (
    date: string,
    jobPath: string,
    opts: { time?: string; duration?: string; rooms?: string; count?: string; check?: boolean; confirm?: boolean },
  ) => {
    const base = loadJob(jobPath, { allowNoDates: true });
    // 어드민의 예약 건은 저마다 제 호실 순위와 인원을 들고 옵니다.
    // 그러지 않으면 화면에 적힌 순위와 실제로 도는 순위가 달라집니다.
    const rooms = opts.rooms?.split(',').map((s) => s.trim()).filter(Boolean);
    const req = {
      date,
      timeFrom: opts.time ?? base.target.timeFrom ?? '00:00',
      ...(opts.duration ? { durationMin: Number(opts.duration) } : {}),
      ...(rooms?.length ? { rooms } : {}),
    };
    const job = manualJob(base, req);
    if (opts.count) job.values = { ...job.values, count: String(opts.count) };
    log.info(`수동 모드 — ${date} ${req.timeFrom}${req.durationMin ? ` (${req.durationMin}분)` : ''}`);

    if (opts.check) {
      printSlots((await runCheck(job)).slots);
      return;
    }
    const result = await runBookFirst(job, !opts.confirm);
    const failed = isFailure(result, Boolean(opts.confirm));
    log[result.ok ? 'ok' : failed ? 'error' : 'warn'](result.message);
    reportResult(result.message);
    if (failed) process.exitCode = 1;
  });

program
  .command('serve')
  .description('어드민 페이지를 열고, 저장된 작업을 오픈 시각에 자동으로 실행합니다.')
  .option('-p, --port <port>', '포트 번호', '4100')
  .option('--no-open', '브라우저를 자동으로 열지 않습니다')
  .action(async (opts: { port: string; open: boolean }) => {
    const scheduler = new Scheduler();
    startAdminServer(Number(opts.port), scheduler, { open: opts.open });
    scheduler.start();
    log.info('종료하려면 Ctrl+C. 이 창을 켜 둬야 오픈 시각에 자동 예약됩니다.');
    // 스케줄러가 계속 돌아야 하므로 프로세스를 붙잡아 둡니다.
    await new Promise<void>((resolve) => process.on('SIGINT', () => resolve()));
    scheduler.stop();
  });

program
  .command('inspect')
  .description('페이지를 열어 프로필에 넣을 셀렉터 후보를 찾아줍니다.')
  .argument('<url>', '조사할 페이지 URL (로그인 페이지 또는 예약 목록 페이지)')
  .option('--profile <path>', '저장된 세션을 쓸 프로필 (로그인이 필요한 페이지일 때)')
  .option('--headed', '브라우저 창을 띄웁니다')
  .option('--wait <sec>', '페이지를 연 뒤 기다릴 시간(초). 목록이 늦게 그려지는 사이트용', '2')
  .option(
    '--pause',
    '창을 띄운 뒤 Enter 를 누를 때까지 기다립니다. 직접 로그인하고 원하는 화면까지 이동한 다음 조사할 때 쓰세요 (세션도 저장됩니다).',
  )
  .action(async (url: string, opts: { profile?: string; headed?: boolean; wait: string; pause?: boolean }) => {
    const name = opts.profile ? loadAdapter(opts.profile).name : 'inspect';
    const headless = opts.pause ? false : opts.headed ? false : env.headless;
    const session = await openSession(name, { headless });
    try {
      await session.page.goto(url, { waitUntil: 'domcontentloaded' });

      if (opts.pause) {
        console.log(
          '\n브라우저 창에서 직접 로그인하고, 조사할 화면까지 이동하세요.\n' +
            '준비되면 이 터미널에서 Enter 를 누르세요. (그 시점의 화면을 조사합니다)\n',
        );
        await waitForEnter();
        await session.save();
        log.ok(`세션 저장: ${sessionPath(name)}`);
      } else {
        await session.page.waitForTimeout(Number(opts.wait) * 1000);
      }

      console.log(formatReport(await inspectPage(session.page)));
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
