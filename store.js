/* 데이터 계층: 원본 사이트의 서버 API(/api/...)를 브라우저 IndexedDB + GitHub 동기화로 대체한다. */
(() => {
'use strict';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), n => n.toString(16).padStart(2, '0')).join('');
const parse = html => new DOMParser().parseFromString(html || '', 'text/html').body;
const textOf = html => parse(html).textContent.replace(/\s+/g, ' ').trim();
const fail = (status, message) => Object.assign(new Error(message), { status });
const emptyDoc = () => ({ v: 2, title: '마크다운 비교 편집기', basis: '', labels: { original: '원문', revised: '수정 초안' }, seq: 0,
  outline: [], records: {}, history: {}, comments: {}, refs: { original: [], revised: [] }, assets: {}, files: [], pw: null, gh: {} });
let D = emptyDoc(), db = null;

/* ---------- IndexedDB ---------- */
const open = () => new Promise((res, rej) => { const r = indexedDB.open('mdce2', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = (mode, fn) => new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
const save = () => db ? kv('readwrite', s => s.put(D, 'doc')) : Promise.resolve();
let seeded = false;
const ready = (async () => {
  try { db = await open(); const d = await kv('readonly', s => s.get('doc')); if (d && d.v === 2) D = d; } catch (e) { console.warn('IndexedDB 사용 불가', e); }
  if (!D.outline.length) {
    try { const r = await fetch('data/document.json', { cache: 'no-store' }); if (r.ok) { const d = await r.json(); if (d && d.v === 2) { D = d; D.pw = d.pw || null; seeded = true; await save(); } } } catch (e) { /* 저장소에 데이터 파일이 없으면 빈 문서로 시작 */ }
  }
})();

/* ---------- 인증 (정적 사이트용 잠금: 서버 로그인이 아니라 브라우저 안의 편집 잠금) ---------- */
const sha = async t => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mdce:' + t))), b => b.toString(16).padStart(2, '0')).join('');
const authed = () => !!D.pw && sessionStorage.getItem('mdce.auth') === D.pw;
const needAuth = () => { if (!authed()) throw fail(401, '편집하려면 로그인해 주세요.'); };

/* ---------- HTML 정리 ---------- */
const TAGS = new Set('P BR B STRONG I EM U SUP SUB UL OL LI TABLE THEAD TBODY TFOOT TR TH TD CAPTION H2 H3 H4 H5 H6 BLOCKQUOTE DIV SPAN IMG A S DEL INS PRE CODE HR FIGURE FIGCAPTION SMALL COLGROUP COL'.split(' '));
const DROP = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|FORM|INPUT|BUTTON|TEXTAREA|SELECT|SVG|MATH|NOSCRIPT|TEMPLATE)$/;
function clean(node) {
  for (const c of [...node.childNodes]) {
    if (c.nodeType === 3) continue;
    if (c.nodeType !== 1) { c.remove(); continue; }
    if (DROP.test(c.tagName)) { c.remove(); continue; }
    if (!TAGS.has(c.tagName)) { clean(c); c.replaceWith(...c.childNodes); continue; }
    for (const a of [...c.attributes]) {
      const n = a.name, v = a.value;
      const ok = (n === 'class' && (c.setAttribute('class', v.split(/\s+/).filter(x => /^(managed-asset|text-weight-(bold|normal)|asset-[\w-]+)$/.test(x) && x !== 'asset-selected').join(' ')), true))
        || ['colspan', 'rowspan', 'alt', 'title', 'start', 'value', 'data-asset-id', 'data-asset-version', 'data-kind'].includes(n)
        || (n === 'contenteditable' && c.classList.contains('managed-asset') && v === 'false')
        || (n === 'href' && c.tagName === 'A' && /^(https?:|mailto:|#)/i.test(v))
        || (n === 'src' && c.tagName === 'IMG' && /^(data:image\/(png|jpe?g|gif|webp);base64,|https:)/i.test(v));
      if (!ok) c.removeAttribute(n);
    }
    if (c.tagName === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
    if (c.getAttribute('class') === '') c.removeAttribute('class');
    clean(c);
  }
}
const sanitize = html => { const b = parse(html); clean(b); return b.innerHTML; };

/* ---------- 마크다운 <-> HTML ---------- */
function mdInline(t) {
  t = esc(t);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/&lt;(\/?)(sup|sub)&gt;/g, '<$1$2>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
}
function mdToHtml(md) {
  const L = (md || '').replace(/\r/g, '').split('\n'); let h = '', i = 0;
  const li = /^\s*([-*+]|\d+[.)])\s+/;
  while (i < L.length) {
    const l = L[i]; let m;
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; h += `<pre><code>${esc(b.join('\n'))}</code></pre>`; continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) { const n = Math.max(2, m[1].length); h += `<h${n}>${mdInline(m[2])}</h${n}>`; i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { h += '<hr>'; i++; continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|?[\s:\-|]+\|?\s*$/.test(L[i + 1] || '') && (L[i + 1] || '').includes('-')) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const hd = row(l); i += 2; let body = '';
      while (i < L.length && /^\|.*\|\s*$/.test(L[i])) { body += '<tr>' + row(L[i]).map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>'; i++; }
      h += '<table><thead><tr>' + hd.map(c => `<th>${mdInline(c)}</th>`).join('') + `</tr></thead><tbody>${body}</tbody></table>`; continue;
    }
    if (/^>\s?/.test(l)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) b.push(L[i++].replace(/^>\s?/, '')); h += `<blockquote>${mdInline(b.join('<br>'))}</blockquote>`; continue; }
    if (li.test(l)) {
      const ord = /^\s*\d/.test(l), start = ord ? parseInt(l.trim(), 10) : 1, it = [];
      while (i < L.length && li.test(L[i])) { it.push(`<li>${mdInline(L[i].replace(li, ''))}</li>`); i++; }
      const t = ord ? 'ol' : 'ul'; h += `<${t}${ord && start !== 1 ? ` start="${start}"` : ''}>${it.join('')}</${t}>`; continue;
    }
    const p = []; while (i < L.length && L[i].trim() && !/^(#{1,6}\s|```|>|\|)/.test(L[i]) && !(p.length && li.test(L[i]))) p.push(L[i++]);
    if (!p.length) p.push(L[i++]);
    h += `<p>${mdInline(p.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  return h;
}
function htmlToMd(html) {
  const inl = n => { let s = ''; for (const c of n.childNodes) {
    if (c.nodeType === 3) { s += c.textContent.replace(/\s+/g, ' '); continue; } if (c.nodeType !== 1) continue;
    const t = c.tagName, i = inl(c);
    s += t === 'B' || t === 'STRONG' ? (i.trim() ? `**${i.trim()}**` : '') : t === 'I' || t === 'EM' ? (i.trim() ? `*${i.trim()}*` : '')
      : t === 'SUP' ? `<sup>${i}</sup>` : t === 'SUB' ? `<sub>${i}</sub>` : t === 'BR' ? '  \n' : t === 'A' ? `[${i}](${c.getAttribute('href') || ''})`
      : t === 'IMG' ? `![${c.getAttribute('alt') || ''}](${c.getAttribute('src') || ''})` : t === 'CODE' ? '`' + i + '`' : i; } return s; };
  const blk = (n, out, ind) => { for (const c of n.childNodes) {
    if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) out.push(t); continue; } if (c.nodeType !== 1) continue;
    const t = c.tagName;
    if (/^H[1-6]$/.test(t)) out.push('#'.repeat(+t[1]) + ' ' + inl(c).trim());
    else if (t === 'UL' || t === 'OL') {
      let k = +c.getAttribute('start') || 1; const lines = [];
      for (const li of c.children) { if (li.tagName !== 'LI') continue;
        const nested = [...li.children].filter(x => /^(UL|OL)$/.test(x.tagName)), cl = li.cloneNode(true); cl.querySelectorAll('ul,ol').forEach(x => x.remove());
        lines.push(ind + (t === 'OL' ? (li.getAttribute('value') ? +li.getAttribute('value') : k) + '. ' : '- ') + inl(cl).trim()); k++;
        nested.forEach(x => { const o = []; blk({ childNodes: [x] }, o, ind + '  '); lines.push(o.join('\n')); }); }
      out.push(lines.join('\n'));
    } else if (t === 'TABLE') {
      const rows = [...c.querySelectorAll('tr')].map(tr => [...tr.children].map(td => inl(td).trim().replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')));
      if (rows.length) { const w = Math.max(...rows.map(r => r.length)), f = r => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
        out.push([f(rows[0]), f(Array(w).fill('---')), ...rows.slice(1).map(f)].join('\n')); }
    } else if (t === 'BLOCKQUOTE') out.push(inl(c).trim().split('\n').map(l => '> ' + l).join('\n'));
    else if (t === 'PRE') out.push('```\n' + c.textContent + '\n```');
    else if (t === 'HR') out.push('---');
    else if (t === 'P' || (t === 'DIV' && !c.querySelector('p,ul,ol,table,h2,h3,h4,h5,h6,div'))) { const x = inl(c).trim(); if (x) out.push(x); }
    else blk(c, out, ind);
  } };
  const out = []; blk(parse(html), out, ''); return out.join('\n\n');
}
function splitMd(text) {
  const out = []; let cur = null, fence = false;
  text.replace(/\r/g, '').split('\n').forEach(l => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) { cur = { level: m[1].length, title: m[2], body: [] }; out.push(cur); }
    else { if (!cur) { cur = { level: 1, title: '머리말', body: [] }; out.push(cur); } cur.body.push(l); }
  });
  out.forEach(s => { s.body = s.body.join('\n').trim(); });
  return out.filter(s => s.title || s.body);
}

/* ---------- 변경추적 (블록 단위 LCS + 단어 단위 diff) ---------- */
const norm = t => t.toLowerCase().replace(/^\s*(?:[\[(]?\d+[\])\.]|[\u2460-\u2473\u2474-\u2487]|[가-하][\.\)])\s*/, '').replace(/[\s\u00a0·ㆍ,.;:()\[\]{}'"“”‘’\-–—]/g, '');
function lcs(a, b) {
  const n = a.length, m = b.length, w = m + 1, T = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * w + j] = a[i] === b[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push(['=', i++, j++]); } else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) out.push(['-', i++, -1]); else out.push(['+', -1, j++]); }
  while (i < n) out.push(['-', i++, -1]); while (j < m) out.push(['+', -1, j++]);
  return out;
}
function blocksOf(html) {
  const out = [];
  const add = (text, h) => { text = text.replace(/\s+/g, ' ').trim(); if (text || /<img/.test(h)) out.push({ text, html: h, key: norm(text) || h }); };
  const walk = (n, ctx) => { for (const c of n.childNodes) {
    if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) add(t, `<p>${esc(t)}</p>`); continue; } if (c.nodeType !== 1) continue;
    const t = c.tagName;
    if (t === 'UL' || t === 'OL') { let k = +c.getAttribute('start') || 1;
      for (const li of c.children) { if (li.tagName !== 'LI') continue; const cl = li.cloneNode(true); cl.querySelectorAll('ul,ol').forEach(x => x.remove());
        const v = +li.getAttribute('value') || k; add(cl.textContent, t === 'OL' ? `<ol start="${v}"><li>${cl.innerHTML}</li></ol>` : `<ul><li>${cl.innerHTML}</li></ul>`); k = v + 1;
        li.querySelectorAll(':scope > ul, :scope > ol').forEach(x => walk({ childNodes: [x] })); } }
    else if (t === 'TABLE') c.querySelectorAll('tr').forEach(tr => add(tr.textContent, `<table><tbody>${tr.outerHTML}</tbody></table>`));
    else if (t === 'DIV' && !c.classList.contains('managed-asset') && c.querySelector('p,ul,ol,table,h2,h3,h4,h5,h6,div')) walk(c);
    else add(c.textContent, c.outerHTML);
  } };
  walk(parse(html)); return out;
}
const words = (a, b) => {
  const tk = s => s.split(/(\s+)/).filter(Boolean), A = tk(a), B = tk(b); let o = '';
  for (const [t, i, j] of lcs(A, B)) o += t === '=' ? esc(A[i]) : t === '-' ? `<del>${esc(A[i])}</del>` : `<ins>${esc(B[j])}</ins>`;
  return o;
};
const sim = (a, b) => { const x = new Set(a.split(/\s+/)), y = new Set(b.split(/\s+/)); let c = 0; x.forEach(w => y.has(w) && c++); return c / Math.max(1, Math.min(x.size, y.size)); };
function track(original, revised, available = true) {
  original = sanitize(original); revised = sanitize(revised);
  if (!available) return { html: '<p class="track-message">비교할 원문 자료가 없습니다.</p>', counts: { added: 0, removed: 0, modified: 0 }, available: false, changed: false };
  const A = blocksOf(original), B = blocksOf(revised), counts = { added: 0, removed: 0, modified: 0 }; let fmt = 0, html = '';
  const same = b => `<div class="track-block track-same">${b.html}</div>`;
  const lab = (cls, name, h) => `<div class="track-block ${cls}"><span class="track-label">${name}</span>${h}</div>`;
  const ops = lcs(A.map(x => x.key), B.map(x => x.key)); let k = 0;
  while (k < ops.length) {
    if (ops[k][0] === '=') { const a = A[ops[k][1]], b = B[ops[k][2]]; if (a.text !== b.text) fmt++; html += same(b); k++; continue; }
    const dels = [], adds = [];
    while (k < ops.length && ops[k][0] === '-') dels.push(A[ops[k++][1]]);
    while (k < ops.length && ops[k][0] === '+') adds.push(B[ops[k++][2]]);
    let ai = 0;
    for (const d of dels) {
      let hit = -1; for (let q = ai; q < adds.length; q++) if (sim(d.text, adds[q].text) >= 0.35) { hit = q; break; }
      if (hit < 0) { counts.removed++; html += lab('track-removed', '삭제', d.html); continue; }
      for (; ai < hit; ai++) { counts.added++; html += lab('track-added', '추가', adds[ai].html); }
      counts.modified++; html += lab('track-modified', '수정', `<p>${words(d.text, adds[hit].text)}</p>`); ai = hit + 1;
    }
    for (; ai < adds.length; ai++) { counts.added++; html += lab('track-added', '추가', adds[ai].html); }
  }
  const changed = counts.added + counts.removed + counts.modified > 0;
  const note = fmt ? `<p class="track-message">목록 번호·띄어쓰기·서식 등 형식 차이 ${fmt}곳은 내용 변경에서 제외했습니다.</p>` : '';
  return { html: note + (html || '<p class="track-message">본문이 비어 있습니다.</p>'), counts, available: true, changed, format_only: fmt };
}

/* ---------- 문서 모델 ---------- */
const rec = id => { const r = D.records[id]; if (!r) throw fail(404, '항목을 찾을 수 없습니다.'); return r; };
const now = () => new Date().toISOString();
const view = r => ({ ...r });
const hist = (r, note) => { (D.history[r.id] = D.history[r.id] || []).push({ version: r.version, note, saved_at: r.updated_at || now(), record: JSON.parse(JSON.stringify(r)) }); };
const live = () => Object.values(D.records).filter(r => !r.deleted);
const nodeOf = id => D.outline.find(n => n.body_section_id === id || n.id === id);
const hasKids = n => D.outline.some(x => x.parent_id === n.id && !x.deleted);
function subtreeEnd(n) { let i = D.outline.indexOf(n) + 1; const ids = new Set([n.id]); while (i < D.outline.length && ids.has(D.outline[i].parent_id)) { ids.add(D.outline[i].id); i++; } return i; }
function newRecord(node, over) {
  const r = { id: 's' + String(++D.seq).padStart(4, '0'), node_id: node.id, title: node.title, part: node.part, chapter: node.chapter, ordinal: D.seq,
    status: 'unchanged', version: 0, base_version: 0, user_created: false, deleted: false, original: '', revised: '', reason: '', original_available: true,
    is_new_in_sixth: false, availability_note: '', source_note: '', source_urls: [], updated_at: now(), ...over };
  D.records[r.id] = r; node.body_section_id = r.id; return r;
}
function build(parsedO, parsedR, mode) {
  D = { ...emptyDoc(), title: D.title, labels: D.labels, pw: D.pw, gh: D.gh, refs: D.refs, assets: D.assets, files: D.files };
  const stack = [], nodes = [];
  parsedO.forEach(h => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    const p = stack[stack.length - 1] || null, depth = stack.length;
    const n = { id: 'n' + String(nodes.length + 1).padStart(4, '0'), parent_id: p ? p.node.id : null, kind: depth === 0 ? 'part' : depth === 1 ? 'chapter' : 'section', title: h.title, ordinal: nodes.length + 1, body_section_id: null, _h: h, level: h.level };
    const chain = [...stack.map(s => s.node), n]; n.part = chain[0].title; n.chapter = chain[1] ? chain[1].title : '';
    nodes.push(n); stack.push({ level: h.level, node: n });
  });
  const key = n => { const c = []; let x = n; while (x) { c.unshift(norm(x.title)); x = nodes.find(y => y.id === x.parent_id); } return c.join('/'); };
  const rmap = new Map(), tmap = new Map();
  if (parsedR) { const rn = []; const st = [];
    parsedR.forEach((h, i) => { while (st.length && st[st.length - 1].level >= h.level) st.pop(); const path = [...st.map(s => norm(s.title)), norm(h.title)].join('/'); st.push({ level: h.level, title: h.title }); rmap.set(path, h); if (!tmap.has(norm(h.title))) tmap.set(norm(h.title), h); rn.push(h); }); }
  let matched = 0;
  nodes.forEach(n => {
    const { _h: h } = n; delete n._h; delete n.level; D.outline.push(n);
    const parent = nodes.some(x => x.parent_id === n.id);
    if (parent && !h.body) return;
    const o = mdToHtml(h.body); let r = o, st = 'unchanged', over = {};
    if (parsedR) { const m = rmap.get(key(n)) || tmap.get(norm(n.title)); if (m) { matched++; r = mdToHtml(m.body); st = norm(textOf(o)) === norm(textOf(r)) ? 'unchanged' : 'changed'; } else { r = ''; st = 'missing'; over.availability_note = '대응하는 수정 초안 자료가 없습니다.'; } }
    newRecord(n, { original: o, revised: r, status: st, ...over });
  });
  Object.values(D.records).forEach(r => { r.base_version = 0; });
  D.basis = new Date().toLocaleDateString('ko-KR') + ' 가져옴';
  return { sections: Object.keys(D.records).length, matched };
}

/* ---------- API 라우터 ---------- */
async function api(path, options = {}) {
  await ready;
  const method = (options.method || 'GET').toUpperCase(), body = options.body ? JSON.parse(options.body) : {};
  let m; const w = async fn => { const r = await fn(); await save(); return r; };

  if (path === 'session') return { authenticated: authed(), configured: !!D.pw };
  if (path === 'login') {
    if (!body.password) throw fail(400, '비밀번호를 입력해 주세요.');
    const h = await sha(body.password);
    if (!D.pw) { D.pw = h; await save(); } else if (D.pw !== h) throw fail(401, '비밀번호가 맞지 않습니다.');
    sessionStorage.setItem('mdce.auth', D.pw); return { ok: true };
  }
  if (path === 'logout') { sessionStorage.removeItem('mdce.auth'); return { ok: true }; }
  if (path === 'sections' && method === 'GET') {
    const sections = live().sort((a, b) => D.outline.indexOf(nodeOf(a.id)) - D.outline.indexOf(nodeOf(b.id))).map(r => ({ id: r.id, title: r.title, ordinal: r.ordinal, part: r.part, chapter: r.chapter, status: r.status, version: r.version, base_version: r.base_version, user_created: r.user_created, search: textOf(r.original + ' ' + r.revised + ' ' + r.reason) }));
    const outline = D.outline.filter(n => !n.deleted).map(n => ({ ...n, body_section_id: n.body_section_id && D.records[n.body_section_id] && !D.records[n.body_section_id].deleted ? n.body_section_id : null }));
    const catalog = []; outline.forEach(n => { if (!catalog.some(c => c.part === n.part && c.chapter === n.chapter)) catalog.push({ part: n.part, chapter: n.chapter }); });
    return { outline, sections, catalog, basis: D.basis ? D.basis : '', title: D.title, labels: D.labels };
  }
  if ((m = path.match(/^sections\/([\w-]+)$/)) && method === 'GET') return view(rec(m[1]));
  if ((m = path.match(/^sections\/([\w-]+)$/)) && method === 'PUT') return w(() => {
    needAuth(); const r = rec(m[1]);
    if (body.version !== r.version) throw fail(409, '다른 곳에서 먼저 저장된 항목입니다. 새로고침한 뒤 다시 수정해 주세요.');
    const n = nodeOf(r.id), own = n && ['part', 'chapter'].includes(n.kind) && hasKids(n);
    const title = own ? r.title : String(body.title || '').trim(); if (!title) throw fail(400, '제목을 입력해 주세요.');
    const next = { title, status: ['changed', 'unchanged', 'wording_only', 'missing', 'draft'].includes(body.status) ? body.status : r.status, revised: sanitize(body.revised ?? r.revised), reason: sanitize(body.reason ?? r.reason) };
    if (r.user_created || r.original_available === false && !r.original) next.original = sanitize(body.original ?? r.original);
    if (Object.keys(next).every(k => next[k] === r[k])) return view(r);
    Object.assign(r, next); if (n && !own) n.title = title; r.version++; r.updated_at = now(); hist(r, '수정 저장'); return view(r);
  });
  if (path === 'sections' && method === 'POST') return w(() => {
    needAuth(); const title = String(body.title || '').trim(); if (!title) throw fail(400, '항목 제목을 입력해 주세요.');
    const chap = D.outline.find(n => !n.deleted && n.part === body.part && n.chapter === body.chapter && (body.chapter ? n.kind === 'chapter' : n.kind === 'part')) || D.outline.find(n => n.part === body.part);
    const parent = chap || null, node = { id: 'n' + uid(), parent_id: parent ? parent.id : null, kind: 'section', title, ordinal: D.outline.length + 1, body_section_id: null, part: parent ? parent.part : (body.part || title), chapter: parent ? (parent.kind === 'chapter' ? parent.title : '') : '' };
    D.outline.splice(parent ? subtreeEnd(parent) : D.outline.length, 0, node);
    const r = newRecord(node, { user_created: true, is_new_in_sixth: true, original_available: false, status: 'changed' }); hist(r, '새 항목 생성'); return view(r);
  });
  if ((m = path.match(/^outline\/([\w-]+)\/body$/)) && method === 'POST') return w(() => {
    needAuth(); const n = D.outline.find(x => x.id === m[1]); if (!n) throw fail(404, '목차를 찾을 수 없습니다.');
    const old = Object.values(D.records).find(r => r.node_id === n.id && r.deleted);
    if (n.body_section_id && !D.records[n.body_section_id].deleted) throw fail(409, '이미 도입문이 있습니다.');
    const r = newRecord(n, { user_created: true, is_new_in_sixth: true, original_available: false, status: 'changed', ...(old ? {} : {}) }); hist(r, '도입문 생성'); return view(r);
  });
  if ((m = path.match(/^sections\/([\w-]+)\/delete$/))) return w(() => {
    needAuth(); const r = rec(m[1]); if (body.version !== r.version) throw fail(409, '다른 곳에서 먼저 저장된 항목입니다.');
    r.deleted = true; r.version++; r.updated_at = now(); hist(r, '삭제'); const n = nodeOf(r.id);
    if (n) { if (hasKids(n)) n.body_section_id = null; else n.deleted = true; } return { ok: true };
  });
  if (path === 'trash') { needAuth(); return { sections: Object.values(D.records).filter(r => r.deleted).map(r => ({ id: r.id, title: r.title, part: r.part, chapter: r.chapter, version: r.version })) }; }
  if ((m = path.match(/^sections\/([\w-]+)\/restore$/))) return w(() => {
    needAuth(); const r = rec(m[1]); if (body.version !== r.version) throw fail(409, '다른 곳에서 먼저 저장된 항목입니다.');
    const h = (D.history[r.id] || []).find(x => x.version === body.target_version); if (!h) throw fail(404, '복원할 버전이 없습니다.');
    Object.assign(r, JSON.parse(JSON.stringify(h.record)), { id: r.id, version: r.version + 1, deleted: false, updated_at: now() });
    const n = D.outline.find(x => x.id === r.node_id); if (n) { n.deleted = false; n.body_section_id = r.id; n.title = r.title; }
    hist(r, `v${body.target_version} 복원`); return view(r);
  });
  if ((m = path.match(/^sections\/([\w-]+)\/history$/))) { rec(m[1]); return { history: [...(D.history[m[1]] || [{ version: 0, note: '초기 자료', saved_at: rec(m[1]).updated_at }])].reverse().map(h => ({ version: h.version, note: h.note, saved_at: h.saved_at })) }; }
  if ((m = path.match(/^sections\/([\w-]+)\/revision\/(\d+)$/))) {
    const r = rec(m[1]), h = (D.history[r.id] || []).find(x => x.version === +m[2]);
    if (!h) { if (+m[2] === 0) return { version: 0, saved_at: r.updated_at, record: view(r) }; throw fail(404, '버전을 찾을 수 없습니다.'); }
    return { version: h.version, saved_at: h.saved_at, record: h.record };
  }
  if ((m = path.match(/^sections\/([\w-]+)\/track$/))) { const r = rec(m[1]); return track(r.original, method === 'POST' ? sanitize(body.revised) : r.revised, r.original_available !== false && r.status !== 'missing' || !!r.revised); }
  if ((m = path.match(/^sections\/([\w-]+)\/comments$/))) {
    const list = D.comments[m[1]] = D.comments[m[1]] || [];
    if (method === 'GET') return { comments: list };
    return w(() => { needAuth(); const b = String(body.body || '').trim(); if (!b) throw fail(400, '코멘트를 입력해 주세요.'); if (b.length > 5000) throw fail(400, '코멘트는 5,000자까지 입력할 수 있습니다.');
      let c = list.find(x => x.id === body.id); if (!c) { c = { id: body.id || uid(), created_at: now() }; list.push(c); }
      Object.assign(c, { author: String(body.author || '').trim() || '익명', body: b }); return c; });
  }
  if ((m = path.match(/^sections\/([\w-]+)\/comments\/(\w+)\/delete$/))) return w(() => { needAuth(); D.comments[m[1]] = (D.comments[m[1]] || []).filter(c => c.id !== m[2]); return { ok: true }; });
  if (path === 'references' && method === 'GET') return refCatalog();
  if (path === 'references' && method === 'POST') return w(() => {
    needAuth(); const t = String(body.text || '').trim(); if (!t) throw fail(400, '참고문헌 내용을 입력해 주세요.');
    const list = D.refs.revised; let r = list.find(x => norm(x.text) === norm(t)), created = false;
    if (!r) { r = { number: list.reduce((a, x) => Math.max(a, x.number), 0) + 1, text: t }; list.push(r); created = true; }
    return { created, reference: r, catalog: refCatalog(), section: null }; });
  if (path === 'assets') return { assets: Object.values(D.assets).map(a => ({ id: a.id, kind: a.kind, title: a.title, meta: a.meta, version: a.version })) };
  if ((m = path.match(/^assets\/(\w+)\/details$/))) { const a = D.assets[m[1]]; if (!a) throw fail(404, '자료를 찾을 수 없습니다.'); return { asset: assetView(a, a.version), versions: a.versions.map(v => ({ version: v.version })).reverse() }; }
  if ((m = path.match(/^assets\/(\w+)\/versions\/(\d+)$/))) { const a = D.assets[m[1]]; if (!a) throw fail(404, '자료를 찾을 수 없습니다.'); return assetView(a, +m[2]); }
  throw fail(404, '지원하지 않는 요청입니다: ' + path);
}
const refCatalog = () => ({ editions: { original: { label: D.labels.original, references: D.refs.original }, revised: { label: D.labels.revised, references: D.refs.revised } }, can_create_revised: authed(), basis: '저장된 참고문헌 목록 기준', creation_error: authed() ? '' : '편집 로그인이 필요합니다.' });
function assetView(a, v) { const ver = a.versions.find(x => x.version === v); if (!ver) throw fail(404, '버전을 찾을 수 없습니다.'); return { id: a.id, kind: a.kind, title: a.title, meta: a.meta, version: v, html: `<div class="managed-asset" contenteditable="false" data-asset-id="${a.id}" data-asset-version="${v}" data-kind="${a.kind}">${ver.html}</div>` }; }

/* ---------- 표·그림 보관함 ---------- */
const assets = {
  async list() { await ready; return Object.values(D.assets); },
  async save({ id, kind, title, edition, number, html }) {
    await ready; needAuth(); title = String(title || '').trim(); if (!title) throw fail(400, '제목을 입력해 주세요.');
    const clean2 = sanitize(html); if (!textOf(clean2) && !/<img|<table/.test(clean2)) throw fail(400, '내용을 입력해 주세요.');
    let a = id && D.assets[id]; const meta = { edition: edition || '6', number: number || '' };
    if (!a) { a = D.assets[uid()] = { id: '', kind, title, meta, version: 0, versions: [] }; a.id = Object.keys(D.assets).find(k => D.assets[k] === a); }
    Object.assign(a, { kind, title, meta }); a.version++; a.versions.push({ version: a.version, html: clean2, saved_at: now() }); await save(); return a;
  },
  async remove(id) { await ready; needAuth(); delete D.assets[id]; await save(); },
  async rawHtml(id, v) { await ready; const a = D.assets[id]; return a && a.versions.find(x => x.version === (v || a.version)).html; }
};

/* ---------- 자료실 (IndexedDB) ---------- */
const files = {
  async list() { await ready; return [...D.files].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)); },
  async add(file, description) { await ready; needAuth(); if (!file.size || file.size > 100e6) throw fail(400, '빈 파일은 올릴 수 없으며 파일당 최대 100MB까지 지원합니다.');
    const id = uid(); await kv('readwrite', s => s.put(file, 'file:' + id)); D.files.push({ id, name: file.name, size: file.size, description: description || '', uploaded_at: now() }); await save(); return id; },
  async blob(id) { await ready; return kv('readonly', s => s.get('file:' + id)); },
  async remove(id) { await ready; needAuth(); await kv('readwrite', s => s.delete('file:' + id)); D.files = D.files.filter(f => f.id !== id); await save(); }
};

/* ---------- 설정 / 가져오기 / 내보내기 / GitHub ---------- */
const settings = {
  async get() { await ready; return { title: D.title, labels: { ...D.labels }, refs: JSON.parse(JSON.stringify(D.refs)), gh: { ...D.gh }, configured: !!D.pw, seeded }; },
  async set({ title, labels, refs, gh }) { await ready; needAuth(); if (title) D.title = title; if (labels) D.labels = labels; if (refs) D.refs = refs; if (gh) D.gh = gh; await save(); },
  async changePassword(p) { await ready; needAuth(); D.pw = await sha(p); sessionStorage.setItem('mdce.auth', D.pw); await save(); }
};
const data = {
  async importMarkdown(origText, revText, refs) { await ready; if (D.outline.length) needAuth(); const r = build(splitMd(origText), revText ? splitMd(revText) : null); if (refs) D.refs = refs; await save(); return r; },
  async importJson(obj) { await ready; if (D.outline.length) needAuth(); if (!obj || obj.v !== 2 || !obj.records) throw new Error('이 프로그램에서 내보낸 JSON이 아닙니다.'); const pw = D.pw; for (const r of Object.values(obj.records)) for (const f of ['original', 'revised', 'reason']) r[f] = sanitize(r[f] || ''); for (const a of Object.values(obj.assets || {})) a.versions.forEach(v => { v.html = sanitize(v.html); }); obj.outline = obj.outline || []; obj.history = obj.history || {}; obj.comments = obj.comments || {}; obj.refs = obj.refs || { original: [], revised: [] }; obj.assets = obj.assets || {}; obj.files = []; obj.gh = { ...(D.gh || {}) }; D = obj; D.pw = pw; await save(); },
  async exportJson() { await ready; return JSON.stringify({ ...D, pw: undefined }, null, 1); },
  async exportMarkdown(which) { await ready; const out = [];
    D.outline.filter(n => !n.deleted).forEach(n => { const depth = (() => { let d = 1, x = n; while (x.parent_id) { x = D.outline.find(y => y.id === x.parent_id); d++; } return d; })(); out.push('#'.repeat(Math.min(6, depth)) + ' ' + n.title);
      const r = n.body_section_id && D.records[n.body_section_id]; if (r && !r.deleted) { const md = htmlToMd(r[which]); if (md) out.push(md); } });
    return out.join('\n\n') + '\n'; },
  async rows() { await ready; return D.outline.filter(n => !n.deleted && n.body_section_id && !D.records[n.body_section_id].deleted).map(n => { const r = D.records[n.body_section_id]; return { r, node: n, track: track(r.original, r.revised, r.original_available !== false && r.status !== 'missing' || !!r.revised) }; }); },
  async labels() { await ready; return D.labels; },
  async title() { await ready; return D.title; },
  async reset() { await ready; needAuth(); const pw = D.pw; D = emptyDoc(); D.pw = pw; await save(); }
};
const gh = {
  cfg() { return { repo: '', branch: 'main', path: 'data/document.json', token: '', ...D.gh }; },
  url(c, p) { return `https://api.github.com/repos/${c.repo}/contents/${(p || c.path).split('/').map(encodeURIComponent).join('/')}`; },
  head(c, raw) { return { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(c.token ? { Authorization: 'Bearer ' + c.token } : {}) }; },
  async pull() { await ready; needAuth(); const c = gh.cfg(); if (!c.repo) throw new Error('저장소를 설정해 주세요.');
    const r = await fetch(gh.url(c) + '?ref=' + encodeURIComponent(c.branch), { headers: gh.head(c, true), cache: 'no-store' }); if (!r.ok) throw new Error('불러오기 실패 (' + r.status + ')');
    await data.importJson(await r.json()); },
  async push() { await ready; needAuth(); const c = gh.cfg(); if (!c.repo || !c.token) throw new Error('저장소와 토큰을 설정해 주세요.');
    const bytes = new TextEncoder().encode(await data.exportJson()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    let sha1; const g = await fetch(gh.url(c) + '?ref=' + encodeURIComponent(c.branch), { headers: gh.head(c), cache: 'no-store' }); if (g.ok) sha1 = (await g.json()).sha;
    const r = await fetch(gh.url(c), { method: 'PUT', headers: gh.head(c), body: JSON.stringify({ message: '문서 저장 ' + now(), content: btoa(bin), branch: c.branch, sha: sha1 }) });
    if (!r.ok) throw new Error('커밋 실패 (' + r.status + ') ' + (await r.text()).slice(0, 100)); },
  async upload(file) { const c = gh.cfg(); if (!c.repo || !c.token) throw new Error('GitHub 저장소와 토큰을 설정해 주세요.'); if (file.size > 25e6) throw new Error('GitHub 업로드는 25MB까지 지원합니다.');
    const b64 = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(file); });
    const r = await fetch(gh.url(c, 'files/' + file.name), { method: 'PUT', headers: gh.head(c), body: JSON.stringify({ message: '자료 업로드 ' + file.name, content: b64, branch: c.branch }) });
    if (!r.ok) throw new Error('업로드 실패 (' + r.status + ')'); }
};

window.Store = { ready, api, assets, files, settings, data, gh, track, sanitize, textOf, htmlToMd, mdToHtml, esc, uid, authed, flush: save };
})();

