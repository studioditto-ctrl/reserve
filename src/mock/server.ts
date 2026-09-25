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
/** 자동 로그인 체크 여부. beforeSubmit 단계가 실제로 눌렸는지 확인하는 용도입니다. */
const REMEMBERED = new Set<string>();
const TIMES = ['17:30', '18:00', '19:00', '19:30', '20:30'];
/** 열려 있는 시간대. 나머지는 매진으로 표시됩니다. */
const OPEN_TIMES = new Set(['19:00', '20:30']);
/** 장소예약 모드: 이 호실만 비어 있습니다 (나머지 호실 순회를 시험하기 위함). */
const ROOM_TIMES = ['09:00', '10:00', '11:00', '13:00', '14:00'];
const FREE_ROOM = process.env.MOCK_FREE_ROOM ?? '315';
const ROOMS = ['311', '312', '313', '314', '315', '316', '317', '318'];
/** 만나교회처럼 30분 단위 체크박스로 된 시간표. 오전/오후 표시가 없습니다. */
const CB_LABELS = ['9시', '9시30분', '10시', '10시30분', '11시', '11시30분',
                   '12시', '12시30분', '1시', '1시30분', '2시', '2시30분'];
const booked = new Map<string, string>();

const page = (title: string, body: string) => `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:640px}
.slot{display:block;padding:10px 14px;margin:6px 0;border:1px solid #ccc;border-radius:8px;text-decoration:none;color:#111}
.sold-out{color:#c00;font-size:13px}.done{color:#0a0;font-weight:700}
.cb{display:inline-block;padding:6px 10px;margin:4px;border:1px solid #ccc;border-radius:6px}
.cb.taken{color:#999;background:#f4f4f4}
#notice-popup{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
#notice-popup>div{background:#fff;padding:24px 32px;border-radius:10px}</style>
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
    // 만나교회와 같은 구조를 흉내 냅니다.
    // 폼 밖에도 제출 버튼이 있어서(검색), 로그인 버튼만 정확히 집어야 합니다.
    return send(res, 200, page('로그인', `
      <form method="get" action="/search"><input name="s" placeholder="검색">
        <input type="submit" value="검색하기"></form>
      <form method="post" action="/login">
        <p><input id="userid" name="userid" placeholder="아이디"></p>
        <p><input id="userpw" name="userpw" type="password" placeholder="비밀번호"></p>
        <p><label><input type="checkbox" name="rememberme"> 자동 로그인</label></p>
        <p><input type="submit" value="로그인"></p>
        <p style="color:#888;font-size:13px">데모 계정: ${USER} / ${PASS}</p></form>`));
  }

  if (path === '/login' && req.method === 'POST') {
    const form = await readBody(req);
    if (form.get('userid') === USER && form.get('userpw') === PASS) {
      const sid = Math.random().toString(36).slice(2);
      SESSIONS.add(sid);
      if (form.get('rememberme')) REMEMBERED.add(sid);
      return redirect(res, '/my', { 'set-cookie': `sid=${sid}; Path=/; HttpOnly` });
    }
    return send(res, 401, page('로그인 실패', '<p id="login-error">아이디 또는 비밀번호가 틀렸습니다.</p><a href="/login">다시 시도</a>'));
  }

  if (!loggedIn(req)) return redirect(res, '/login');

  if (path === '/my') {
    const remembered = REMEMBERED.has(cookies(req).sid ?? '');
    return send(res, 200, page('내 정보',
      `<div id="account">demo 님</div>
       <div id="remember-state">자동 로그인: ${remembered ? '켜짐' : '꺼짐'}</div>
       <a href="/booking?date=2026-09-05&party=2">예약하기</a>`));
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
      // 실제 사이트에서 흔한 공지 팝업. 닫지 않으면 화면 전체를 덮어 클릭이 막힙니다.
      const popup = `<div id="notice-popup"><div><p>[공지] 예약 규정이 변경되었습니다.</p>
        <button id="notice-close">닫기</button></div></div>
        <script>document.getElementById('notice-close').onclick=function(){
          document.getElementById('notice-popup').remove();};</script>`;
      // 호실 드롭다운. inspect 가 여기서 호실 코드를 뽑아냅니다.
      const options = ROOMS.map((r, i) => `<option value="${20 + i}">${r}호</option>`).join('');
      return send(res, 200, page(`${room}호 예약`,
        `${popup}<select id="location" name="location">${options}</select>
         <div id="slot-list"><h2>${date} · ${room}호</h2>${rows}</div>`));
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

  // 체크박스형 시간표 (만나교회 구조). 빈 호실만 11시·11시30분이 열려 있습니다.
  // MOCK_REDIRECT_HOME=1 이면 예약 페이지를 홈으로 돌려보냅니다 (서버 리다이렉트).
  if (path === '/cbooking' && process.env.MOCK_REDIRECT_HOME === '1') {
    return redirect(res, '/my');
  }

  // MOCK_JS_REDIRECT=1 이면 200 으로 폼을 주되 자바스크립트가 홈으로 옮깁니다.
  // 만나교회에서 관측된 증상(HTTP 200, 서버 리다이렉트 없음, 최종 주소는 홈)과 같습니다.
  if (path === '/cbooking' && process.env.MOCK_JS_REDIRECT === '1') {
    return send(res, 200, page('311호 예약', `<div id="slot-list">
      <input id="res-name" name="reservation[name]">
      <input type="checkbox" name="reservation[time]" value="11시"> 11시
      </div><script>location.replace('/my');</script>`));
  }

  if (path === '/cbooking') {
    const date = url.searchParams.get('date') ?? '';
    const room = url.searchParams.get('room') ?? '';
    const open = Date.now() - START >= OPEN_AFTER_MS;
    const rows = CB_LABELS.map((label) => {
      const key = `${date} ${room} ${label}`;
      const free = open && room === FREE_ROOM && !booked.has(key);
      // MOCK_CLASS_ONLY=1 이면 만나교회처럼 disabled 없이 class 로만 막습니다.
      const classOnly = process.env.MOCK_CLASS_ONLY === '1';
      return `<label class="cb${free ? '' : ' taken'}">
        <input type="checkbox" name="reservation[time]" value="${label}"${free || classOnly ? '' : ' disabled'}>
        ${label}${free || classOnly ? '' : ' <span class="sold-out">예약불가</span>'}</label>`;
    }).join('');
    // MOCK_HIDDEN_CHECKBOX=1 이면 만나교회처럼 진짜 체크박스를 숨기고
    // 라벨만 보여줍니다. 이러면 Playwright 의 check() 가 "not visible" 로 막힙니다.
    const hiddenBoxCss = process.env.MOCK_HIDDEN_CHECKBOX === '1'
      ? `<style>.cb input[type=checkbox]{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
         .cb{display:inline-block;border:1px solid #ccc;padding:6px 10px;margin:2px;cursor:pointer}
         .cb:has(input:checked){background:#cfe9dd;border-color:#1f6f5c}</style>`
      : '';
    return send(res, 200, page(`${room}호 예약`, `${hiddenBoxCss}<div id="slot-list"><h2>${date} · ${room}호</h2>
      <form method="post" action="/cconfirm">
        <input type="hidden" name="date" value="${date}"><input type="hidden" name="room" value="${room}">
        ${rows}
        <p><input id="res-name" name="reservation[name]" placeholder="김만나 성도,집사,권사,장로"></p>
        <p><input id="res-reason" name="reservation[reason]" placeholder="사용 목적을 입력하세요."></p>
        <p><input id="res-count" name="reservation[max_count]" placeholder="인원을 입력하세요."></p>
        <p><input id="res-phone" name="reservation[phone]" placeholder="010-0000-0000"></p>
        <p><input type="submit" value="신청하기"></p>
      </form></div>`));
  }

  if (path === '/cconfirm' && req.method === 'POST') {
    const form = await readBody(req);
    const times = form.getAll('reservation[time]');
    if (times.length === 0) return send(res, 400, page('오류', '<p id="form-error">시간을 선택하세요.</p>'));
    if (!form.get('reservation[name]')) return send(res, 400, page('오류', '<p id="form-error">예약자명이 필요합니다.</p>'));
    for (const t of times) booked.set(`${form.get('date')} ${form.get('room')} ${t}`, 'x');
    const code = `R${Math.floor(Math.random() * 900000 + 100000)}`;
    return send(res, 200, page('신청 완료', `<div class="done">예약이 완료되었습니다</div>
      <div>${form.get('date')} ${form.get('room')}호 ${times.join(', ')}</div><div class="code">${code}</div>`));
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
