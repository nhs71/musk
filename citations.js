/* 참고문헌: 본문의 [1], [2-4] 같은 인용번호에 마우스를 올리면 참고문헌 내용을 보여주고, 삽입 대화상자로 번호를 넣는다. */
(function (global) {
  'use strict';
  const normalize = nums => [...new Set(nums.filter(n => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b);
  const formatCitation = nums => { const v = normalize(nums); return v.length ? '[' + v.join(', ') + ']' : ''; };
  const matches = (entry, q) => { const terms = q.trim().toLocaleLowerCase('ko').split(/\s+/).filter(Boolean), hay = (entry.number + ' ' + entry.text).toLocaleLowerCase('ko'); return terms.every(t => hay.includes(t)); };
  global.ReferenceTools = { formatCitation, matches, initHover, init };

  function findCitations(text) {
    const found = [];
    for (const m of text.matchAll(/\[\s*\d+(?:\s*[-–—−]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—−]\s*\d+)?)*\s*\]/g)) {
      const values = []; let valid = true;
      for (const item of m[0].slice(1, -1).split(',')) {
        const [a, b = a] = item.trim().split(/\s*[-–—−]\s*/).map(Number);
        if (a < 1 || b > 9999 || b < a || b - a > 500) { valid = false; break; }
        for (let n = a; n <= b; n++) values.push(n);
      }
      if (valid) found.push({ start: m.index, end: m.index + m[0].length, numbers: normalize(values) });
    }
    return found;
  }
  // 문서 DOM을 바꾸지 않고 텍스트 위치만 읽어 Range로 변환한다.
  function citationRanges(root, edition) {
    const pieces = []; let text = '';
    const block = new Set(['P', 'DIV', 'LI', 'TD', 'TH', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'BR']);
    (function walk(n) {
      if (n.nodeType === 3) { pieces.push({ node: n, start: text.length, end: text.length + n.data.length }); text += n.data; return; }
      if (n.nodeType !== 1) return;
      if (root.id === 'tracking') {
        const added = n.matches('.track-added'), removed = n.matches('.track-removed, del');
        if ((edition === 'original' && (added || n.matches('ins'))) || (edition === 'revised' && removed)) return;
      }
      if (n.matches('script,style,.track-label,.track-message')) return;
      const b = block.has(n.tagName); if (b) text += '\0'; n.childNodes.forEach(walk); if (b) text += '\0';
    })(root);
    return findCitations(text).map(c => {
      const ranges = [];
      for (const p of pieces) {
        if (p.end <= c.start) continue; if (p.start >= c.end) break;
        const r = document.createRange(); r.setStart(p.node, Math.max(0, c.start - p.start)); r.setEnd(p.node, Math.min(p.node.length, c.end - p.start)); ranges.push(r);
      }
      return { ...c, edition, ranges };
    });
  }

  function initHover({ fields, api, getEdition = id => id === 'original' ? 'original' : 'revised' }) {
    const roots = fields.map(id => document.getElementById(id)).filter(Boolean), cache = new Map();
    const popup = document.createElement('aside'); popup.className = 'reference-preview'; popup.hidden = true; popup.setAttribute('role', 'tooltip'); document.body.append(popup);
    let catalog = null, loading = null, active = null, timer, frame, last;
    document.addEventListener('reference-catalog-updated', e => { catalog = e.detail; hide(); });
    const load = () => catalog ? Promise.resolve(catalog) : (loading = loading || api('references').then(v => (catalog = v)).finally(() => { loading = null; }));
    const hide = () => { clearTimeout(timer); active = null; popup.hidden = true; };
    const later = () => { clearTimeout(timer); timer = setTimeout(hide, 180); };
    function place(x, y) {
      popup.style.left = '8px'; popup.style.top = '8px'; const b = popup.getBoundingClientRect(), g = 12;
      popup.style.left = Math.max(8, Math.min(x + g, innerWidth - b.width - 8)) + 'px';
      popup.style.top = (y + g + b.height <= innerHeight - 8 ? y + g : Math.max(8, y - b.height - g)) + 'px';
    }
    function fill(hit, v) {
      const ed = v.editions[hit.edition], title = document.createElement('strong'), ul = document.createElement('ul');
      title.textContent = ed.label + ' · ' + formatCitation(hit.numbers);
      for (const n of hit.numbers) { const li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('span'); b.textContent = '[' + n + '] '; s.textContent = ed.references.find(e => e.number === n)?.text || '이 판의 참고문헌 목록에 없는 번호입니다.'; li.append(b, s); ul.append(li); }
      popup.replaceChildren(title, ul);
    }
    const candidates = root => { if (!cache.has(root)) cache.set(root, root.id === 'tracking' ? [...citationRanges(root, 'revised'), ...citationRanges(root, 'original')] : citationRanges(root, getEdition(root.id))); return cache.get(root); };
    async function show(hit, x, y) {
      clearTimeout(timer); if (active === hit) return; active = hit; popup.textContent = '참고문헌을 불러오는 중…'; popup.hidden = false; place(x, y);
      try { const v = await load(); if (active !== hit) return; fill(hit, v); place(x, y); } catch { if (active === hit) { popup.textContent = '참고문헌을 불러오지 못했습니다.'; place(x, y); } }
    }
    const atPoint = (root, x, y) => { for (const c of candidates(root)) for (const r of c.ranges) for (const q of r.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return c; return null; };
    for (const root of roots) {
      new MutationObserver(() => { cache.delete(root); if (active) hide(); }).observe(root, { childList: true, characterData: true, subtree: true });
      root.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; last = { root, x: e.clientX, y: e.clientY }; if (frame) return;
        frame = requestAnimationFrame(() => { frame = null; if (!last) return; const hit = atPoint(last.root, last.x, last.y); if (hit) show(hit, last.x, last.y); else later(); }); });
      root.addEventListener('pointerleave', () => { last = null; later(); });
      root.addEventListener('click', e => { const hit = atPoint(root, e.clientX, e.clientY); if (hit) show(hit, e.clientX, e.clientY); });
    }
    popup.addEventListener('pointerenter', () => clearTimeout(timer)); popup.addEventListener('pointerleave', later);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    document.addEventListener('pointerdown', e => { if (!popup.contains(e.target)) hide(); });
    document.addEventListener('scroll', e => { if (!popup.contains(e.target)) hide(); }, true);
    window.addEventListener('resize', hide);
  }

  function init({ fields, getContext, api, onInserted, toast }) {
    const $ = id => document.getElementById(id), dialog = $('reference-dialog'), names = { original: '원문', revised: '수정 초안', reason: '검토 메모' };
    let catalog = null, selected = new Set(), bookmark = null, last = null, req = 0;
    const editable = f => { const c = getContext(f); return c.editable ? c : null; };
    const inField = (r, f) => r && $(f).contains(r.startContainer) && $(f).contains(r.endContainer);
    function capture() {
      const s = getSelection(); if (!s?.rangeCount) return null; const r = s.getRangeAt(0), f = fields.find(id => inField(r, id)), c = f && editable(f);
      return c ? { ...c, field: f, range: r.cloneRange() } : null;
    }
    const valid = v => { const c = v && editable(v.field); return v && c && c.id === v.id && c.version === v.version && inField(v.range, v.field); };
    const atEnd = f => { const c = editable(f); if (!c) return null; const r = document.createRange(); r.selectNodeContents($(f)); r.collapse(false); return { ...c, field: f, range: r }; };
    const remember = () => { if (dialog.open) return; const v = capture(); if (v) last = v; };
    document.addEventListener('selectionchange', remember);
    $('insert-reference').addEventListener('mousedown', e => e.preventDefault());
    $('insert-reference').addEventListener('click', open);
    function showCreate(on) { $('reference-create-form').hidden = !on; $('reference-create-toggle').setAttribute('aria-expanded', String(on)); $('reference-create-error').hidden = true; if (on) { $('reference-created').hidden = true; $('reference-new-text').focus(); } }
    async function open() {
      const v = [capture(), last].find(x => valid(x)) || atEnd('revised');
      if (!valid(v)) { toast('편집할 입력란에서 삽입할 위치를 먼저 클릭해 주세요.'); return; }
      bookmark = { ...v, range: v.range.cloneRange() }; selected.clear(); catalog = null; $('reference-create-form').reset(); showCreate(false); $('reference-created').hidden = true;
      $('reference-edition').value = v.field === 'original' ? 'original' : 'revised'; $('reference-search').value = '';
      $('reference-target').textContent = names[v.field] + '의 커서 위치에 인용번호를 삽입합니다. 여러 문헌을 선택할 수 있습니다.';
      $('reference-error').hidden = true; $('reference-list').replaceChildren(); $('reference-count').textContent = '참고문헌을 불러오는 중…'; update();
      dialog.showModal(); $('reference-search').focus(); const t = ++req;
      try { const r = await api('references'); if (t !== req || !dialog.open) return; catalog = r; document.dispatchEvent(new CustomEvent('reference-catalog-updated', { detail: catalog })); render(); }
      catch (e) { if (t === req && dialog.open) { $('reference-count').textContent = ''; $('reference-error').textContent = e.message; $('reference-error').hidden = false; } }
    }
    function update() {
      $('reference-selection').textContent = selected.size ? `${selected.size}개 선택 · ${formatCitation([...selected])}` : '선택 없음';
      $('reference-submit').disabled = !selected.size || !catalog; $('reference-clear').disabled = !selected.size;
      $('reference-create-toggle').hidden = $('reference-edition').value !== 'revised'; $('reference-create-toggle').disabled = !catalog?.can_create_revised; $('reference-create-toggle').title = catalog?.creation_error || '';
    }
    function render() {
      if (!catalog) return; const ed = catalog.editions[$('reference-edition').value], rows = ed.references.filter(r => matches(r, $('reference-search').value));
      $('reference-basis').textContent = ed.label + ' — ' + catalog.basis + ' — 선택한 판의 참고문헌 번호를 사용합니다.';
      $('reference-count').textContent = `${rows.length}건 표시 / 전체 ${ed.references.length}건`;
      const kids = rows.map(e => {
        const row = document.createElement('label'), cb = document.createElement('input'), n = document.createElement('strong'), t = document.createElement('span');
        row.className = 'reference-row'; cb.type = 'checkbox'; cb.checked = selected.has(e.number); n.textContent = '[' + e.number + ']'; t.textContent = e.text; row.classList.toggle('selected', cb.checked);
        cb.addEventListener('change', () => { cb.checked ? selected.add(e.number) : selected.delete(e.number); row.classList.toggle('selected', cb.checked); update(); });
        row.append(cb, n, t); return row;
      });
      $('reference-list').replaceChildren(...kids);
      if (!kids.length) { const p = document.createElement('p'); p.className = 'muted'; p.style.padding = '10px'; p.textContent = ed.references.length ? '검색 결과가 없습니다.' : '등록된 참고문헌이 없습니다. [설정]에서 목록을 붙여 넣거나 새로 등록하세요.'; $('reference-list').append(p); }
      update();
    }
    $('reference-search').addEventListener('input', render);
    $('reference-edition').addEventListener('change', () => { selected.clear(); showCreate(false); $('reference-created').hidden = true; render(); });
    $('reference-clear').addEventListener('click', () => { selected.clear(); render(); });
    $('reference-create-toggle').addEventListener('click', () => showCreate($('reference-create-form').hidden));
    $('reference-create-cancel').addEventListener('click', () => showCreate(false));
    $('reference-create-form').addEventListener('submit', async e => {
      e.preventDefault(); const text = $('reference-new-text').value.trim(), fail = m => { $('reference-create-error').textContent = m; $('reference-create-error').hidden = false; };
      if (!text) { fail('참고문헌 내용을 입력해 주세요.'); return; }
      try {
        const r = await api('references', { method: 'POST', body: JSON.stringify({ edition: 'revised', text }) }); catalog = r.catalog; selected.add(r.reference.number); $('reference-search').value = '';
        document.dispatchEvent(new CustomEvent('reference-catalog-updated', { detail: catalog })); $('reference-create-form').reset(); showCreate(false); render();
        $('reference-created').textContent = r.created ? `[${r.reference.number}] 문헌을 등록하고 선택했습니다. 아래 삽입 버튼을 누르면 본문에 인용번호를 넣습니다.` : `이미 등록된 [${r.reference.number}] 문헌을 선택했습니다.`; $('reference-created').hidden = false;
      } catch (er) { fail(er.message); }
    });
    $('reference-submit').addEventListener('click', () => {
      if (!selected.size || !catalog) return; const t = bookmark;
      if (!valid(t)) { toast('편집 위치가 바뀌었습니다. 창을 닫고 삽입할 위치를 다시 선택해 주세요.'); return; }
      const cite = formatCitation([...selected]); bookmark = null; dialog.close();
      $(t.field).focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(t.range.cloneRange());
      if (!document.execCommand('insertText', false, cite)) { toast('삽입하지 못했습니다. 본문 위치를 다시 선택해 주세요.'); return; }
      onInserted(t.field); remember(); toast('인용번호를 삽입했습니다. 변경 저장을 눌러 반영해 주세요.');
    });
    dialog.addEventListener('close', () => { ++req; bookmark = null; });
  }
})(globalThis);
