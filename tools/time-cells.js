/*
 * 시간 칸 상태 확인
 *
 * 등록 페이지에서 실행하세요. 이미 예약이 찬 날짜로 보면 더 정확합니다.
 * 각 시간 체크박스가 disabled 인지, 어떤 class 가 붙는지 알려줍니다.
 *
 * Chrome 개발자도구 콘솔(F12 → Console)에 붙여넣고 Enter.
 * 결과가 콘솔에 찍히고 클립보드에도 복사됩니다.
 * 마지막 줄의 "── N개 ──" 는 몇 개를 찾았는지 알려주는 반환값입니다.
 */
(()=>{const rows=[];document.querySelectorAll('input[name="reservation[time]"]').forEach(e=>{try{
const b=e.closest('label')||e.parentElement;
rows.push(((b.innerText||b.textContent||'').replace(/\s+/g,' ').trim().slice(0,24)).padEnd(26)
+'disabled='+e.disabled+'  class='+(b.className||'(없음)'));}catch(x){}});
const out=rows.join('\n')||'(시간 체크박스를 못 찾았습니다 — 등록 페이지인지 확인하세요)';
console.log(out);try{copy(out)}catch(e){}
return '── '+rows.length+'칸 (위 내용이 클립보드에 복사됨) ──'})()
