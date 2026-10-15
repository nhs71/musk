'use strict';
/* 전체 변경대비표: 모든 항목의 원문 | 수정본 | 변경추적을 한 페이지에 보여준다. ?id=항목ID 로 하나만 열 수 있다. */
const $ = id => document.getElementById(id);
const names = { changed: '내용 변경', unchanged: '변경 없음', wording_only: '문구 정비만', missing: '비교 자료 없음', draft: '확인 필요' };
let rows = [], labels = { original: '원문', revised: '수정 초안' };
const one = new URL(location.href).searchParams.get('id');
const card = ({ r, track }, open) => {
  const c = track.counts, d = document.createElement('details'); d.id = r.id; d.open = open; d.style.cssText = 'border:1px solid var(--line);border-radius:8px;margin:10px 0;padding:0 14px';
  d.innerHTML = `<summary style="padding:12px 0;cursor:pointer"><strong>${Store.esc(r.title)}</strong> <span class="badge ${r.status}">${names[r.status]}</span>
    <small class="muted"> ${Store.esc([r.part, r.chapter].filter(Boolean).join(' / '))} · ${track.available ? (track.changed ? `추가 ${c.added} · 삭제 ${c.removed} · 수정 ${c.modified}` : '변경 없음') : '비교 자료 없음'} · v${r.version}</small></summary>
    <div class="panes" style="margin-bottom:14px">
      <section class="pane"><header><h3>${Store.esc(labels.original)}</h3></header><div class="rich">${Store.sanitize(r.original)}</div></section>
      <section class="pane"><header><h3>${Store.esc(labels.revised)}</h3></header><div class="rich">${Store.sanitize(r.revised)}</div></section>
      <section class="pane"><header><h3>변경추적</h3></header><div class="rich tracking">${track.html}</div></section></div>
    ${Store.textOf(r.reason) ? `<div class="notes"><h3>검토 메모</h3><div class="rich note">${Store.sanitize(r.reason)}</div></div>` : ''}`;
  return d;
};
function draw() {
  const q = $('q').value.trim().toLowerCase(), f = $('f').value;
  const list = rows.filter(x => (!one || x.r.id === one) && (!f || (f === 'changed') === x.track.changed) && (!q || (x.r.title + Store.textOf(x.r.original + x.r.revised)).toLowerCase().includes(q)));
  $('list').replaceChildren(...list.map(x => card(x, !!one || list.length <= 3)));
  const ch = rows.filter(x => x.track.changed).length;
  $('summary').textContent = `전체 ${rows.length}개 항목 · 변경 ${ch} · 변경 없음 ${rows.length - ch} · 표시 ${list.length}개`;
  if (one) document.getElementById(one)?.scrollIntoView();
}
$('q').addEventListener('input', draw); $('f').addEventListener('change', draw); $('print').addEventListener('click', () => { document.querySelectorAll('details').forEach(d => d.open = true); print(); });
$('export-html').addEventListener('click', () => {
  document.querySelectorAll('details').forEach(d => d.open = true);
  const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${Store.esc($('page-title').textContent)}</title><style>${css}</style></head><body><main class="page"><h1>${Store.esc($('page-title').textContent)}</h1><p>${Store.esc($('summary').textContent)}</p>${$('list').innerHTML}</main></body></html>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); a.download = '전체_변경대비표.html'; a.click();
});
(async () => {
  await Store.ready; labels = await Store.data.labels(); const t = await Store.data.title(); $('page-title').textContent = t + ' · 전체 변경대비표'; document.title = $('page-title').textContent;
  rows = await Store.data.rows(); if (!rows.length) $('summary').textContent = '문서가 없습니다. 편집기에서 먼저 가져와 주세요.'; else draw();
})();
