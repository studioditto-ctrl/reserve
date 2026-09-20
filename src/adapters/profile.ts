import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from 'playwright';
import { resolveValue } from '../config.js';
import { log } from '../logger.js';
import { snapshot } from '../browser.js';
import { minutesToHHMM, parseTimeLabels } from '../timelabel.js';
import type { BookOptions, BookingResult, Credentials, JobTarget, RoomRef, SiteAdapter, Slot } from '../types.js';

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
  /**
   * 페이지를 열 때마다 닫아야 하는 공지/알림 팝업의 닫기 버튼들.
   * 화면에 보일 때만 누르고, 없으면 조용히 넘어갑니다.
   */
  dismiss?: string[];
  /** window.open 으로 뜨는 별도 팝업 창을 자동으로 닫습니다. */
  closePopupWindows?: boolean;
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
    /**
     * 아이디·비밀번호를 채운 뒤, 제출을 누르기 전에 할 일.
     * "자동 로그인" 체크 같은 것을 여기 적습니다.
     */
    beforeSubmit?: Step[];
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
    /**
     * 시간대가 체크박스로 제공되는 사이트.
     * 30분 칸 두 개로 1시간을 예약하는 식이라, 필요한 칸을 모두 골라 한 번에 신청합니다.
     * 이 설정이 있으면 slotSelector 대신 이쪽이 쓰입니다.
     */
    checkboxTimes?: {
      /** 체크박스 요소들. 예: 'input[name="reservation[time]"]' */
      selector: string;
      /**
       * 라벨 글자를 읽을 위치. 'label' 이면 감싸는 <label>,
       * 그 밖에는 체크박스 기준 상대 셀렉터. 기본값 'label'.
       */
      labelFrom?: string;
    };
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

function slotId(date: string, room: string | undefined, time: string | undefined, label: string): string {
  return createHash('sha1').update(`${date}|${room ?? ''}|${time ?? ''}|${label}`).digest('hex').slice(0, 12);
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
  opts: BookOptions,
): Promise<{ stoppedBeforeConfirm: boolean }> {
  for (const step of steps) {
    if (step.final && opts.dryRun) {
      log.warn(`dry-run: 최종 확정 단계(${step.selector ?? step.action}) 직전에서 멈춥니다.`);
      return { stoppedBeforeConfirm: true };
    }
    try {
      await runStep(page, step, opts.values);
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

async function runStep(page: Page, step: Step, values?: Record<string, string>): Promise<void> {
  const value = step.valueFrom ? resolveValue(step.valueFrom, values) : step.value;
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


/** 체크박스 시간표의 칸 하나. */
interface TimeCell {
  index: number;
  label: string;
  available: boolean;
}

/**
 * 프로필 JSON 하나로 동작하는 어댑터.
 * 새 사이트를 붙일 때 코드를 짤 필요 없이 셀렉터만 채우면 됩니다.
 */
export class ProfileAdapter implements SiteAdapter {
  constructor(private readonly profile: SiteProfile) {}

  private popupHookInstalled = false;

  get name(): string {
    return this.profile.name;
  }

  /** 새 창으로 뜨는 팝업을 자동으로 닫도록 한 번만 걸어 둡니다. */
  private hookPopups(page: Page): void {
    if (this.popupHookInstalled || !this.profile.closePopupWindows) return;
    this.popupHookInstalled = true;
    page.context().on('page', (opened) => {
      if (opened !== page) {
        log.info('팝업 창을 닫았습니다.');
        opened.close().catch(() => {});
      }
    });
  }

  /** 화면을 가리는 공지 팝업을 닫습니다. 없으면 아무 일도 하지 않습니다. */
  private async dismissPopups(page: Page): Promise<void> {
    for (const selector of this.profile.dismiss ?? []) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await el.click({ timeout: 3_000 }).catch(() => {});
      }
    }
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    const { login } = this.profile;
    this.hookPopups(page);
    await page.goto(login.checkUrl ?? login.url, { waitUntil: 'domcontentloaded' });
    await this.dismissPopups(page);
    return page
      .locator(login.successSelector)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
  }

  async login(page: Page, creds: Credentials, opts: { manual: boolean }): Promise<void> {
    const { login } = this.profile;
    this.hookPopups(page);
    await page.goto(login.url, { waitUntil: 'domcontentloaded' });
    await this.dismissPopups(page);

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
      if (login.beforeSubmit?.length) await runSteps(page, login.beforeSubmit, { dryRun: false });
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


  /** 체크박스 시간표를 한 번에 읽어옵니다 (칸마다 왕복하지 않도록 페이지 안에서 처리). */
  private async readTimeCells(page: Page): Promise<TimeCell[]> {
    const cfg = this.profile.search.checkboxTimes!;
    return page.evaluate(
      ({ selector, labelFrom, unavailable }) => {
        (globalThis as unknown as Record<string, unknown>).__name ??= function (f: unknown) {
          return f;
        };
        const nodes = Array.from(document.querySelectorAll(selector)) as HTMLInputElement[];
        return nodes.map((el, index) => {
          const wrapping = el.closest('label');
          const labelEl =
            labelFrom && labelFrom !== 'label'
              ? (el.parentElement?.querySelector(labelFrom) ?? null)
              : wrapping;
          const label = ((labelEl ?? el.parentElement)?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const scope = wrapping ?? el.parentElement;
          // 예약 불가 표시는 감싸는 요소 "자신"의 class 인 경우와
          // 그 안의 별도 요소("마감" 배지)인 경우가 둘 다 있습니다.
          const marked = unavailable
            ? Boolean(scope?.matches(unavailable)) || Boolean(scope?.querySelector(unavailable))
            : false;
          const blocked = el.disabled || el.getAttribute('aria-disabled') === 'true' || marked;
          return { index, label, available: !blocked };
        });
      },
      {
        selector: cfg.selector,
        labelFrom: cfg.labelFrom ?? 'label',
        unavailable: this.profile.search.unavailableSelector ?? null,
      },
    );
  }

  /**
   * 원하는 시간대를 덮는 칸들을 찾습니다.
   * 하나라도 비어 있지 않으면 undefined — 1시간을 통째로 못 잡으면 의미가 없기 때문입니다.
   */
  private pickTimeRange(
    cells: TimeCell[],
    target: JobTarget,
  ): { times: string[]; label: string } | undefined {
    const minutes = parseTimeLabels(cells.map((c) => c.label));
    const known = minutes.filter((m): m is number => m !== undefined).sort((a, b) => a - b);
    if (known.length < 2 || !target.timeFrom) return undefined;

    // 칸 간격(보통 30분)은 목록에서 직접 알아냅니다.
    const gaps = known.slice(1).map((m, i) => m - known[i]!).filter((g) => g > 0);
    const step = gaps.length ? Math.min(...gaps) : 30;
    const start = parseTimeLabels([target.timeFrom])[0];
    if (start === undefined) return undefined;

    const span = target.durationMin ?? step;
    const wanted: number[] = [];
    for (let t = start; t < start + span; t += step) wanted.push(t);

    const times: string[] = [];
    for (const want of wanted) {
      const idx = minutes.findIndex((m) => m === want);
      if (idx < 0 || !cells[idx]!.available) return undefined;
      times.push(minutesToHHMM(want));
    }
    return {
      times,
      label: `${minutesToHHMM(start)}~${minutesToHHMM(start + span)} (${times.length}칸)`,
    };
  }

  async findSlots(page: Page, target: JobTarget): Promise<Slot[]> {
    this.hookPopups(page);
    // rooms 가 있으면 적힌 순서대로 확인합니다. 먼저 발견된 자리가 먼저 예약됩니다.
    const rooms: (RoomRef | undefined)[] = target.rooms?.length
      ? target.rooms.map((r) => (typeof r === 'string' ? { id: r } : r))
      : [undefined];
    const found: Slot[] = [];
    for (const date of target.dates) {
      for (const room of rooms) {
        found.push(...(await this.findSlotsForDate(page, date, room, target)));
      }
    }
    return found;
  }

  private async findSlotsForDate(
    page: Page,
    date: string,
    room: RoomRef | undefined,
    target: JobTarget,
  ): Promise<Slot[]> {
    const { search } = this.profile;
    const url = fillTemplate(search.urlTemplate, {
      date,
      room: room?.id,
      party: target.party,
      time: target.timeFrom,
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.dismissPopups(page);
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

    // ── 체크박스 시간표: 필요한 칸을 모두 잡을 수 있을 때만 후보로 내놓습니다 ──
    if (search.checkboxTimes) {
      const picked = this.pickTimeRange(await this.readTimeCells(page), target);
      if (!picked) return [];
      const [first] = picked.times;
      return [
        {
          id: slotId(date, room?.id, first, picked.label),
          label: `${date} ${room ? `${room.label ?? room.id} ` : ''}${picked.label}`,
          date,
          ...(room ? { room: room.id } : {}),
          ...(first ? { time: first } : {}),
          parts: picked.times,
          searchUrl: url,
        },
      ];
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
        id: slotId(date, room?.id, parsedTime, label),
        label: `${date} ${room ? `${room.label ?? room.id} ` : ''}${label}`,
        date,
        ...(room ? { room: room.id } : {}),
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

  async book(page: Page, slot: Slot, opts: BookOptions): Promise<BookingResult> {
    const { search, book } = this.profile;

    // 슬롯 목록을 다시 띄운 뒤, 인덱스가 아니라 라벨로 같은 자리를 다시 찾습니다.
    // (감시 중에 목록 순서가 바뀌어도 엉뚱한 자리를 잡지 않게 하기 위함)
    const url =
      slot.searchUrl ??
      fillTemplate(search.urlTemplate, {
        date: slot.date,
        room: slot.room,
        party: slot.party,
        time: slot.time,
      });
    this.hookPopups(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.dismissPopups(page);
    if (search.preSteps?.length) await runSteps(page, search.preSteps, { dryRun: false });

    // ── 체크박스 시간표: 저장해 둔 칸들을 다시 찾아 모두 체크합니다 ──
    if (search.checkboxTimes) {
      const cells = await this.readTimeCells(page);
      const minutes = parseTimeLabels(cells.map((c) => c.label));
      const boxes = page.locator(search.checkboxTimes.selector);

      for (const want of slot.parts ?? []) {
        const wantMin = parseTimeLabels([want])[0];
        const idx = minutes.findIndex((m) => m !== undefined && minutesToHHMM(m) === want && m === wantMin);
        if (idx < 0 || !cells[idx]!.available) {
          return { ok: false, message: `${want} 칸이 사라졌습니다 (다른 사람이 먼저 잡음): ${slot.label}` };
        }
        await boxes.nth(idx).check();
      }

      const { stoppedBeforeConfirm } = await runSteps(page, book.steps, opts);
      return this.finishBooking(page, slot, book, stoppedBeforeConfirm);
    }

    let targetNode: Locator | undefined;
    const nodes = page.locator(search.slotSelector);
    const count = await nodes.count();
    for (let i = 0; i < count; i++) {
      const node = nodes.nth(i);
      const label = await textOf(node, search.fields?.label);
      const time = search.fields?.time ? await textOf(node, search.fields.time) : label;
      if (slotId(slot.date, slot.room, HHMM.exec(time)?.[0], label) === slot.id) {
        targetNode = node;
        break;
      }
    }
    if (!targetNode) {
      return { ok: false, message: `자리가 사라졌습니다 (다른 사람이 먼저 잡음): ${slot.label}` };
    }

    if (book.clickSlot !== false) await targetNode.click();

    const { stoppedBeforeConfirm } = await runSteps(page, book.steps, opts);
    return this.finishBooking(page, slot, book, stoppedBeforeConfirm);
  }

  /** 신청을 마친 뒤 완료 화면을 확인하고 결과를 만듭니다. */
  private async finishBooking(
    page: Page,
    slot: Slot,
    book: SiteProfile['book'],
    stoppedBeforeConfirm: boolean,
  ): Promise<BookingResult> {
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
