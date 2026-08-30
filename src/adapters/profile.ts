import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from 'playwright';
import { resolveValue } from '../config.js';
import { log } from '../logger.js';
import { snapshot } from '../browser.js';
import type { BookingResult, Credentials, JobTarget, SiteAdapter, Slot } from '../types.js';

/** 예약 흐름의 한 단계. 사이트마다 다른 클릭 순서를 JSON 으로 기술합니다. */
export interface Step {
  action: 'goto' | 'click' | 'fill' | 'select' | 'check' | 'press' | 'waitFor' | 'wait';
  selector?: string;
  /** goto 의 URL, press 의 키, wait 의 밀리초 */
  value?: string;
  /** fill/select 값의 출처. "env:BOOKING_NAME" 처럼 쓰면 .env 에서 가져옵니다. */
  valueFrom?: string;
  /** 요소가 없어도 그냥 넘어갑니다 (선택 약관 등). */
  optional?: boolean;
  /**
   * 되돌릴 수 없는 최종 확정 단계. dry-run 에서는 이 단계 직전에 멈춥니다.
   * 결제/예약확정 버튼에 반드시 표시하세요.
   */
  final?: boolean;
}

export interface SiteProfile {
  name: string;
  baseUrl?: string;
  login: {
    url: string;
    /** 로그인 상태를 확인할 페이지. 없으면 login.url 을 씁니다. */
    checkUrl?: string;
    /** 이 요소가 보이면 로그인된 것으로 간주합니다. */
    successSelector: string;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    /** 2FA·캡차가 있는 사이트: 사람이 직접 로그인할 때까지 기다립니다. */
    manual?: boolean;
  };
  search: {
    /** {date} {party} {time} 이 치환됩니다. */
    urlTemplate: string;
    /** 목록이 그려질 때까지 기다릴 셀렉터. */
    waitFor?: string;
    /** 슬롯 하나에 대응하는 요소들. */
    slotSelector: string;
    /** 슬롯 요소 안에서 값을 뽑을 상대 셀렉터들. 없으면 요소 전체 텍스트를 씁니다. */
    fields?: { label?: string; time?: string; price?: string; url?: string };
    /** 슬롯 안에 이 요소가 있으면 매진으로 보고 건너뜁니다. */
    unavailableSelector?: string;
    /** 검색 페이지에서 목록을 띄우기 전에 필요한 조작(인원 선택 등). */
    preSteps?: Step[];
  };
  book: {
    /** 슬롯 요소를 먼저 클릭할지 여부. 기본 true. */
    clickSlot?: boolean;
    steps: Step[];
    /** 예약 완료를 확인할 셀렉터. */
    successSelector?: string;
    /** 예약번호를 읽어올 셀렉터. */
    confirmationSelector?: string;
  };
}

export function loadProfile(path: string): SiteProfile {
  const full = resolve(path);
  const profile = JSON.parse(readFileSync(full, 'utf8')) as SiteProfile;
  if (!profile.name) throw new Error(`${full}: "name" 이 필요합니다.`);
  if (!profile.login?.successSelector) throw new Error(`${full}: "login.successSelector" 가 필요합니다.`);
  if (!profile.search?.slotSelector) throw new Error(`${full}: "search.slotSelector" 가 필요합니다.`);
  return profile;
}

function fillTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined ? whole : encodeURIComponent(String(v));
  });
}

const HHMM = /\b([0-2]?\d):([0-5]\d)\b/;

function toMinutes(hhmm: string): number | undefined {
  const m = HHMM.exec(hhmm);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

function slotId(date: string, time: string | undefined, label: string): string {
  return createHash('sha1').update(`${date}|${time ?? ''}|${label}`).digest('hex').slice(0, 12);
}

async function textOf(scope: Locator, selector?: string): Promise<string> {
  const target = selector ? scope.locator(selector).first() : scope;
  const raw = await target.innerText().catch(() => '');
  return raw.replace(/\s+/g, ' ').trim();
}

/** JSON 으로 기술된 단계들을 실행합니다. dryRun 이면 final 단계 직전에 멈춥니다. */
async function runSteps(
  page: Page,
  steps: Step[],
  opts: { dryRun: boolean },
): Promise<{ stoppedBeforeConfirm: boolean }> {
  for (const step of steps) {
    if (step.final && opts.dryRun) {
      log.warn(`dry-run: 최종 확정 단계(${step.selector ?? step.action}) 직전에서 멈춥니다.`);
      return { stoppedBeforeConfirm: true };
    }
    try {
      await runStep(page, step);
    } catch (e) {
      if (step.optional) {
        log.warn(`선택 단계 건너뜀: ${step.action} ${step.selector ?? ''}`);
        continue;
      }
      throw new Error(`단계 실패 [${step.action} ${step.selector ?? step.value ?? ''}]: ${(e as Error).message}`);
    }
  }
  return { stoppedBeforeConfirm: false };
}

async function runStep(page: Page, step: Step): Promise<void> {
  const value = step.valueFrom ? resolveValue(step.valueFrom) : step.value;
  switch (step.action) {
    case 'goto':
      if (!value) throw new Error('goto 에는 value(URL)가 필요합니다.');
      await page.goto(value, { waitUntil: 'domcontentloaded' });
      return;
    case 'click':
      await page.locator(must(step.selector)).first().click();
      return;
    case 'fill':
      if (value === undefined) throw new Error('fill 에는 value 또는 valueFrom 이 필요합니다.');
      await page.locator(must(step.selector)).first().fill(value);
      return;
    case 'select':
      if (value === undefined) throw new Error('select 에는 value 또는 valueFrom 이 필요합니다.');
      await page.locator(must(step.selector)).first().selectOption(value);
      return;
    case 'check':
      await page.locator(must(step.selector)).first().check();
      return;
    case 'press':
      await page.locator(must(step.selector)).first().press(value ?? 'Enter');
      return;
    case 'waitFor':
      await page.locator(must(step.selector)).first().waitFor({ state: 'visible' });
      return;
    case 'wait':
      await page.waitForTimeout(Number(value ?? 500));
      return;
  }
}

function must(selector: string | undefined): string {
  if (!selector) throw new Error('이 단계에는 selector 가 필요합니다.');
  return selector;
}

/**
 * 프로필 JSON 하나로 동작하는 어댑터.
 * 새 사이트를 붙일 때 코드를 짤 필요 없이 셀렉터만 채우면 됩니다.
 */
export class ProfileAdapter implements SiteAdapter {
  constructor(private readonly profile: SiteProfile) {}

  get name(): string {
    return this.profile.name;
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    const { login } = this.profile;
    await page.goto(login.checkUrl ?? login.url, { waitUntil: 'domcontentloaded' });
    return page
      .locator(login.successSelector)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
  }

  async login(page: Page, creds: Credentials, opts: { manual: boolean }): Promise<void> {
    const { login } = this.profile;
    await page.goto(login.url, { waitUntil: 'domcontentloaded' });

    const manual = opts.manual || login.manual;
    if (manual) {
      log.info('브라우저 창에서 직접 로그인하세요. 완료되면 자동으로 감지합니다 (최대 5분).');
    } else {
      if (!login.usernameSelector || !login.passwordSelector) {
        throw new Error(
          '프로필에 usernameSelector/passwordSelector 가 없습니다. `--manual` 로 직접 로그인하세요.',
        );
      }
      await page.locator(login.usernameSelector).first().fill(creds.username);
      await page.locator(login.passwordSelector).first().fill(creds.password);
      if (login.submitSelector) await page.locator(login.submitSelector).first().click();
      else await page.locator(login.passwordSelector).first().press('Enter');
    }

    await page
      .locator(login.successSelector)
      .first()
      .waitFor({ state: 'visible', timeout: manual ? 300_000 : 30_000 })
      .catch(async () => {
        const shot = await snapshot(page, 'login-fail');
        throw new Error(`로그인 확인에 실패했습니다. 화면: ${shot}`);
      });
  }

  async findSlots(page: Page, target: JobTarget): Promise<Slot[]> {
    const found: Slot[] = [];
    for (const date of target.dates) {
      found.push(...(await this.findSlotsForDate(page, date, target)));
    }
    return found;
  }

  private async findSlotsForDate(page: Page, date: string, target: JobTarget): Promise<Slot[]> {
    const { search } = this.profile;
    const url = fillTemplate(search.urlTemplate, {
      date,
      party: target.party,
      time: target.timeFrom,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (search.preSteps?.length) await runSteps(page, search.preSteps, { dryRun: false });
    if (search.waitFor) {
      const appeared = await page
        .locator(search.waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      // 목록 컨테이너가 아예 안 뜨면 그 날짜는 자리가 없는 것으로 봅니다.
      if (!appeared) return [];
    }

    const nodes = page.locator(search.slotSelector);
    const count = await nodes.count();
    const slots: Slot[] = [];

    for (let i = 0; i < count; i++) {
      const node = nodes.nth(i);
      if (search.unavailableSelector) {
        const soldOut = await node.locator(search.unavailableSelector).count();
        if (soldOut > 0) continue;
      }
      const label = await textOf(node, search.fields?.label);
      if (!label) continue;
      const time = search.fields?.time ? await textOf(node, search.fields.time) : label;
      const price = search.fields?.price ? await textOf(node, search.fields.price) : undefined;
      // fields.url 이 "self" 면 슬롯 요소 자신의 href 를, 아니면 하위 요소의 href 를 읽습니다.
      const href = !search.fields?.url
        ? null
        : search.fields.url === 'self'
          ? await node.getAttribute('href').catch(() => null)
          : await node.locator(search.fields.url).first().getAttribute('href').catch(() => null);

      const parsedTime = HHMM.exec(time)?.[0];
      const slot: Slot = {
        id: slotId(date, parsedTime, label),
        label: `${date} ${label}`,
        date,
        ...(parsedTime ? { time: parsedTime } : {}),
        ...(price ? { price } : {}),
        ...(href ? { url: new URL(href, page.url()).toString() } : {}),
        ...(target.party !== undefined ? { party: target.party } : {}),
        searchUrl: url,
      };
      if (matchesTarget(slot, target)) slots.push(slot);
    }
    return slots;
  }

  async book(page: Page, slot: Slot, opts: { dryRun: boolean }): Promise<BookingResult> {
    const { search, book } = this.profile;

    // 슬롯 목록을 다시 띄운 뒤, 인덱스가 아니라 라벨로 같은 자리를 다시 찾습니다.
    // (감시 중에 목록 순서가 바뀌어도 엉뚱한 자리를 잡지 않게 하기 위함)
    const url =
      slot.searchUrl ??
      fillTemplate(search.urlTemplate, { date: slot.date, party: slot.party, time: slot.time });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (search.preSteps?.length) await runSteps(page, search.preSteps, { dryRun: false });

    let targetNode: Locator | undefined;
    const nodes = page.locator(search.slotSelector);
    const count = await nodes.count();
    for (let i = 0; i < count; i++) {
      const node = nodes.nth(i);
      const label = await textOf(node, search.fields?.label);
      const time = search.fields?.time ? await textOf(node, search.fields.time) : label;
      if (slotId(slot.date, HHMM.exec(time)?.[0], label) === slot.id) {
        targetNode = node;
        break;
      }
    }
    if (!targetNode) {
      return { ok: false, message: `자리가 사라졌습니다 (다른 사람이 먼저 잡음): ${slot.label}` };
    }

    if (book.clickSlot !== false) await targetNode.click();

    const { stoppedBeforeConfirm } = await runSteps(page, book.steps, opts);
    if (stoppedBeforeConfirm) {
      const shot = await snapshot(page, 'dryrun');
      return {
        ok: true,
        stoppedBeforeConfirm: true,
        message: `dry-run: 최종 확정 직전까지 도달했습니다. 화면: ${shot}`,
        screenshot: shot,
      };
    }

    if (book.successSelector) {
      const done = await page
        .locator(book.successSelector)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!done) {
        const shot = await snapshot(page, 'book-fail');
        return { ok: false, message: `예약 완료 화면을 확인하지 못했습니다. 화면: ${shot}`, screenshot: shot };
      }
    }

    const code = book.confirmationSelector
      ? await textOf(page.locator(book.confirmationSelector).first())
      : undefined;
    const shot = await snapshot(page, 'booked');
    return {
      ok: true,
      ...(code ? { confirmationCode: code } : {}),
      message: `예약 완료: ${slot.label}${code ? ` (예약번호 ${code})` : ''}`,
      screenshot: shot,
    };
  }
}

/** 슬롯이 사용자의 조건에 맞는지 판정합니다. */
export function matchesTarget(slot: Slot, target: JobTarget): boolean {
  const label = slot.label.toLowerCase();
  if (target.keywords?.length && !target.keywords.every((k) => label.includes(k.toLowerCase()))) return false;
  if (target.exclude?.length && target.exclude.some((k) => label.includes(k.toLowerCase()))) return false;

  if (target.timeFrom || target.timeTo) {
    const mins = slot.time ? toMinutes(slot.time) : undefined;
    // 시간을 못 읽은 슬롯은 시간 조건이 걸려 있으면 제외합니다 (잘못 예약하는 것보다 낫습니다).
    if (mins === undefined) return false;
    const from = target.timeFrom ? toMinutes(target.timeFrom) : undefined;
    const to = target.timeTo ? toMinutes(target.timeTo) : undefined;
    if (from !== undefined && mins < from) return false;
    if (to !== undefined && mins > to) return false;
  }
  return true;
}
