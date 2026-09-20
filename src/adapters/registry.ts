import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProfileAdapter, loadProfile } from './profile.js';
import type { SiteAdapter } from '../types.js';

/** 내장 프로필 별칭. */
const BUILTIN: Record<string, string> = {
  mock: 'config/mock.profile.json',
};

/**
 * 작업 파일의 "adapter" 값을 실제 어댑터로 바꿔줍니다.
 * 값은 프로필 JSON 경로이거나 내장 별칭("mock")입니다.
 */
export function loadAdapter(spec: string): SiteAdapter {
  const path = BUILTIN[spec] ?? spec;
  const full = resolve(path);
  if (!existsSync(full)) {
    throw new Error(
      `어댑터 프로필을 찾을 수 없습니다: ${full}\n` +
        `config/example.profile.json 을 복사해서 사이트 셀렉터를 채우세요.`,
    );
  }
  return new ProfileAdapter(loadProfile(full));
}
