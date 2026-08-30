import type { Page } from 'playwright';

export interface LoginGuess {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  formSelector?: string;
}

export interface ListGuess {
  slotSelector: string;
  count: number;
  samples: string[];
  hasTime: boolean;
  timeSelector?: string;
  priceSelector?: string;
  unavailableSelector?: string;
  linkSelector?: string;
}

export interface InspectReport {
  url: string;
  title: string;
  login: LoginGuess;
  lists: ListGuess[];
  loginStateCandidates: string[];
}

/**
 * 페이지를 훑어 프로필에 넣을 셀렉터 후보를 뽑습니다.
 * 완벽한 추론은 불가능하므로 "후보"를 보여주고 사람이 고르게 하는 것이 목적입니다.
 */
export async function inspectPage(page: Page): Promise<InspectReport> {
  return page.evaluate(() => {
    // tsx(esbuild) 는 함수에 __name 헬퍼를 붙이는데, 브라우저 컨텍스트에는 그 헬퍼가 없습니다.
    // 이 함수는 문자열로 직렬화되어 페이지 안에서 실행되므로 먼저 채워 둡니다.
    (globalThis as unknown as Record<string, unknown>).__name ??= function (f: unknown) {
      return f;
    };

    const SOLD_OUT = /(매진|마감|품절|종료|불가|대기|완료|full|sold\s*out|closed)/i;
    const TIME = /\b([0-2]?\d):([0-5]\d)\b/;
    const PRICE = /[\d,]{3,}\s*(원|won|₩)|₩\s*[\d,]{3,}/i;
    const LOGGED_IN = /(로그아웃|logout|마이페이지|마이 페이지|내정보|내 정보|sign\s*out)/i;

    const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    /** 요소를 가리키는 짧고 안정적인 CSS 셀렉터를 만듭니다. */
    const sel = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      const classes = Array.from(el.classList).filter((c) => !/^(is-|has-)?(active|selected|on|open)$/i.test(c));
      if (classes.length) return `${el.tagName.toLowerCase()}.${classes.map((c) => CSS.escape(c)).join('.')}`;
      return el.tagName.toLowerCase();
    };

    /** 그룹 내부에서 특정 조건을 만족하는 자식의 셀렉터를 찾습니다. */
    const childSelector = (root: Element, test: (t: string) => boolean): string | undefined => {
      const kids = Array.from(root.querySelectorAll('*')).filter(
        (k) => k.children.length === 0 && test(text(k)),
      );
      const withClass = kids.find((k) => k.classList.length > 0);
      return withClass ? `.${Array.from(withClass.classList).map((c) => CSS.escape(c)).join('.')}` : undefined;
    };

    // ── 로그인 폼 ──────────────────────────────────────────
    const login: LoginGuess = {};
    const pw = document.querySelector('input[type="password"]');
    if (pw) {
      login.passwordSelector = sel(pw);
      const form = pw.closest('form');
      if (form) login.formSelector = sel(form);
      const scope: ParentNode = form ?? document;
      const idInput = Array.from(
        scope.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'),
      ).find((i) => !(i as HTMLInputElement).disabled);
      if (idInput) login.usernameSelector = sel(idInput);
      const submit = scope.querySelector('button[type="submit"], input[type="submit"], button');
      if (submit) login.submitSelector = sel(submit);
    }

    // ── 로그인 상태 판별에 쓸 만한 요소 ──────────────────────
    const loginStateCandidates = Array.from(document.querySelectorAll('a, button, span, div'))
      .filter((el) => el.children.length === 0 && LOGGED_IN.test(text(el)))
      .slice(0, 6)
      .map((el) => `${sel(el)}   ← "${text(el).slice(0, 30)}"`);

    // ── 반복되는 목록 블록 ─────────────────────────────────
    const groups = new Map<string, Element[]>();
    for (const el of Array.from(document.querySelectorAll('[class]'))) {
      const classes = Array.from(el.classList)
        .filter((c) => !/^(is-|has-)/.test(c))
        .sort();
      if (!classes.length) continue;
      // 태그별(div.slot)과 태그 무시(.slot) 두 가지로 모읍니다.
      // 예약 가능한 항목은 <a>, 매진은 <div> 처럼 태그가 갈리는 사이트가 흔합니다.
      for (const key of [`${el.tagName.toLowerCase()}.${classes.join('.')}`, `.${classes.join('.')}`]) {
        const bucket = groups.get(key);
        if (bucket) bucket.push(el);
        else groups.set(key, [el]);
      }
    }

    const lists: ListGuess[] = [];
    for (const [key, els] of groups) {
      if (els.length < 3) continue;
      // 같은 부모를 공유하는 형제들만 목록으로 봅니다.
      const parents = new Map<Element | null, number>();
      for (const el of els) parents.set(el.parentElement, (parents.get(el.parentElement) ?? 0) + 1);
      const siblings = Math.max(...parents.values());
      if (siblings < 3) continue;

      const bodies = els.map(text).filter((t) => t.length >= 2 && t.length <= 300);
      if (bodies.length < 3) continue;

      const first = els[0]!;
      const hasTime = bodies.some((t) => TIME.test(t));
      const anchor = first.matches('a[href]') ? 'self' : first.querySelector('a[href]') ? 'a' : undefined;

      lists.push({
        slotSelector: key,
        count: els.length,
        samples: bodies.slice(0, 3).map((t) => t.slice(0, 80)),
        hasTime,
        ...(childSelector(first, (t) => TIME.test(t)) ? { timeSelector: childSelector(first, (t) => TIME.test(t))! } : {}),
        ...(childSelector(first, (t) => PRICE.test(t)) ? { priceSelector: childSelector(first, (t) => PRICE.test(t))! } : {}),
        ...(els.map((e) => childSelector(e, (t) => SOLD_OUT.test(t))).find(Boolean)
          ? { unavailableSelector: els.map((e) => childSelector(e, (t) => SOLD_OUT.test(t))).find(Boolean)! }
          : {}),
        ...(anchor ? { linkSelector: anchor } : {}),
      });
    }

    // 같은 클래스라면 태그를 붙이지 않은 쪽이 더 많이 잡히므로 그쪽만 남깁니다.
    const byClassOnly = new Map(lists.filter((l) => l.slotSelector.startsWith('.')).map((l) => [l.slotSelector, l]));
    const deduped = lists.filter((l) => {
      if (l.slotSelector.startsWith('.')) return true;
      const classOnly = byClassOnly.get(l.slotSelector.slice(l.slotSelector.indexOf('.')));
      return !classOnly || classOnly.count < l.count;
    });

    // 시간 표기가 있고 항목이 많은 목록을 위로 올립니다.
    deduped.sort((a, b) => Number(b.hasTime) - Number(a.hasTime) || b.count - a.count);

    return {
      url: location.href,
      title: document.title,
      login,
      lists: deduped.slice(0, 6),
      loginStateCandidates,
    };
  });
}

/** 조사 결과를 사람이 읽을 수 있게, 그리고 프로필 초안으로 출력합니다. */
export function formatReport(r: InspectReport): string {
  const out: string[] = [];
  out.push(`\n페이지: ${r.title}\n${r.url}\n`);

  out.push('── 로그인 폼 ────────────────────────────────');
  if (r.login.passwordSelector) {
    out.push(`  usernameSelector: ${r.login.usernameSelector ?? '(못 찾음)'}`);
    out.push(`  passwordSelector: ${r.login.passwordSelector}`);
    out.push(`  submitSelector:   ${r.login.submitSelector ?? '(못 찾음)'}`);
  } else {
    out.push('  이 페이지에는 비밀번호 입력칸이 없습니다. 로그인 페이지 URL 로 다시 실행하세요.');
  }

  if (r.loginStateCandidates.length) {
    out.push('\n── successSelector 후보 (로그인 상태에서만 보이는 요소) ──');
    for (const c of r.loginStateCandidates) out.push(`  ${c}`);
  }

  out.push('\n── 반복되는 목록 블록 (slotSelector 후보) ────');
  if (!r.lists.length) {
    out.push('  반복 블록을 찾지 못했습니다. 목록이 그려진 뒤에 실행했는지 확인하세요.');
  }
  for (const [i, l] of r.lists.entries()) {
    out.push(`\n  [${i + 1}] ${l.slotSelector}   (${l.count}개${l.hasTime ? ', 시간 표기 있음 ★' : ''})`);
    for (const s of l.samples) out.push(`       "${s}"`);
    const fields = [
      l.timeSelector && `time: ${l.timeSelector}`,
      l.priceSelector && `price: ${l.priceSelector}`,
      l.unavailableSelector && `unavailable: ${l.unavailableSelector}`,
      l.linkSelector && `url: ${l.linkSelector}`,
    ].filter(Boolean);
    if (fields.length) out.push(`       ${fields.join('  |  ')}`);
  }

  const best = r.lists[0];
  if (best) {
    out.push('\n── 프로필 초안 (config/*.profile.json 에 붙여넣고 다듬으세요) ──');
    out.push(
      JSON.stringify(
        {
          search: {
            urlTemplate: r.url.replace(/\d{4}-\d{2}-\d{2}/, '{date}'),
            waitFor: best.slotSelector,
            slotSelector: best.slotSelector,
            ...(best.unavailableSelector ? { unavailableSelector: best.unavailableSelector } : {}),
            fields: {
              ...(best.timeSelector ? { time: best.timeSelector } : {}),
              ...(best.priceSelector ? { price: best.priceSelector } : {}),
              ...(best.linkSelector ? { url: best.linkSelector } : {}),
            },
          },
          ...(r.login.passwordSelector ? { login: r.login } : {}),
        },
        null,
        2,
      ),
    );
  }
  return out.join('\n');
}
