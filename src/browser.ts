import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from './config.js';

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

export async function openSession(
  profileName: string,
  opts: { headless?: boolean } = {},
): Promise<Session> {
  mkdirSync(SESSION_DIR, { recursive: true });
  const statePath = sessionPath(profileName);
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
