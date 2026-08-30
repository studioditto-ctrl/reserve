/**
 * 로컬 테스트용 가짜 예약 사이트.
 * 실제 사이트를 건드리지 않고 로그인 → 감시 → 예약 전 과정을 검증하기 위한 것입니다.
 *
 *   npm run mock            # http://localhost:8787
 *   MOCK_OPEN_AFTER=20 npm run mock   # 20초 뒤에 빈자리가 생기는 시나리오
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const USER = process.env.MOCK_USER ?? 'demo';
const PASS = process.env.MOCK_PASS ?? 'demo1234';
/** 이 시간(초)이 지나야 빈자리가 열립니다. 0 이면 처음부터 열려 있습니다. */
const OPEN_AFTER_MS = Number(process.env.MOCK_OPEN_AFTER ?? 0) * 1000;

const START = Date.now();
const SESSIONS = new Set<string>();
const TIMES = ['17:30', '18:00', '19:00', '19:30', '20:30'];
/** 열려 있는 시간대. 나머지는 매진으로 표시됩니다. */
const OPEN_TIMES = new Set(['19:00', '20:30']);
/** 장소예약 모드: 이 호실만 비어 있습니다 (나머지 호실 순회를 시험하기 위함). */
const ROOM_TIMES = ['09:00', '10:00', '11:00', '13:00', '14:00'];
const FREE_ROOM = process.env.MOCK_FREE_ROOM ?? '315';
const booked = new Map<string, string>();

const page = (title: string, body: string) => `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:640px}
.slot{display:block;padding:10px 14px;margin:6px 0;border:1px solid #ccc;border-radius:8px;text-decoration:none;color:#111}
.sold-out{color:#c00;font-size:13px}.done{color:#0a0;font-weight:700}</style>
</head><body><h1>맛집예약 (MOCK)</h1>${body}</body></html>`;

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p): p is [string, string] => p.length === 2),
  );
}

const loggedIn = (req: IncomingMessage) => SESSIONS.has(cookies(req).sid ?? '');

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function redirect(res: ServerResponse, to: string, headers: Record<string, string> = {}) {
  res.writeHead(302, { location: to, ...headers });
  res.end();
}

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/login' && req.method === 'GET') {
    return send(res, 200, page('로그인', `<form method="post" action="/login">
      <p><input id="userid" name="userid" placeholder="아이디"></p>
      <p><input id="userpw" name="userpw" type="password" placeholder="비밀번호"></p>
      <p><button id="login-btn" type="submit">로그인</button></p>
      <p style="color:#888;font-size:13px">데모 계정: ${USER} / ${PASS}</p></form>`));
  }

  if (path === '/login' && req.method === 'POST') {
    const form = await readBody(req);
    if (form.get('userid') === USER && form.get('userpw') === PASS) {
      const sid = Math.random().toString(36).slice(2);
      SESSIONS.add(sid);
      return redirect(res, '/my', { 'set-cookie': `sid=${sid}; Path=/; HttpOnly` });
    }
    return send(res, 401, page('로그인 실패', '<p id="login-error">아이디 또는 비밀번호가 틀렸습니다.</p><a href="/login">다시 시도</a>'));
  }

  if (!loggedIn(req)) return redirect(res, '/login');

  if (path === '/my') {
    return send(res, 200, page('내 정보', '<div id="account">demo 님</div><a href="/booking?date=2026-09-05&party=2">예약하기</a>'));
  }

  if (path === '/booking') {
    const date = url.searchParams.get('date') ?? '';
    const party = url.searchParams.get('party') ?? '2';
    const room = url.searchParams.get('room');

    // 장소예약 모드: 호실별 시간표. FREE_ROOM 만 비어 있습니다.
    if (room) {
      const open = Date.now() - START >= OPEN_AFTER_MS;
      const rows = ROOM_TIMES.map((t) => {
        const key = `${date} ${room} ${t}`;
        const available = open && room === FREE_ROOM && !booked.has(key);
        return available
          ? `<a class="slot" href="/reserve?date=${date}&time=${t}&room=${room}">
               <span class="slot-time">${t}</span> · <span class="slot-room">${room}호</span></a>`
          : `<div class="slot"><span class="slot-time">${t}</span> · <span class="sold-out">예약불가</span></div>`;
      }).join('');
      return send(res, 200, page(`${room}호 예약`, `<div id="slot-list"><h2>${date} · ${room}호</h2>${rows}</div>`));
    }

    const open = Date.now() - START >= OPEN_AFTER_MS;
    const rows = TIMES.map((t) => {
      const key = `${date} ${t}`;
      const available = open && OPEN_TIMES.has(t) && !booked.has(key);
      return available
        ? `<a class="slot" href="/reserve?date=${date}&time=${t}&party=${party}">
             <span class="slot-time">${t}</span> · <span class="slot-seat">홀 ${party}인</span>
             <span class="slot-price">40,000원</span></a>`
        : `<div class="slot"><span class="slot-time">${t}</span> · <span class="sold-out">매진</span></div>`;
    }).join('');
    return send(res, 200, page('예약', `<div id="slot-list"><h2>${date} · ${party}인</h2>${rows}</div>`));
  }

  if (path === '/reserve') {
    const date = url.searchParams.get('date') ?? '';
    const time = url.searchParams.get('time') ?? '';
    const room = url.searchParams.get('room') ?? '';
    return send(res, 200, page('예약자 정보', `<h2>${date} ${time} ${room ? `${room}호` : ''}</h2>
      <form method="post" action="/confirm">
        <input type="hidden" name="date" value="${date}"><input type="hidden" name="time" value="${time}">
        <input type="hidden" name="room" value="${room}">
        <p><input id="name" name="name" placeholder="예약자명"></p>
        <p><input id="phone" name="phone" placeholder="연락처"></p>
        <p><label><input id="agree" name="agree" type="checkbox"> 취소·환불 규정에 동의합니다</label></p>
        <p><button id="confirm-btn" type="submit">예약 확정</button></p>
      </form>`));
  }

  if (path === '/confirm' && req.method === 'POST') {
    const form = await readBody(req);
    const room = form.get('room');
    const key = room
      ? `${form.get('date')} ${room} ${form.get('time')}`
      : `${form.get('date')} ${form.get('time')}`;
    if (!form.get('name') || !form.get('agree')) {
      return send(res, 400, page('오류', '<p id="form-error">예약자명과 약관 동의가 필요합니다.</p>'));
    }
    if (booked.has(key)) return send(res, 409, page('마감', '<p id="form-error">방금 마감되었습니다.</p>'));
    const code = `R${Math.floor(Math.random() * 900000 + 100000)}`;
    booked.set(key, code);
    return send(res, 200, page('예약 완료', `<div class="done">예약이 완료되었습니다</div>
      <div>${key}</div><div class="code">${code}</div>`));
  }

  return send(res, 404, page('없음', '<p>페이지를 찾을 수 없습니다.</p>'));
});

server.listen(PORT, () => {
  console.log(`가짜 예약 사이트: http://localhost:${PORT}  (계정 ${USER}/${PASS})`);
  if (OPEN_AFTER_MS) console.log(`빈자리는 ${OPEN_AFTER_MS / 1000}초 뒤에 열립니다.`);
});
