import { config as loadDotenv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Credentials, JobConfig } from './types.js';

loadDotenv({ quiet: true });

const bool = (v: string | undefined, fallback: boolean) =>
  v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v);

export const env = {
  username: process.env.SITE_USERNAME ?? '',
  password: process.env.SITE_PASSWORD ?? '',
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  /** 기본값은 안전한 쪽(true): 최종 확정 버튼 직전에 멈춥니다. */
  dryRun: bool(process.env.DRY_RUN, true),
  headless: bool(process.env.HEADLESS, true),
};

export function requireCredentials(): Credentials {
  if (!env.username || !env.password) {
    throw new Error(
      '.env 에 SITE_USERNAME / SITE_PASSWORD 가 없습니다. ' +
        '.env.example 을 .env 로 복사해서 채우거나, `reserve login --manual` 로 직접 로그인하세요.',
    );
  }
  return { username: env.username, password: env.password };
}

/** 프로필의 valueFrom 문자열을 실제 값으로 바꿉니다. "env:BOOKING_NAME" → 홍길동 */
export function resolveValue(spec: string): string {
  if (spec.startsWith('env:')) {
    const key = spec.slice(4);
    const v = process.env[key];
    if (v === undefined) throw new Error(`환경변수 ${key} 가 .env 에 없습니다.`);
    return v;
  }
  return spec;
}

export function loadJob(path: string): JobConfig {
  const full = resolve(path);
  let job: JobConfig;
  try {
    job = JSON.parse(readFileSync(full, 'utf8')) as JobConfig;
  } catch (e) {
    throw new Error(`작업 파일을 읽지 못했습니다: ${full}\n${(e as Error).message}`);
  }
  if (!job.adapter) throw new Error(`${full}: "adapter" 항목이 필요합니다.`);
  if (!job.target?.dates?.length) throw new Error(`${full}: "target.dates" 에 날짜가 최소 하나 필요합니다.`);
  return job;
}
