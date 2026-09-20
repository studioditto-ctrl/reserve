import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addLogSink, log } from '../logger.js';
import { Scheduler } from '../runner.js';
import {
  checkLogin, manualJob, manualLogin, runBookFirst, runCheck, runDryRun,
  type ManualRequest,
} from '../operations.js';
import {
  clearCredentials, deleteJob, getJob, hasCredentials, listJobs, saveCredentials, saveJob,
  type SavedJob,
} from '../store.js';
import { formatKST, nextOpenAt, upcomingDates } from '../schedule.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve('screenshots');
const RECENT_LOGS: string[] = [];
const clients = new Set<ServerResponse>();

addLogSink((line) => {
  RECENT_LOGS.push(line);
  if (RECENT_LOGS.length > 300) RECENT_LOGS.shift();
  for (const res of clients) res.write(`data: ${JSON.stringify(line)}\n\n`);
});

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
}

/** config/ 에 있는 사이트 프로필 목록. */
function listProfiles(): string[] {
  const dir = resolve('config');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.profile.json')).map((f) => `config/${f}`);
}

/** 작업 하나가 앞으로 어떻게 돌지 미리 보여줍니다. */
function preview(job: SavedJob) {
  const dates = job.schedule ? upcomingDates(job.schedule).slice(0, 4) : job.target.dates.slice(0, 4);
  const open = job.watch?.openAt ? nextOpenAt(job.watch.openAt) : undefined;
  return { dates, nextOpen: open ? formatKST(open) : null };
}

/** 기본 브라우저로 화면을 띄웁니다. 실패해도 서버는 그대로 돕니다. */
export function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    // spawn 실패는 예외가 아니라 error 이벤트로 옵니다. 받아 두지 않으면 앱이 죽습니다.
    child.on('error', () => log.warn(`브라우저를 자동으로 열지 못했습니다. 직접 ${url} 로 접속하세요.`));
    child.unref();
  } catch {
    log.warn(`브라우저를 자동으로 열지 못했습니다. 직접 ${url} 로 접속하세요.`);
  }
}

export interface ServeOptions {
  /** 이 포트가 쓰이고 있으면 다음 번호로 넘어갑니다. */
  port: number;
  /** 서버가 뜨면 브라우저를 자동으로 엽니다. */
  open?: boolean;
}

export function startAdminServer(port: number, scheduler: Scheduler, opts: { open?: boolean } = {}): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      if (path === '/' || path === '/index.html') {
        const html = readFileSync(resolve(HERE, 'ui.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      if (path === '/api/state') {
        return json(res, 200, {
          jobs: scheduler.status(),
          details: listJobs().map((j) => ({ ...j, preview: preview(j) })),
          hasCredentials: hasCredentials(),
          profiles: listProfiles(),
        });
      }

      if (path === '/api/logs') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        for (const line of RECENT_LOGS.slice(-60)) res.write(`data: ${JSON.stringify(line)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (path === '/api/credentials' && method === 'POST') {
        const body = await readJson<{ username: string; password: string }>(req);
        if (!body.username || !body.password) return json(res, 400, { error: '아이디와 비밀번호를 모두 입력하세요.' });
        saveCredentials(body);
        log.ok('로그인 정보를 저장했습니다 (data/secrets.json, 본인만 읽기).');
        return json(res, 200, { ok: true });
      }

      if (path === '/api/credentials' && method === 'DELETE') {
        clearCredentials();
        log.info('저장된 로그인 정보를 지웠습니다.');
        return json(res, 200, { ok: true });
      }

      if (path === '/api/jobs' && method === 'POST') {
        const body = await readJson<Omit<SavedJob, 'createdAt' | 'updatedAt'>>(req);
        const saved = saveJob(body);
        log.ok(`작업 저장: ${saved.name}`);
        return json(res, 200, { ok: true, job: saved, preview: preview(saved) });
      }

      const jobMatch = /^\/api\/jobs\/([\w-]+)(?:\/(\w+))?$/.exec(path);
      if (jobMatch) {
        const [, id = '', action] = jobMatch;
        const job = getJob(id);
        if (!job) return json(res, 404, { error: '작업을 찾을 수 없습니다.' });

        if (!action && method === 'DELETE') {
          deleteJob(id);
          log.info(`작업 삭제: ${job.name}`);
          return json(res, 200, { ok: true });
        }
        if (!action && method === 'GET') return json(res, 200, { job, preview: preview(job) });

        if (method === 'POST') {
          switch (action) {
            case 'login':
              return json(res, 200, await checkLogin(job));
            case 'manual':
              return json(res, 200, await manualLogin(job));
            case 'check': {
              const { slots, dates } = await runCheck(job);
              return json(res, 200, { dates, slots });
            }
            case 'dryrun': {
              const result = await runDryRun(job);
              return json(res, 200, {
                ...result,
                screenshot: result.screenshot ? `/api/screenshot?file=${encodeURIComponent(result.screenshot)}` : null,
              });
            }
            // 저장소에 커밋할 형태로 내보냅니다.
            // 개인정보(values)는 빼고, 그건 GitHub Secret 으로 넣습니다.
            case 'export': {
              const { id: _id, enabled: _e, createdAt: _c, updatedAt: _u, lastRun: _l, values, ...rest } = job;
              return json(res, 200, {
                config: JSON.stringify(rest, null, 2),
                secret: JSON.stringify(values ?? {}),
              });
            }
            case 'run':
              void scheduler.launch(id);
              return json(res, 200, { ok: true, message: '실행을 시작했습니다. 아래 로그를 확인하세요.' });

            // ── 수동 모드: 날짜·시각을 직접 지정 ──
            case 'manualcheck': {
              const body = await readJson<ManualRequest>(req);
              const { slots, dates } = await runCheck(manualJob(job, body));
              return json(res, 200, { dates, slots });
            }
            case 'manualbook': {
              const body = await readJson<ManualRequest & { dryRun: boolean }>(req);
              const result = await runBookFirst(manualJob(job, body), body.dryRun !== false);
              return json(res, 200, {
                ...result,
                screenshot: result.screenshot ? `/api/screenshot?file=${encodeURIComponent(result.screenshot)}` : null,
              });
            }
            case 'manualwatch': {
              const body = await readJson<ManualRequest & { dryRun: boolean }>(req);
              void scheduler.launch(id, { job: manualJob(job, body), dryRun: body.dryRun !== false });
              return json(res, 200, {
                ok: true,
                message: `${body.date} ${body.timeFrom} 자리가 날 때까지 계속 확인합니다. 아래 로그를 보세요.`,
              });
            }
          }
        }
      }

      if (path === '/api/screenshot') {
        const file = resolve(url.searchParams.get('file') ?? '');
        // 스크린샷 폴더 밖의 파일은 절대 내보내지 않습니다.
        if (!file.startsWith(SHOT_DIR + '/') || !existsSync(file)) return json(res, 404, { error: '없는 파일' });
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(readFileSync(file));
      }

      json(res, 404, { error: '없는 경로' });
    } catch (e) {
      log.error(`어드민 오류: ${(e as Error).message}`);
      json(res, 500, { error: (e as Error).message });
    }
  });

  // 포트가 이미 쓰이고 있으면 다음 번호로 넘어갑니다.
  // 앱을 두 번 켰을 때 오류로 죽는 것보다 낫습니다.
  let attempt = port;
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE' && attempt < port + 10) {
      log.warn(`포트 ${attempt} 이(가) 사용 중이라 ${attempt + 1} 로 넘어갑니다.`);
      attempt++;
      server.listen(attempt, '127.0.0.1');
      return;
    }
    log.error(`서버를 시작하지 못했습니다: ${e.message}`);
    process.exit(1);
  });

  // 바깥에서 접근하지 못하도록 이 컴퓨터에만 엽니다.
  server.listen(attempt, '127.0.0.1', () => {
    const url = `http://localhost:${attempt}`;
    log.ok(`어드민 페이지: ${url}`);
    if (opts.open) openInBrowser(url);
  });
}
