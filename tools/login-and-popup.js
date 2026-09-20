/*
 * 로그인 입력칸 + 화면에 떠 있는 팝업의 닫기 버튼을 한 번에 찾습니다.
 *
 * 쓰는 법 — Chrome 개발자도구 콘솔(F12 → Console)에 아래 코드를 붙여넣고 Enter.
 *   (이 파일 이름을 붙여넣으면 "tools is not defined" 오류가 납니다. 내용을 붙여넣으세요.)
 *   Chrome 이 붙여넣기를 막으면 콘솔에 allow pasting 을 타이핑한 뒤 다시 붙여넣으세요.
 *
 * 두 번 실행하면 됩니다.
 *   1. 로그인 페이지에서 → 아이디·비밀번호 입력칸과 로그인 버튼
 *   2. 로그인 직후 팝업이 떠 있을 때 → 팝업의 닫기 버튼
 *
 * 결과는 콘솔에 찍히고 클립보드에도 복사됩니다.
 */
(()=>{const o=[],t=e=>(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
const CLOSE=/(닫기|확인|close|dismiss|오늘|하루|×|✕|x)/i;
o.push('URL: '+location.href);
o.push('\n[입력칸]');
document.querySelectorAll('input,textarea').forEach(e=>{if(e.type==='hidden')return;
const l=(e.closest('label')?t(e.closest('label')):'')||e.placeholder||e.getAttribute('aria-label')||'';
o.push('  type='+(e.type||'text')+'  id='+(e.id||'-')+'  name='+(e.name||'-')+'  ← '+l.slice(0,30))});
o.push('\n[버튼]');
document.querySelectorAll('button,input[type=submit],input[type=button]').forEach(e=>{
o.push('  <'+e.tagName.toLowerCase()+'>  id='+(e.id||'-')+'  class='+String(e.className||'-').slice(0,45)+'  ← '+(t(e)||e.value||'').slice(0,22))});
o.push('\n[지금 화면에 떠 있는 팝업]');
let n=0;
document.querySelectorAll('div,section,aside,dialog').forEach(e=>{try{
if(n>=6)return;
const s=getComputedStyle(e);
const floating=s.position==='fixed'||s.position==='absolute';
if(!floating||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return;
if(e.offsetWidth<150||e.offsetHeight<80)return;
const btns=[...e.querySelectorAll('button,a,input[type=button],span[class*=close],i[class*=close]')];
const closers=btns.filter(b=>CLOSE.test(t(b)||b.value||'')||/close|pop|layer|modal|dim/i.test(String(b.className)));
if(!closers.length&&!/pop|layer|modal|dim|overlay/i.test(String(e.className||e.id||'')))return;
n++;o.push('  팝업'+n+'  id='+(e.id||'-')+'  class='+String(e.className||'-').slice(0,60));
(closers.length?closers:btns).slice(0,5).forEach(b=>
o.push('     닫기후보  <'+b.tagName.toLowerCase()+'>  id='+(b.id||'-')+'  class='+String(b.className||'-').slice(0,40)+'  ← '+(t(b)||b.value||'').slice(0,20)));
}catch(x){}});
if(!n)o.push('  (없음 — 팝업이 떠 있는 상태에서 다시 실행하세요)');
const r=o.join('\n');console.log(r);try{copy(r)}catch(e){}
return '── 복사 완료 ──'})()
