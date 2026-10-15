/* 표·그림 불러오기: 보관함의 자료를 본문에 삽입하거나, 본문의 자료를 선택해 다른 버전으로 교체한다. */
(() => {
  'use strict';
  window.AssetPicker = { init({ api, getContext, onInserted, toast }) {
    const $ = id => document.getElementById(id), fields = ['revised', 'reason'];
    let bookmark = null, selectedAsset = null, target = null, chosen = null, ticket = 0, catalog = [];
    const kinds = { table: '표', image: '그림', figure: '그림·도식', form: '서식', formula: '수식' };
    const editable = () => getContext().editable;
    function clearSelection() { document.querySelectorAll('.asset-selected').forEach(n => n.classList.remove('asset-selected')); selectedAsset = null; $('insert-asset').textContent = '표·그림 불러오기'; }
    function capture() {
      if (!editable()) return null; const s = getSelection(); if (!s?.rangeCount) return null; const r = s.getRangeAt(0);
      const f = fields.find(id => $(id).contains(r.startContainer) && $(id).contains(r.endContainer)); return f ? { ...getContext(), field: f, range: r.cloneRange() } : null;
    }
    function targetsAsset(v) {
      const n = selectedAsset?.node; if (!n || !$(v.field).contains(n)) return false; const r = v.range;
      if (n.contains(r.startContainer) && n.contains(r.endContainer)) return true;
      const around = document.createRange(); around.selectNode(n);
      return !r.collapsed && r.compareBoundaryPoints(Range.START_TO_START, around) === 0 && r.compareBoundaryPoints(Range.END_TO_END, around) === 0;
    }
    function remember() { const v = capture(); if (v) { bookmark = v; if (selectedAsset && !targetsAsset(v)) clearSelection(); } return v; }
    document.addEventListener('selectionchange', remember);
    for (const id of fields) $(id).addEventListener('click', e => {
      const a = e.target.closest('.managed-asset'); clearSelection();
      if (a && editable()) {
        selectedAsset = { node: a, field: id, ...getContext() }; a.classList.add('asset-selected'); $('insert-asset').textContent = '선택한 표·그림 교체';
        const r = document.createRange(); r.selectNode(a); $(id).focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      } else bookmark = capture();
    });
    $('insert-asset').addEventListener('mousedown', e => { remember(); e.preventDefault(); });
    const valid = v => { const c = getContext(); return v && c.editable && c.id === v.id && c.version === v.version; };
    const showError = (t = '') => { $('asset-picker-error').textContent = t; $('asset-picker-error').hidden = !t; };
    async function choose(asset) {
      const req = ++ticket; chosen = null; $('asset-insert').disabled = true;
      try {
        const d = await api('assets/' + asset.id + '/details'); if (req !== ticket || !$('asset-picker').open) return;
        chosen = d.asset; $('asset-preview').innerHTML = chosen.html; $('asset-insert').disabled = false;
        $('asset-picker-version').replaceChildren(...d.versions.map(v => new Option('v' + v.version, v.version))); $('asset-picker-version').disabled = false;
        $('asset-picker-list').querySelectorAll('button').forEach(n => n.setAttribute('aria-current', String(n.dataset.id === asset.id)));
      } catch (e) { showError(e.message); }
    }
    function list() {
      const q = $('asset-picker-search').value.toLowerCase(), ed = $('asset-picker-edition').value; $('asset-picker-list').replaceChildren();
      const cur = selectedAsset?.node?.dataset.assetId;
      const sorted = [...catalog].sort((a, b) => Number(b.id === cur) - Number(a.id === cur));
      for (const a of sorted.filter(a => (!ed || (a.meta?.edition || '6') === ed) && [a.title, a.meta?.number].join(' ').toLowerCase().includes(q))) {
        const b = document.createElement('button'), s = document.createElement('strong'), sm = document.createElement('small');
        b.type = 'button'; b.dataset.id = a.id; s.textContent = a.title; sm.textContent = `${kinds[a.kind] || a.kind} · ${a.meta?.edition || '6'}판 · v${a.version}`; b.append(s, sm); b.onclick = () => choose(a); $('asset-picker-list').append(b);
      }
    }
    async function refresh() {
      chosen = null; $('asset-insert').disabled = true; $('asset-picker-version').disabled = true; $('asset-preview').textContent = '표·그림을 선택하면 여기에서 미리 볼 수 있습니다.';
      catalog = (await api('assets')).assets; list();
      if (!catalog.length) $('asset-preview').textContent = '보관한 표·그림이 없습니다. ‘표·그림 도구’에서 먼저 만들어 주세요.';
    }
    $('asset-picker-search').oninput = list; $('asset-picker-edition').onchange = list;
    $('asset-picker-version').onchange = async () => {
      if (!chosen) return; const id = chosen.id, v = $('asset-picker-version').value, req = ++ticket; $('asset-insert').disabled = true;
      try { const a = await api('assets/' + id + '/versions/' + v); if (req !== ticket) return; chosen = a; $('asset-preview').innerHTML = a.html; $('asset-insert').disabled = false; } catch (e) { showError(e.message); }
    };
    let docReq = 0;
    window.AssetPicker.refreshDocument = async rec => {
      const req = ++docReq, box = $('document-assets'); if (!box) return; const uses = [];
      for (const f of ['original', 'revised', 'reason']) { const root = document.createElement('div'); root.innerHTML = Store.sanitize(rec[f] || ''); for (const n of root.querySelectorAll('[data-asset-id]')) uses.push({ field: f, id: n.dataset.assetId, version: Number(n.dataset.assetVersion) }); }
      let idx = {}; try { idx = Object.fromEntries((await api('assets')).assets.map(a => [a.id, a])); } catch { /* 무시 */ }
      if (req !== docReq) return; box.replaceChildren();
      for (const u of uses) { const a = idx[u.id], l = document.createElement('a'); l.href = 'assets.html?id=' + u.id; l.target = '_blank'; l.rel = 'noopener';
        l.textContent = `${u.field === 'original' ? '원문' : u.field === 'revised' ? '수정본' : '메모'} ${a?.title || '보관함 자료'} · v${u.version}${a && a.version > u.version ? ' · 새 버전 있음' : ''}`; box.append(l); }
    };
    $('insert-asset').onclick = async () => {
      if (!editable()) return; target = null; chosen = null; showError();
      if (valid(selectedAsset) && $(selectedAsset.field).contains(selectedAsset.node)) target = { ...selectedAsset, replacing: true };
      else if (valid(bookmark) && $(bookmark.field).contains(bookmark.range.startContainer) && $(bookmark.field).contains(bookmark.range.endContainer)) target = { ...bookmark, replacing: false };
      else { toast('수정 초안이나 검토 메모에서 표·그림을 넣을 문단을 먼저 클릭해 주세요.'); return; }
      $('asset-picker-summary').textContent = target.replacing ? '선택한 표·그림을 아래에서 고른 버전으로 교체합니다.' : '커서가 놓인 문단 다음에 삽입합니다. 삽입 후 본문의 변경 저장을 눌러 주세요.';
      $('asset-insert').textContent = target.replacing ? '선택한 버전으로 교체' : '본문에 삽입'; $('asset-picker').showModal();
      try { await refresh(); } catch (e) { showError(e.message); }
    };
    $('asset-picker-refresh').onclick = () => refresh().catch(e => showError(e.message));
    $('asset-picker-close').onclick = () => { $('asset-picker').close(); ++ticket; };
    $('asset-picker').addEventListener('cancel', () => ++ticket);
    $('asset-insert').onclick = () => {
      if (!chosen || !valid(target)) { showError('본문이 바뀌었습니다. 창을 닫고 삽입 위치를 다시 선택해 주세요.'); return; }
      const field = $(target.field), range = document.createRange();
      if (target.replacing) { if (!field.contains(target.node)) { showError('교체할 표·그림을 다시 선택해 주세요.'); return; } range.selectNode(target.node); }
      else {
        if (!field.contains(target.range.startContainer)) { showError('삽입 위치를 다시 선택해 주세요.'); return; }
        let b = target.range.startContainer;
        if (b === field) { range.setStart(field, target.range.startOffset); range.collapse(true); } else { while (b.parentNode !== field) b = b.parentNode; range.setStartAfter(b); range.collapse(true); }
      }
      $('asset-picker').close(); field.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      if (!document.execCommand('insertHTML', false, chosen.html + (target.replacing ? '' : '<p><br></p>'))) { toast('삽입하지 못했습니다. 문단을 다시 선택해 주세요.'); return; }
      clearSelection(); onInserted(target.field); bookmark = null; target = null; toast('삽입했습니다. 변경 저장을 누르면 본문에 반영됩니다.');
    };
  } };
})();
