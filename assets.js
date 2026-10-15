'use strict';
/* 표·그림 도구: 표(격자·붙여넣기), 그림(업로드), 도식/서식/수식(직접 입력)을 버전과 함께 보관한다. */
const $ = id => document.getElementById(id);
const kinds = { table: '표', image: '그림', figure: '그림·도식', form: '서식', formula: '수식' };
let current = null;
const say = (t, bad) => { $('msg').textContent = t; $('msg').className = bad ? 'error' : 'notice'; $('msg').hidden = !t; };
async function session() { const s = await Store.api('session'); $('who').textContent = s.authenticated ? '편집 가능' : '읽기 전용'; $('login').textContent = s.authenticated ? '로그아웃' : '편집 로그인'; return s; }
$('login').addEventListener('click', async () => {
  const s = await Store.api('session');
  if (s.authenticated) { await Store.api('logout', { method: 'POST', body: '{}' }); } else {
    const p = prompt(s.configured ? '편집 비밀번호' : '처음 사용합니다. 새 편집 비밀번호를 정하세요.'); if (!p) return;
    try { await Store.api('login', { method: 'POST', body: JSON.stringify({ password: p }) }); } catch (e) { say(e.message, true); }
  }
  session();
});
const toolsFor = k => { $('table-tools').hidden = k !== 'table'; $('image-tools').hidden = k !== 'image'; };
$('kind').addEventListener('change', () => toolsFor($('kind').value));
function newAsset() { current = null; $('etitle').textContent = '새 자료'; $('kind').value = 'table'; $('title').value = ''; $('number').value = ''; $('edition').value = '6'; $('content').innerHTML = ''; $('delete').hidden = true; $('versions').replaceChildren(); $('vtitle').hidden = true; toolsFor('table'); }
$('new').addEventListener('click', newAsset);
$('build').addEventListener('click', () => {
  const text = $('paste').value.trim(); let rows;
  if (text) rows = text.split(/\r?\n/).map(l => l.split(l.includes('\t') ? '\t' : ',').map(c => c.trim()));
  else rows = Array.from({ length: +$('rows').value + 1 }, (_, i) => Array.from({ length: +$('cols').value }, (_, j) => i === 0 ? '제목' + (j + 1) : ''));
  const w = Math.max(...rows.map(r => r.length)), cell = (t, tag) => `<${tag}>${Store.esc(t || '')}</${tag}>`;
  const body = rows.slice(1).map(r => '<tr>' + Array.from({ length: w }, (_, i) => cell(r[i], 'td')).join('') + '</tr>').join('');
  $('content').innerHTML = `<table><thead><tr>${Array.from({ length: w }, (_, i) => cell(rows[0][i], 'th')).join('')}</tr></thead><tbody>${body}</tbody></table>`;
});
$('imgfile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return; const fr = new FileReader();
  fr.onload = () => { const im = new Image(); im.onload = () => {
    const k = Math.min(1, 1400 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const src = f.type === 'image/png' && f.size < 300000 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', .85);
    $('content').innerHTML = `<figure><img alt="${Store.esc($('title').value || f.name)}" src="${src}"><figcaption>${Store.esc($('title').value || '')}</figcaption></figure>`;
  }; im.src = fr.result; };
  fr.readAsDataURL(f);
});
async function list() {
  const q = $('aq').value.toLowerCase(), k = $('ak').value, all = await Store.assets.list(); $('count').textContent = all.length + '개';
  const items = all.filter(a => (!k || a.kind === k) && [a.title, a.meta?.number].join(' ').toLowerCase().includes(q));
  $('alist').replaceChildren(...items.map(a => { const b = document.createElement('button'), s = document.createElement('strong'), m = document.createElement('small'); b.type = 'button'; s.textContent = a.title; m.textContent = `${kinds[a.kind]} · ${a.meta?.edition || '6'}판 · v${a.version}`; b.append(s, m); b.onclick = () => open(a.id); b.setAttribute('aria-current', String(current === a.id)); return b; }));
  if (!items.length) $('alist').textContent = '보관한 자료가 없습니다.';
}
async function open(id, version) {
  const all = await Store.assets.list(), a = all.find(x => x.id === id); if (!a) return; current = id; const v = version || a.version;
  $('etitle').textContent = a.title; $('kind').value = a.kind; $('title').value = a.title; $('number').value = a.meta?.number || ''; $('edition').value = a.meta?.edition || '6'; toolsFor(a.kind);
  $('content').innerHTML = Store.sanitize(await Store.assets.rawHtml(id, v)); $('delete').hidden = false; $('vtitle').hidden = false;
  $('versions').replaceChildren(...[...a.versions].reverse().map(x => { const b = document.createElement('button'); b.type = 'button'; b.textContent = `v${x.version} · ${new Date(x.saved_at).toLocaleString('ko-KR')}`; b.style.margin = '0 6px 6px 0'; b.onclick = () => open(id, x.version); if (x.version === v) b.className = 'primary'; return b; }));
  list();
}
$('save').addEventListener('click', async () => {
  say('');
  try {
    const a = await Store.assets.save({ id: current, kind: $('kind').value, title: $('title').value, edition: $('edition').value, number: $('number').value, html: $('content').innerHTML });
    say(`저장했습니다. (v${a.version})`); await open(a.id);
  } catch (e) { say(e.status === 401 ? '저장하려면 [편집 로그인]이 필요합니다.' : e.message, true); }
});
$('delete').addEventListener('click', async () => {
  if (!current || !confirm('이 자료를 보관함에서 삭제할까요? 이미 본문에 넣은 내용은 그대로 남습니다.')) return;
  try { await Store.assets.remove(current); newAsset(); say('삭제했습니다.'); list(); } catch (e) { say(e.status === 401 ? '삭제하려면 [편집 로그인]이 필요합니다.' : e.message, true); }
});
$('aq').addEventListener('input', list); $('ak').addEventListener('change', list);
(async () => { await Store.ready; await session(); toolsFor('table'); await list(); const id = new URL(location.href).searchParams.get('id'); if (id) open(id); })();
