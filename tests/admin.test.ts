import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * 어드민 페이지(docs/index.html)가 스스로 깨지지 않았는지 봅니다.
 *
 * 화면은 브라우저에서만 도니까, 없는 id 를 건드리면 아무 말 없이 그 자리에서
 * 멈춥니다. 실제로 `progress-idle` 하나가 빠져 "지금 예약하기" 가 통째로
 * 죽은 적이 있습니다. 눈으로 못 보는 것을 여기서 잡습니다.
 */
const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');

test('$("...") 로 찾는 요소가 모두 문서에 있다', () => {
  const wanted = [...html.matchAll(/\$\("([A-Za-z0-9-]+)"\)/g)].map((m) => m[1]!);
  const missing = [...new Set(wanted)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `없는 id 를 건드립니다: ${missing.join(', ')}`);
  assert.ok(wanted.length > 20, '스크립트를 제대로 읽었는지 확인');
});

test('열고 닫는 div 수가 맞는다', () => {
  const open = (html.match(/<div\b/g) || []).length;
  const close = (html.match(/<\/div>/g) || []).length;
  assert.equal(open, close, 'div 가 짝이 맞지 않으면 단 구성이 무너집니다');
});

test('스크립트가 문법적으로 성립한다', () => {
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, '<script> 를 찾지 못했습니다');
  assert.doesNotThrow(() => new Function(script!));
});
