/*
 * 호실 코드 뽑기
 *
 * 장소예약 목록에서 본관 → 3층을 고른 뒤 실행하세요.
 * 링크의 ?location= 코드와 그 카드의 호실명을 짝지어 줍니다.
 *
 * Chrome 개발자도구 콘솔(F12 → Console)에 붙여넣고 Enter.
 * 결과가 콘솔에 찍히고 클립보드에도 복사됩니다.
 * 마지막 줄의 "── N개 ──" 는 몇 개를 찾았는지 알려주는 반환값입니다.
 */
(()=>{const rows=[];document.querySelectorAll('a[href*="location="]').forEach(a=>{try{
const c=new URL(a.href,location.href).searchParams.get('location');if(!c||c==='0')return;
let n=a,t='';for(let i=0;i<8&&n.parentElement;i++){n=n.parentElement;
const x=(n.innerText||n.textContent||'').replace(/\s+/g,' ').trim();if(x.length>15){t=x.slice(0,70);break}}
rows.push(c+'  '+t);}catch(e){}});
const out=rows.join('\n')||'(location 링크를 못 찾았습니다)';console.log(out);
try{copy(out)}catch(e){}
return '── '+rows.length+'개 (위 내용이 클립보드에 복사됨) ──'})()
