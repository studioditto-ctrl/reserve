/*
 * Chrome 개발자도구 콘솔(F12 → Console)에 붙여넣어 실행하세요.
 *
 * 이미 로그인된 브라우저에서 그대로 쓸 수 있어, CLI 를 돌리지 않고도
 * 프로필에 필요한 값을 한 번에 뽑습니다. 결과는 콘솔에 찍히고
 * 클립보드에도 복사됩니다(copy() 가 되는 경우).
 *
 * 뽑는 것:
 *   1. 링크에 붙은 location/room 코드 (호실 코드 확인용)
 *   2. 드롭다운의 option 목록
 *   3. 폼 입력칸과 라벨 (신청 폼 단계용)
 */
(() => {
  const out = [];
  const t = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  out.push('URL: ' + location.href);

  out.push('\n[링크 location 코드]');
  const seen = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      const u = new URL(a.href, location.href);
      u.searchParams.forEach((v, k) => {
        const key = k + '=' + v;
        if (/location|room|place|hall/i.test(k) && !seen.has(key)) {
          seen.add(key);
          out.push('  ' + k + '=' + v + '  ← ' + t(a).slice(0, 40));
        }
      });
    } catch (e) {}
  });

  out.push('\n[드롭다운]');
  document.querySelectorAll('select').forEach((s) => {
    out.push('  select id=' + s.id + ' name=' + s.name);
    [...s.options].slice(0, 40).forEach((o) => out.push('     ' + o.value + '  ' + t(o).slice(0, 40)));
  });

  out.push('\n[폼 입력칸]');
  document.querySelectorAll('input, select, textarea, button').forEach((e) => {
    if (e.type === 'hidden') return;
    const label =
      (e.closest('label') ? t(e.closest('label')) : '') ||
      (e.previousElementSibling ? t(e.previousElementSibling) : '') ||
      e.placeholder || e.getAttribute('aria-label') || '';
    out.push(
      '  <' + e.tagName.toLowerCase() + '> type=' + (e.type || '') +
      ' id=' + (e.id || '') + ' name=' + (e.name || '') + '  ← ' + label.slice(0, 40),
    );
  });

  const result = out.join('\n');
  console.log(result);
  try { copy(result); console.log('\n(클립보드에 복사했습니다)'); } catch (e) {}
  return result;
})();
