import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Credentials, JobConfig } from './types.js';

/**
 * 어드민 페이지에서 입력한 값을 디스크에 보관합니다.
 *
 * data/ 아래에는 아이디·비밀번호·연락처 같은 개인정보가 들어가므로
 * .gitignore 로 제외하고, 파일 권한도 본인만 읽도록 좁힙니다.
 */
const DATA_DIR = resolve('data');
const JOBS_DIR = resolve(DATA_DIR, 'jobs');
const SECRETS = resolve(DATA_DIR, 'secrets.json');

function ensureDirs(): void {
  mkdirSync(JOBS_DIR, { recursive: true });
  try {
    chmodSync(DATA_DIR, 0o700);
  } catch {
    // Windows 등 권한 개념이 다른 환경에서는 무시합니다.
  }
}

/** 어드민 페이지에서 저장하는 예약 작업. */
export interface SavedJob extends JobConfig {
  id: string;
  enabled: boolean;
  /** true 면 최종 신청 버튼 직전에 멈춥니다. 기본값은 안전한 쪽(true). */
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun?: {
    at: string;
    ok: boolean;
    message: string;
  };
}

export function listJobs(): SavedJob[] {
  ensureDirs();
  return readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(JOBS_DIR, f), 'utf8')) as SavedJob)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getJob(id: string): SavedJob | undefined {
  const path = resolve(JOBS_DIR, `${id}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as SavedJob;
}

export function saveJob(input: Omit<SavedJob, 'createdAt' | 'updatedAt' | 'id'> & { id?: string }): SavedJob {
  ensureDirs();
  const now = new Date().toISOString();
  const id = input.id || randomUUID().slice(0, 8);
  const existing = input.id ? getJob(input.id) : undefined;
  const job: SavedJob = {
    ...input,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing?.lastRun ? { lastRun: existing.lastRun } : {}),
  };
  const path = resolve(JOBS_DIR, `${id}.json`);
  writeFileSync(path, JSON.stringify(job, null, 2) + '\n');
  try {
    chmodSync(path, 0o600);
  } catch {}
  return job;
}

export function recordRun(id: string, run: NonNullable<SavedJob['lastRun']>): void {
  const job = getJob(id);
  if (!job) return;
  writeFileSync(resolve(JOBS_DIR, `${id}.json`), JSON.stringify({ ...job, lastRun: run }, null, 2) + '\n');
}

export function deleteJob(id: string): boolean {
  const path = resolve(JOBS_DIR, `${id}.json`);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/** 사이트 로그인 정보. 저장하면 오픈 시각에 사람 없이도 로그인할 수 있습니다. */
export function saveCredentials(creds: Credentials): void {
  ensureDirs();
  writeFileSync(SECRETS, JSON.stringify(creds, null, 2) + '\n');
  try {
    chmodSync(SECRETS, 0o600);
  } catch {}
}

export function loadCredentials(): Credentials | undefined {
  if (!existsSync(SECRETS)) return undefined;
  try {
    const c = JSON.parse(readFileSync(SECRETS, 'utf8')) as Credentials;
    return c.username && c.password ? c : undefined;
  } catch {
    return undefined;
  }
}

export function hasCredentials(): boolean {
  return loadCredentials() !== undefined;
}

export function clearCredentials(): void {
  if (existsSync(SECRETS)) rmSync(SECRETS);
}
