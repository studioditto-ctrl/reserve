import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './config.js';
import { log } from './logger.js';

const SESSION_DIR = resolve('.sessions');
const SHOT_DIR = resolve('screenshots');

export function sessionPath(profileName: string): string {
  return resolve(SESSION_DIR, `${profileName.replace(/[^\w.-]/g, '_')}.json`);
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** 현재 로그인 상태를 디스크에 저장합니다. */
  save(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 저장된 로그인 세션을 환경변수로 받아 디스크에 풀어 둡니다.
 *
 * 클라우드(GitHub Actions)처럼 매번 새 환경에서 도는 곳에서, 캡차나 2FA 때문에
 * 아이디·비밀번호 로그인이 어려울 때 쓰는 우회로입니다.
 * `reserve login --manual` 로 만든 .sessions/<이름>.json 내용을 Secret 에 넣으면 됩니다.
 */
function restoreSessionFromEnv(statePath: string): void {
  const raw = process.env.SESSION_STATE;
  if (!raw) return;
  try {
    JSON.parse(raw);
  } catch {
    log.warn('SESSION_STATE 가 올바른 JSON 이 아니라 무시합니다.');
    return;
  }
  writeFileSync(statePath, raw);
  log.info('SESSION_STATE 로 저장된 로그인 세션을 복원했습니다.');
}

export async function openSession(
  profileName: string,
  opts: { headless?: boolean } = {},
): Promise<Session> {
  mkdirSync(SESSION_DIR, { recursive: true });
  const statePath = sessionPath(profileName);
  restoreSessionFromEnv(statePath);
  const headless = opts.headless ?? env.headless;

  // 브라우저 바이너리를 직접 지정해야 하는 환경(CI·컨테이너)용 탈출구.
  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext({
    storageState: existsSync(statePath) ? statePath : undefined,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    async save() {
      await context.storageState({ path: statePath });
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/** 실패 지점을 눈으로 확인할 수 있게 스크린샷을 남깁니다. */
export async function snapshot(page: Page, tag: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = resolve(SHOT_DIR, `${tag}-${Date.now()}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    writeFileSync(file.replace(/\.png$/, '.txt'), '스크린샷 실패');
  }
  return file;
}
