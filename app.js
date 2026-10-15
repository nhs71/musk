'use strict';
const $ = id => document.getElementById(id);
const api = (path, options) => Store.api(path, options);
const fields = ['original', 'revised', 'reason'];
const names = { changed: '내용 변경', unchanged: '변경 없음', wording_only: '문구 정비만', missing: '비교 자료 없음', draft: '확인 필요' };
const state = { index: null, node: null, doc: null, authenticated: false, editing: false, dirty: false, saving: false, loading: false, filter: 'all', visible: [], expanded: new Map(), outlineFilter: '', request: 0, historyRequest: 0, revisionRequest: 0, revision: null, historyId: null, labels: { original: '원문', revised: '수정 초안' } };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const stamp = v => new Date(v).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const clean = Store.sanitize;
let toastTimer;
function toast(m) { $('toast').textContent = m; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function error(m) { $('error').textContent = m || ''; $('error').hidden = !m; }
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* 지원하지 않는 브라우저 */ }
const sectionComments = SectionComments.init({ api, toast });
const isUnchanged = i => ['unchanged', 'wording_only'].includes(i.status);
const isEdited = i => i.version > (i.base_version || 0) || i.user_created;
const outlineNodes = () => state.index?.outline ?? [];
const nodeForSection = id => id ? outlineNodes().find(n => n.body_section_id === id) : undefined;
const ownIntroduction = (n = state.node) => !!n && ['part', 'chapter'].includes(n.kind) && outlineNodes().some(x => x.parent_id === n.id);
function ancestors(node) { const r = [], seen = new Set(); while (node?.parent_id && !seen.has(node.parent_id)) { seen.add(node.parent_id); node = outlineNodes().find(i => i.id === node.parent_id); if (node) r.unshift(node); } return r; }
const childrenOf = n => outlineNodes().filter(i => i.parent_id === n?.id);

function applyLabels() {
  const L = state.labels;
  document.querySelectorAll('[data-label]').forEach(n => n.textContent = L[n.dataset.label]);
  $('brand-sub').textContent = `${L.original} → ${L.revised}`;
}
function updateSession() { $('account').textContent = state.authenticated ? '로그아웃' : '편집 로그인'; updateMode(); }
function updateMode() {
  const cid = state.doc?.id, link = $('comparison-example-link');
  if (link) { link.hidden = !cid; if (cid) { const a = link.querySelector('a'); a.href = 'comparisons.html?id=' + encodeURIComponent(cid); a.textContent = '변경대비표 보기'; } }
  sectionComments.activate(state.doc?.id || null, state.authenticated);
  const editable = !!state.doc && state.editing && state.authenticated && !state.loading && !state.saving;
  $('create-item').disabled = !state.index || state.saving || state.loading;
  $('trash-button').hidden = !state.authenticated; $('trash-button').disabled = state.saving || state.loading;
  $('delete-item').disabled = !editable; $('delete-item').textContent = ownIntroduction() ? '도입문 삭제' : '항목 삭제';
  $('edit-title').disabled = !editable || ownIntroduction(); $('edit-title').closest('label').hidden = ownIntroduction();
  $('history-button').disabled = !state.doc || state.loading || state.saving;
  $('create-intro').hidden = !state.authenticated; $('create-intro').disabled = state.loading || state.saving; $('intro-login-hint').hidden = state.authenticated;
  $('insert-reference').disabled = !editable; $('insert-asset').disabled = !editable;
  fields.forEach(id => { const on = editable && id !== 'original'; $(id).contentEditable = String(on); $(id).setAttribute('aria-readonly', String(!on)); });
  $('view-mode').classList.toggle('active', !state.editing); $('view-mode').setAttribute('aria-pressed', String(!state.editing));
  $('edit-mode').classList.toggle('active', state.editing); $('edit-mode').setAttribute('aria-pressed', String(state.editing));
  $('edit-tools').hidden = !editable; $('edit-hint').hidden = !editable;
  $('save').disabled = !state.dirty || !state.authenticated || state.saving || state.loading; $('save').textContent = state.saving ? '저장 중…' : '변경 저장';
  $('edit-status').disabled = !editable;
  $('save-state').className = 'save-state' + (state.dirty ? ' dirty' : '');
  $('save-state').textContent = state.saving ? '저장하고 있습니다' : state.dirty ? '저장하지 않은 수정' : state.doc?.version ? `${stamp(state.doc.updated_at)} 저장 · v${state.doc.version}` : state.doc?.user_created ? '새 항목 · 저장된 내용' : '초기 자료 · 저장된 내용';
}
function markDirty(field) {
  if (!state.editing || !state.authenticated || state.saving) return;
  state.dirty = true;
  if (['original', 'revised'].includes(field) && isUnchanged({ status: $('edit-status').value })) $('edit-status').value = 'changed';
  updateMode(); if (field === 'revised') scheduleTracking();
}
function mayLeave() {
  if (sectionComments.busy()) { toast('코멘트 처리가 끝난 뒤 이동해 주세요.'); return false; }
  if (state.saving) { toast('저장이 끝난 뒤 이동해 주세요.'); return false; }
  return !state.dirty || confirm('저장하지 않은 수정이 있습니다. 저장하지 않고 이동할까요?');
}

/* ---------- 목차 ---------- */
function renderOutline() {
  if (!state.index) return;
  const q = $('search').value.trim().toLocaleLowerCase(), part = $('part').value, nodes = outlineNodes(), recs = new Map(state.index.sections.map(i => [i.id, i])), inc = new Set();
  for (const n of nodes) {
    const it = recs.get(n.body_section_id);
    const okStatus = state.filter === 'all' || it && (state.filter === 'changed' && !isUnchanged(it) || state.filter === 'unchanged' && isUnchanged(it) || state.filter === 'edited' && isEdited(it));
    if ((!part || n.part === part) && (!q || [n.title, n.chapter, n.part, it?.search].join(' ').toLocaleLowerCase().includes(q)) && okStatus) { inc.add(n.id); ancestors(n).forEach(p => inc.add(p.id)); }
  }
  state.visible = nodes.filter(n => inc.has(n.id));
  const key = JSON.stringify([q, part, state.filter]);
  if (state.outlineFilter !== key && (q || part || state.filter !== 'all')) state.visible.forEach(n => ancestors(n).forEach(p => state.expanded.set(p.id, true)));
  state.outlineFilter = key; $('match-count').textContent = `${state.visible.length}개 항목`;
  const old = $('outline').scrollTop, byParent = new Map();
  for (const n of state.visible) { const k = n.parent_id || null; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); }
  function branch(pid) {
    const ul = el('ul', 'outline-list');
    for (const n of byParent.get(pid) || []) {
      const it = recs.get(n.body_section_id), li = el('li', 'outline-item node-' + n.kind), row = el('div', 'outline-row'), kids = byParent.has(n.id);
      const b = el('button', 'nav-section'); b.dataset.node = n.id; b.type = 'button';
      if (it) b.append(el('span', 'nav-dot ' + it.status)); b.append(el('span', 'nav-label', n.title));
      if (it && isEdited(it)) b.append(el('small', '', it.user_created ? '새 항목' : '편집'));
      if (state.node?.id === n.id) b.setAttribute('aria-current', 'page'); b.addEventListener('click', () => openNode(n.id));
      if (kids) {
        const t = el('button', 'outline-toggle'), nested = branch(n.id); t.type = 'button'; nested.id = 'children-' + n.id; t.setAttribute('aria-controls', nested.id);
        const setOpen = o => { nested.hidden = !o; t.textContent = o ? '⌄' : '›'; t.setAttribute('aria-expanded', String(o)); t.setAttribute('aria-label', `${n.title} 하위 목차 ${o ? '접기' : '펼치기'}`); };
        setOpen(state.expanded.get(n.id) ?? true);
        t.addEventListener('click', () => { const o = t.getAttribute('aria-expanded') !== 'true'; state.expanded.set(n.id, o); setOpen(o); updateCollapseLabel(); });
        row.append(t, b); li.append(row, nested);
      } else { row.append(el('span', 'outline-spacer'), b); li.append(row); }
      ul.append(li);
    }
    return ul;
  }
  $('outline').replaceChildren(branch(null));
  if (!state.visible.length) $('outline').replaceChildren(el('p', 'muted', state.index.sections.length ? '검색 조건에 맞는 항목이 없습니다.' : '항목이 없습니다.'));
  updateCollapseLabel(); $('outline').scrollTop = old; updatePosition();
}
const updateCollapseLabel = () => { $('collapse').textContent = $('outline').querySelector('.outline-toggle[aria-expanded="true"]') ? '모두 접기' : '모두 펼치기'; };
function updatePosition() {
  const at = state.visible.findIndex(i => i.id === state.node?.id);
  $('previous').disabled = at <= 0 || state.loading; $('next').disabled = at < 0 || at >= state.visible.length - 1 || state.loading;
  $('position').textContent = at < 0 ? '현재 항목은 검색 조건에 포함되지 않습니다.' : `${at + 1} / ${state.visible.length} 항목`;
}
async function refreshIndex() {
  state.index = await api('sections'); state.labels = state.index.labels || state.labels; applyLabels();
  $('doc-title').textContent = state.index.title || '마크다운 비교 편집기'; document.title = (state.index.title || '마크다운 비교 편집기');
  $('total-count').textContent = outlineNodes().length; $('count-all').textContent = state.index.sections.length;
  $('count-unchanged').textContent = state.index.sections.filter(isUnchanged).length; $('count-edited').textContent = state.index.sections.filter(isEdited).length;
  $('basis').textContent = state.index.basis;
  const sel = $('part').value; $('part').replaceChildren(new Option('전체 파트', ''), ...Array.from(new Set(state.index.catalog.map(i => i.part))).map(p => new Option(p, p))); $('part').value = sel;
  if (state.node) state.node = outlineNodes().find(n => n.id === state.node.id) || nodeForSection(state.doc?.id) || state.node;
  else if (state.doc) state.node = nodeForSection(state.doc.id) || null;
  if (state.node) { renderNodeContext(); if (!state.dirty) renderNodeHeading(); }
  renderOutline(); updateMode();
}
function renderNodeHeading() {
  const n = state.node, title = n?.kind === 'introduction' ? n.title : ownIntroduction() ? n.title : state.doc?.title || n?.title || '';
  $('breadcrumb').textContent = n ? ancestors(n).map(i => i.title).join(' / ') : [state.doc?.part, state.doc?.chapter].filter(Boolean).join(' / ');
  $('title').textContent = title; $('location').textContent = title; document.title = title + ' · ' + (state.index?.title || '편집기');
}
function renderNodeContext() {
  const nodes = childrenOf(state.node); $('node-children').hidden = !nodes.length;
  $('children-list').replaceChildren(...nodes.map(n => { const li = el('li'), b = el('button', 'text-button', n.title); b.type = 'button'; b.addEventListener('click', () => openNode(n.id)); li.append(b); return li; }));
  $('intro-context').hidden = !ownIntroduction();
  $('intro-context').textContent = nodes.length ? (state.node?.kind === 'part' ? '이 대분류의 도입문입니다. 개별 장 앞에 배치됩니다.' : '이 장의 도입문입니다. 첫 절 앞에 배치됩니다.') : (state.node?.kind === 'part' ? '이 대분류의 본문입니다.' : '이 장의 본문입니다.');
  $('structure-intro-message').textContent = '이 항목의 도입문이 없습니다.' + (nodes.length ? ' 아래 목차에서 하위 내용을 선택하세요.' : '');
}
function renderDocument(rec, node = null) {
  state.doc = rec; state.node = node || nodeForSection(rec.id) || null; renderNodeHeading(); renderNodeContext();
  $('edit-title').value = rec.title; $('empty-document').hidden = true; $('body-editor').hidden = false; $('structure-intro').hidden = true; $('status-badge').hidden = false;
  $('original-basis').textContent = rec.is_new_in_sixth ? `${state.labels.original}에 없는 신설 항목` : rec.original_available === false ? '원문 자료 없음' : '읽기 전용';
  $('source-warning').hidden = !rec.availability_note; $('source-warning').textContent = rec.availability_note || '';
  $('status-badge').textContent = names[rec.status]; $('status-badge').className = 'badge ' + rec.status;
  fields.forEach(f => { $(f).innerHTML = clean(rec[f] || ''); });
  AssetPicker.refreshDocument?.(rec);
  if (rec.is_new_in_sixth && !rec.original) $('original').textContent = `${state.labels.original}에는 없는 항목입니다.`;
  else if (rec.original_available === false && !rec.original) $('original').textContent = '제공된 원문 자료에 이 항목의 전체 원문이 없습니다.';
  $('edit-status').value = rec.status;
  $('source-note').textContent = rec.status === 'missing' ? `${state.labels.original} 자료는 있으나 대응하는 ${state.labels.revised} 자료가 없습니다. 변경 없음으로 확정하지 않습니다.` : rec.source_note || `${state.labels.original}과(와) ${state.labels.revised}을(를) 비교한 자료입니다. 이 사이트에서 저장한 수정은 별도의 편집본입니다.`;
  $('source-links').replaceChildren();
  $('document').hidden = false; $('loading').hidden = true; updateMode(); renderOutline(); scheduleTracking(0);
}
function renderStructure(node) {
  state.node = node; state.doc = null; clearTimeout(trackingTimer); trackingRequest++; trackingController?.abort();
  $('empty-document').hidden = true; $('body-editor').hidden = true; $('structure-intro').hidden = false; $('status-badge').hidden = true;
  renderNodeHeading(); renderNodeContext(); $('document').hidden = false; $('loading').hidden = true; updateMode(); renderOutline();
}
async function openNode(id, { initial = false, push = true } = {}) {
  const node = outlineNodes().find(i => i.id === id); if (!node) return false;
  if (!initial && !mayLeave()) return false;
  const req = ++state.request; state.loading = true; updateMode(); error('');
  try {
    const rec = node.body_section_id ? await api('sections/' + node.body_section_id) : null; if (req !== state.request) return false;
    state.loading = false; state.dirty = false; ancestors(node).forEach(p => state.expanded.set(p.id, true));
    if (rec) renderDocument(rec, node); else renderStructure(node);
    setNodeURL(node, { push });
    if (!initial && compactLayout.matches) setOutline(false);
    if (!initial) { $('title').focus({ preventScroll: true }); $('main').scrollIntoView({ block: 'start' }); }
    return true;
  } catch (e) { if (req === state.request) { state.loading = false; updateMode(); error(e.message); $('loading').hidden = true; } return false; }
}
const openSection = (id, o) => { const n = nodeForSection(id); return n ? openNode(n.id, o) : false; };
function handleAuthError(e) { if (e.status === 401) { state.authenticated = false; updateSession(); requireLogin(); } }
async function createIntroduction() {
  if (!ownIntroduction() || state.doc || state.loading || state.saving || !requireLogin() || !mayLeave()) return;
  const node = state.node; state.saving = true; updateMode(); error('');
  try {
    const rec = await api('outline/' + node.id + '/body', { method: 'POST', body: '{}' }); state.saving = false; state.dirty = false; state.editing = true;
    renderDocument(rec, { ...node, body_section_id: rec.id }); setNodeURL(state.node);
    try { await refreshIndex(); } catch { toast('도입문은 생성됐습니다. 목차를 갱신하려면 새로고침해 주세요.'); }
    toast('도입문을 편집할 수 있습니다. 내용을 입력하고 저장해 주세요.'); $('revised').focus();
  } catch (e) { handleAuthError(e); error(e.message); } finally { state.saving = false; updateMode(); }
}
async function save() {
  if (!state.doc || !state.dirty || state.saving) return;
  if (!state.authenticated) { requireLogin(); return; }
  const id = state.doc.id, payload = { version: state.doc.version, title: ownIntroduction() ? state.doc.title : $('edit-title').value, status: $('edit-status').value, original: state.doc.original };
  ['revised', 'reason'].forEach(f => payload[f] = $(f).innerHTML);
  state.saving = true; updateMode(); error('');
  try {
    const result = await api('sections/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    state.dirty = false; state.saving = false; renderDocument(result); toast('변경 내용을 저장했습니다.');
    try { await refreshIndex(); } catch { toast('저장은 완료됐습니다. 목차를 갱신하려면 새로고침해 주세요.'); }
  } catch (e) {
    state.saving = false; handleAuthError(e); error(e.message); updateMode();
    $('save-state').className = 'save-state failed'; $('save-state').textContent = e.status === 409 ? '저장 충돌 · 수정 내용 유지됨' : '저장되지 않음 · 다시 시도';
  }
}

/* ---------- 저장 이력 ---------- */
async function historyDialog() {
  if (!state.doc) return;
  const id = state.doc.id, req = ++state.historyRequest; state.historyId = id; state.revision = null;
  $('revision-preview').hidden = true; $('history-list').replaceChildren(el('p', '', '이력을 불러오고 있습니다…')); $('history-dialog').showModal();
  try {
    const r = await api('sections/' + id + '/history'); if (req !== state.historyRequest) return;
    $('history-list').replaceChildren(...r.history.map(item => {
      const b = el('button', '', `v${item.version} · ${item.note}`); b.type = 'button'; b.append(el('small', '', stamp(item.saved_at)));
      b.addEventListener('click', async () => {
        const rr = ++state.revisionRequest;
        try {
          const rev = await api('sections/' + id + '/revision/' + item.version); if (state.historyId !== id || rr !== state.revisionRequest) return;
          state.revision = rev; $('revision-label').textContent = rev.record.title + ' · 버전 ' + item.version + ' · ' + stamp(rev.saved_at);
          fields.forEach(f => $('revision-' + f).innerHTML = clean(rev.record[f] || '')); $('revision-preview').hidden = false;
          $('restore').disabled = !state.authenticated || item.version === state.doc.version; $('restore').textContent = !state.authenticated ? '복원하려면 편집 로그인' : '이 버전으로 복원';
          for (const x of $('history-list').querySelectorAll('button')) x.classList.toggle('active', x === b);
        } catch (e) { toast(e.message); }
      });
      return b;
    }));
  } catch (e) { $('history-list').replaceChildren(el('p', 'error', e.message)); }
}
async function restore() {
  if (!state.revision || !state.authenticated || state.saving) return;
  const id = state.historyId; if (id !== state.doc.id) return;
  if (!confirm('선택한 버전으로 복원할까요? 현재 화면의 미저장 수정은 사라지고, 저장된 이력은 남습니다.')) return;
  state.saving = true; updateMode(); $('restore').disabled = true;
  try {
    const rec = await api('sections/' + id + '/restore', { method: 'POST', body: JSON.stringify({ version: state.doc.version, target_version: state.revision.version }) });
    state.saving = false; state.dirty = false; renderDocument(rec); $('history-dialog').close(); toast('선택한 버전을 새 이력으로 복원했습니다.'); await refreshIndex();
  } catch (e) { state.saving = false; updateMode(); $('restore').disabled = false; toast(e.message); }
}

/* ---------- 로그인 / 항목 생성·삭제 ---------- */
function requireLogin() {
  if (state.authenticated) return true;
  api('session').then(s => { $('login-hint').textContent = s.configured ? '편집 비밀번호를 입력하세요. (정적 사이트의 브라우저 내 편집 잠금이며, 서버 보안은 아닙니다.)' : '처음 사용합니다. 입력한 값이 새 편집 비밀번호로 설정됩니다. (정적 사이트의 브라우저 내 편집 잠금이며, 서버 보안은 아닙니다.)'; });
  $('login-error').hidden = true; $('login-dialog').showModal(); $('password').focus(); return false;
}
window.requireLogin = requireLogin;
function clearFilters() {
  $('search').value = ''; $('part').value = ''; state.filter = 'all';
  document.querySelectorAll('[data-filter]').forEach(b => { const a = b.dataset.filter === 'all'; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
}
function setNodeURL(node, { push = false } = {}) {
  const url = new URL(location.href); url.searchParams.delete('section'); url.searchParams.delete('node');
  if (node?.body_section_id) url.searchParams.set('section', node.body_section_id); else if (node?.id) url.searchParams.set('node', node.id);
  const v = { node: node?.id || null, section: node?.body_section_id || null };
  try { push ? history.pushState(v, '', url) : history.replaceState(v, '', url); } catch (e) { /* file:// 등에서는 무시 */ }
}
const setSectionURL = id => { const n = nodeForSection(id); setNodeURL(n || (id ? { body_section_id: id } : null)); };
function showEmpty() {
  state.node = null; state.doc = null; state.dirty = false; state.loading = false; $('document').hidden = true; $('loading').hidden = true; $('empty-document').hidden = false;
  document.title = state.index?.title || '마크다운 비교 편집기'; setSectionURL(null); updateMode(); renderOutline();
}
function newChapters() {
  const ch = state.index.catalog.filter(c => c.part === $('new-part').value);
  $('new-chapter').replaceChildren(...ch.map(c => new Option(c.chapter || '상위 목차 없음', c.chapter)));
}
function createDialog() {
  if (!requireLogin() || !mayLeave()) return;
  if (!state.index.catalog.length) { toast('먼저 문서를 가져와 주세요.'); return; }
  $('new-part').replaceChildren(...Array.from(new Set(state.index.catalog.map(c => c.part))).map(p => new Option(p, p)));
  $('new-part').value = $('part').value || state.node?.part || state.doc?.part || $('new-part').options[0].value; newChapters();
  if (state.node?.part === $('new-part').value && state.node.chapter) $('new-chapter').value = state.node.chapter;
  $('new-title').value = ''; $('create-error').hidden = true; $('create-dialog').showModal(); $('new-title').focus();
}
async function createItem(e) {
  e.preventDefault(); if (state.saving) return; state.saving = true; updateMode(); $('create-submit').disabled = true; $('create-error').hidden = true;
  try {
    const rec = await api('sections', { method: 'POST', body: JSON.stringify({ part: $('new-part').value, chapter: $('new-chapter').value, title: $('new-title').value }) });
    state.saving = false; state.dirty = false; state.editing = true; clearFilters(); await refreshIndex(); renderDocument(rec); setSectionURL(rec.id); $('create-dialog').close();
    toast('새 항목을 생성했습니다. 내용을 입력하고 저장해 주세요.'); $('revised').focus();
  } catch (er) { $('create-error').textContent = er.message; $('create-error').hidden = false; } finally { state.saving = false; updateMode(); $('create-submit').disabled = false; }
}
async function deleteItem() {
  if (!state.doc || state.saving || state.loading || !requireLogin()) return;
  const item = state.doc, parent = ownIntroduction() ? state.node : null;
  const q = parent ? `‘${parent.title}’의 도입문을 삭제할까요? 상위 목차와 하위 항목은 유지되며 도입문은 ‘삭제한 항목’에서 복원할 수 있습니다.` : `‘${item.title}’ 항목을 삭제할까요? 목차와 내보내기에서 제외되며 ‘삭제한 항목’에서 복원할 수 있습니다.`;
  if (!confirm(q + (state.dirty ? ' 저장하지 않은 수정은 사라집니다.' : ''))) return;
  state.saving = true; updateMode(); error('');
  try {
    await api('sections/' + item.id + '/delete', { method: 'POST', body: JSON.stringify({ version: item.version }) });
    state.saving = false; state.dirty = false; showEmpty(); await refreshIndex();
    const next = parent && outlineNodes().find(n => n.id === parent.id) || state.visible[0] || outlineNodes()[0]; if (next) await openNode(next.id, { initial: true, push: false });
    toast(parent ? '도입문을 삭제했습니다. 상위 목차와 하위 항목은 유지됩니다.' : '항목을 삭제했습니다. 삭제한 항목에서 복원할 수 있습니다.');
  } catch (e) { handleAuthError(e); error(e.message); } finally { state.saving = false; updateMode(); }
}
async function trashDialog() {
  if (!requireLogin()) return;
  $('trash-list').replaceChildren(el('p', '', '불러오는 중…')); $('trash-dialog').showModal();
  try {
    const r = await api('trash');
    $('trash-list').replaceChildren(...r.sections.map(item => {
      const row = el('div', 'library-file-row'), info = el('div'), b = el('button', 'secondary', '복원');
      info.append(el('strong', '', item.title), el('br'), el('small', 'muted', [item.part, item.chapter].filter(Boolean).join(' / '))); row.append(info, b);
      b.addEventListener('click', async () => {
        if (!mayLeave()) return; state.saving = true; updateMode(); b.disabled = true;
        try {
          const rec = await api('sections/' + item.id + '/restore', { method: 'POST', body: JSON.stringify({ version: item.version, target_version: item.version - 1 }) });
          state.saving = false; state.dirty = false; clearFilters(); await refreshIndex(); renderDocument(rec); setSectionURL(rec.id); $('trash-dialog').close(); toast('삭제한 항목을 복원했습니다.');
        } catch (e) { toast(e.message); } finally { state.saving = false; updateMode(); b.disabled = false; }
      });
      return row;
    }));
    if (!r.sections.length) $('trash-list').append(el('p', 'muted', '삭제한 항목이 없습니다.'));
  } catch (e) { $('trash-list').replaceChildren(el('p', 'error', e.message)); }
}

/* ---------- 내보내기 / 가져오기 / 설정 ---------- */
function saveFile(name, content, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fname = async ext => (await Store.data.title()).replace(/[\\/:*?"<>|]/g, '_') + ext;
const loadScript = src => new Promise((res, rej) => { if (window.XLSX) return res(); const s = el('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('엑셀 라이브러리를 불러오지 못했습니다.')); document.head.append(s); });
async function downloadXlsx() {
  if (state.dirty && !confirm('저장하지 않은 수정은 파일에 포함되지 않습니다. 저장된 내용만 내보낼까요?')) return;
  if (state.saving) { toast('저장이 끝난 뒤 내려받아 주세요.'); return; }
  $('download').disabled = true;
  try {
    const rows = await Store.data.rows(), L = state.labels;
    const head = ['ID', '파트', '장', '제목', '상태', L.original, L.revised, '검토 메모', '추가', '삭제', '수정', '버전'];
    const data = rows.map(({ r, track }) => [r.id, r.part, r.chapter, r.title, names[r.status], Store.textOf(r.original), Store.textOf(r.revised), Store.textOf(r.reason), track.counts.added, track.counts.removed, track.counts.modified, r.version]);
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([head, ...data]); ws['!cols'] = [8, 14, 18, 28, 10, 60, 60, 30, 6, 6, 6, 6].map(wch => ({ wch })); XLSX.utils.book_append_sheet(wb, ws, '전체 비교');
      XLSX.writeFile(wb, await fname('_전체본문_변경추적.xlsx'));
    } catch (e) {
      const csv = [head, ...data].map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
      saveFile(await fname('_전체본문_변경추적.csv'), '﻿' + csv, 'text/csv;charset=utf-8'); toast('엑셀 라이브러리를 불러오지 못해 CSV로 저장했습니다.');
    }
    toast('저장된 전체 비교표를 내려받았습니다.');
  } catch (e) { error(e.message); } finally { $('download').disabled = false; }
}
async function downloadJson() { saveFile(await fname('_백업.json'), await Store.data.exportJson(), 'application/json'); toast('JSON 백업을 내려받았습니다.'); }
const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });
async function doImport(e) {
  e.preventDefault(); const err = m => { $('import-error').textContent = m; $('import-error').hidden = false; }; $('import-error').hidden = true;
  const o = $('import-orig').files[0], r = $('import-rev').files[0], j = $('import-json').files[0];
  if (!o && !j) return err('원문 마크다운 또는 백업 JSON 파일을 선택해 주세요.');
  if (state.dirty && !mayLeave()) return;
  if (state.index.sections.length && !confirm('현재 문서가 새 내용으로 교체됩니다. 계속할까요? (먼저 JSON 백업을 권장합니다)')) return;
  try {
    let msg;
    if (j) { await Store.data.importJson(JSON.parse(await readText(j))); msg = 'JSON 백업을 복원했습니다.'; }
    else { const res = await Store.data.importMarkdown(await readText(o), r ? await readText(r) : ''); msg = `${res.sections}개 항목을 가져왔습니다.` + (r ? ` (수정본 일치 ${res.matched}건)` : ''); }
    $('import-dialog').close(); $('import-form').reset(); clearFilters(); state.dirty = false; showEmpty(); await refreshIndex();
    const first = outlineNodes().find(n => n.body_section_id) || outlineNodes()[0]; if (first) await openNode(first.id, { initial: true, push: false }); else showEmpty(); toast(msg);
  } catch (er) { handleAuthError(er); err(er.message); }
}
const SAMPLE_O = `# 일반지침\n\n## 수혈용 혈액의 신청\n\n### 가. 응급수혈\n\n① 수혈이 늦어지면 심각한 결과가 초래될 수 있는 환자의 경우, 수혈 전 검사를 일부 혹은 전부 생략하고 긴급하게 수혈을 해야 할 경우가 있다.[1]\n\n1) ABO 혈액형이 확인된 경우에는 ABO 동형의 농축적혈구를 수혈한다.\n2) ABO 혈액형이 확인되지 않은 경우에는 농축적혈구는 O형, 혈장은 AB형 제제를 수혈한다.\n\n### 나. 설명 및 동의\n\n수혈 전 환자에게 수혈의 필요성과 위험을 설명하고 동의를 받는다.\n\n| 구분 | 내용 |\n|---|---|\n| 동의서 | 서면 |\n| 응급 | 사후 설명 |\n`;
const SAMPLE_R = `# 일반지침\n\n## 수혈용 혈액의 신청\n\n### 가. 응급수혈\n\n응급·대량수혈 표준업무안내서를 참고한다.[40]\n\n① 수혈이 늦어지면 심각한 결과가 초래될 수 있는 환자의 경우, 수혈 전 검사를 일부 혹은 전부 생략하고 긴급하게 수혈을 해야 할 경우가 있다. 응급수혈이 필요하더라도 수혈을 지연하지 않는 범위에서 가능한 한 수혈 전 검체를 확보한다.\n\n1) ABO 혈액형이 확인된 경우에는 ABO 동형의 농축적혈구를 수혈한다.\n2) ABO 혈액형이 확인되지 않은 경우에는 농축적혈구는 O형, 혈장은 AB형 제제를 수혈한다.\n\n### 나. 설명 및 동의\n\n수혈 전 환자에게 수혈의 필요성과 위험을 설명하고 동의를 받는다.\n\n| 구분 | 내용 |\n|---|---|\n| 동의서 | 서면 |\n| 응급 | 사후 설명 |\n`;
async function loadSample() {
  if (state.index.sections.length && !confirm('현재 문서가 샘플로 교체됩니다. 계속할까요?')) return;
  try { const refs = { original: [{ number: 1, text: '대한수혈학회. 수혈가이드라인 제5판. 2020.' }], revised: Array.from({ length: 40 }, (_, i) => ({ number: i + 1, text: i === 39 ? '질병관리청. 응급·대량수혈 표준업무안내서. 2024.' : '(예시 참고문헌 ' + (i + 1) + ')' })) }; await Store.data.importMarkdown(SAMPLE_O, SAMPLE_R, refs);
    clearFilters(); await refreshIndex(); const first = outlineNodes().find(n => n.body_section_id); if (first) await openNode(first.id, { initial: true, push: false }); }
  catch (e) { handleAuthError(e); toast(e.message); }
}
async function settingsDialog() {
  if (!requireLogin()) return;
  const s = await Store.settings.get(), lines = list => list.map(r => r.text).join('\n');
  $('set-title').value = s.title; $('set-lab-o').value = s.labels.original; $('set-lab-r').value = s.labels.revised;
  $('set-ref-o').value = lines(s.refs.original); $('set-ref-r').value = lines(s.refs.revised);
  $('gh-repo').value = s.gh.repo || ''; $('gh-branch').value = s.gh.branch || 'main'; $('gh-path').value = s.gh.path || 'data/document.json'; $('gh-token').value = s.gh.token || '';
  $('settings-msg').hidden = true; $('settings-dialog').showModal();
}
const parseRefs = t => t.split(/\r?\n/).map(l => l.replace(/^\s*[\[(]?\d+[\])\.]\s*/, '').trim()).filter(Boolean).map((text, i) => ({ number: i + 1, text }));
async function saveSettings() {
  const msg = (t, bad) => { $('settings-msg').textContent = t; $('settings-msg').className = bad ? 'error' : 'notice'; $('settings-msg').hidden = false; };
  try {
    await Store.settings.set({ title: $('set-title').value.trim(), labels: { original: $('set-lab-o').value.trim() || '원문', revised: $('set-lab-r').value.trim() || '수정 초안' },
      refs: { original: parseRefs($('set-ref-o').value), revised: parseRefs($('set-ref-r').value) }, gh: { repo: $('gh-repo').value.trim(), branch: $('gh-branch').value.trim() || 'main', path: $('gh-path').value.trim() || 'data/document.json', token: $('gh-token').value.trim() } });
    document.dispatchEvent(new CustomEvent('reference-catalog-updated', { detail: await api('references') })); await refreshIndex(); if (state.doc) renderDocument(state.doc); msg('설정을 저장했습니다.'); return true;
  } catch (e) { handleAuthError(e); msg(e.message, true); return false; }
}

/* ---------- 변경추적 ---------- */
let trackingTimer, trackingRequest = 0, trackingController;
function scheduleTracking(delay = 450) {
  clearTimeout(trackingTimer); const ticket = ++trackingRequest; trackingController?.abort(); $('tracking-state').textContent = '비교 중…';
  trackingTimer = setTimeout(async () => {
    if (!state.doc) return; const id = state.doc.id; trackingController = new AbortController();
    try {
      const opt = state.dirty && state.authenticated ? { method: 'POST', body: JSON.stringify({ revised: $('revised').innerHTML }) } : {};
      const r = await api('sections/' + id + '/track', { ...opt, signal: trackingController.signal });
      if (ticket !== trackingRequest || id !== state.doc?.id) return;
      $('tracking').innerHTML = r.html; const c = r.counts;
      $('tracking-state').textContent = !r.available ? '비교 자료 없음' : r.changed ? `추가 ${c.added} · 삭제 ${c.removed} · 수정 ${c.modified}` : '변경 없음';
    } catch (e) { if (e.name === 'AbortError' || ticket !== trackingRequest) return; $('tracking-state').textContent = '비교 실패'; $('tracking').textContent = e.message; }
  }, delay);
}
document.querySelectorAll('[data-pane]').forEach(b => b.addEventListener('click', () => {
  $('document-panes').dataset.view = b.dataset.pane;
  document.querySelectorAll('[data-pane]').forEach(x => { const a = x === b; x.classList.toggle('active', a); x.setAttribute('aria-pressed', String(a)); });
}));
$('changes-only').addEventListener('change', () => $('tracking').classList.toggle('changes-only', $('changes-only').checked));

/* ---------- 참고문헌 / 표·그림 / 서식 ---------- */
const editCtx = () => ({ authenticated: state.authenticated, id: state.doc?.id, version: state.doc?.version, dirty: state.dirty, editable: !!state.doc && state.authenticated && state.editing && !state.saving && !state.loading });
ReferenceTools.initHover({ fields: ['original', 'revised', 'tracking', 'reason'], api });
ReferenceTools.init({ fields: ['revised', 'reason'], api, toast, onInserted: markDirty, getContext: editCtx });
AssetPicker.init({ api, toast, onInserted: markDirty, getContext: editCtx });
const formatBar = document.querySelector('.format-tools'); let bookmark = null;
function selectedFormatRange() {
  const s = getSelection(); if (!state.doc || !state.editing || !state.authenticated || state.loading || state.saving || !s?.rangeCount) return null;
  const r = s.getRangeAt(0), f = ['revised', 'reason'].find(id => $(id).contentEditable === 'true' && $(id).contains(r.startContainer) && $(id).contains(r.endContainer));
  return f ? { field: f, range: r.cloneRange(), id: state.doc.id, version: state.doc.version } : null;
}
const validBookmark = v => !!v && state.editing && state.authenticated && !state.loading && !state.saving && state.doc?.id === v.id && state.doc.version === v.version && $(v.field).contentEditable === 'true' && $(v.field).contains(v.range.startContainer) && $(v.field).contains(v.range.endContainer);
function updateFormatButtons() { const sel = selectedFormatRange(); for (const b of formatBar.querySelectorAll('[data-command]')) { if (b.dataset.command === 'removeFormat') continue; b.setAttribute('aria-pressed', String(!!sel && document.queryCommandState(b.dataset.command))); } }
document.addEventListener('selectionchange', () => { const s = selectedFormatRange(); if (s) bookmark = s; else if (!formatBar.contains(document.activeElement)) bookmark = null; updateFormatButtons(); });
for (const b of formatBar.querySelectorAll('[data-command]')) {
  b.type = 'button';
  b.addEventListener('mousedown', e => { const s = selectedFormatRange(); if (s) bookmark = s; e.preventDefault(); });
  b.addEventListener('click', () => {
    const t = selectedFormatRange() || (formatBar.contains(document.activeElement) && validBookmark(bookmark) ? bookmark : null);
    if (!validBookmark(t)) { toast('수정 초안이나 검토 메모에서 편집할 글자나 칸을 먼저 선택해 주세요.'); return; }
    const field = $(t.field), before = field.innerHTML; field.focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); s.addRange(t.range.cloneRange());
    document.execCommand('styleWithCSS', false, false);
    if (!document.execCommand(b.dataset.command, false)) { toast('서식을 적용하지 못했습니다. 편집할 글자를 다시 선택해 주세요.'); return; }
    if (field.innerHTML !== before) markDirty(t.field); bookmark = selectedFormatRange(); updateFormatButtons();
  });
}

/* ---------- 이벤트 ---------- */
const topbar = document.querySelector('.topbar'); let hf;
function syncHeader() { cancelAnimationFrame(hf); hf = requestAnimationFrame(() => { const h = Math.ceil(topbar.getBoundingClientRect().height) + 'px'; if (document.documentElement.style.getPropertyValue('--header-height') !== h) document.documentElement.style.setProperty('--header-height', h); }); }
if (window.ResizeObserver) new ResizeObserver(syncHeader).observe(topbar); else addEventListener('resize', syncHeader); syncHeader();
const compactLayout = matchMedia('(max-width: 1000px)');
function setOutline(open) { document.body.classList.toggle('outline-closed', !open); $('toggle-outline').setAttribute('aria-expanded', String(open)); }
setOutline(!compactLayout.matches); compactLayout.addEventListener('change', e => setOutline(!e.matches));
$('toggle-outline').addEventListener('click', () => setOutline(document.body.classList.contains('outline-closed')));
fields.forEach(f => {
  $(f).addEventListener('input', () => markDirty(f));
  $(f).addEventListener('paste', e => { if (!state.editing || f === 'original') return; e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); markDirty(f); });
  $(f).addEventListener('drop', e => e.preventDefault());
});
$('edit-status').addEventListener('change', () => markDirty('status'));
$('edit-title').addEventListener('input', () => { markDirty('title'); $('title').textContent = $('edit-title').value; $('location').textContent = $('edit-title').value; });
$('create-item').addEventListener('click', createDialog); $('create-intro').addEventListener('click', createIntroduction); $('create-form').addEventListener('submit', createItem); $('new-part').addEventListener('change', newChapters);
$('delete-item').addEventListener('click', deleteItem); $('trash-button').addEventListener('click', trashDialog);
$('search').addEventListener('input', renderOutline); $('part').addEventListener('change', renderOutline);
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); renderOutline(); }));
$('collapse').addEventListener('click', () => { const open = !$('outline').querySelector('.outline-toggle[aria-expanded="true"]'); state.visible.filter(n => childrenOf(n).length).forEach(n => state.expanded.set(n.id, open)); renderOutline(); });
$('view-mode').addEventListener('click', () => { state.editing = false; updateMode(); });
$('edit-mode').addEventListener('click', () => { if (!requireLogin()) return; state.editing = true; updateMode(); });
$('save').addEventListener('click', save); $('history-button').addEventListener('click', historyDialog); $('restore').addEventListener('click', restore);
$('download').addEventListener('click', downloadXlsx); $('backup').addEventListener('click', () => $('export-dialog').showModal()); $('backup2').addEventListener('click', downloadJson);
$('x-json').addEventListener('click', downloadJson); $('x-xlsx').addEventListener('click', downloadXlsx);
$('x-md-rev').addEventListener('click', async () => saveFile(await fname('_수정본.md'), await Store.data.exportMarkdown('revised'), 'text/markdown;charset=utf-8'));
$('x-md-orig').addEventListener('click', async () => saveFile(await fname('_원문.md'), await Store.data.exportMarkdown('original'), 'text/markdown;charset=utf-8'));
$('import-open').addEventListener('click', () => { $('import-error').hidden = true; $('import-dialog').showModal(); }); $('import-open2').addEventListener('click', () => $('import-open').click());
$('import-form').addEventListener('submit', doImport); $('sample').addEventListener('click', loadSample);
$('settings-open').addEventListener('click', settingsDialog); $('set-save').addEventListener('click', saveSettings);
$('set-pw-save').addEventListener('click', async () => { const p = $('set-pw').value; if (!p) return; try { await Store.settings.changePassword(p); $('set-pw').value = ''; toast('비밀번호를 변경했습니다.'); } catch (e) { toast(e.message); } });
$('gh-pull').addEventListener('click', async () => { if (!await saveSettings()) return; if (!confirm('저장소의 문서로 현재 문서를 교체할까요?')) return; try { await Store.gh.pull(); $('settings-dialog').close(); clearFilters(); showEmpty(); await refreshIndex(); const f = outlineNodes().find(n => n.body_section_id); if (f) await openNode(f.id, { initial: true, push: false }); toast('GitHub에서 불러왔습니다.'); } catch (e) { toast(e.message); } });
$('gh-push').addEventListener('click', async () => { if (!await saveSettings()) return; try { await Store.gh.push(); toast('GitHub에 커밋했습니다.'); } catch (e) { toast(e.message); } });
$('account').addEventListener('click', async () => {
  if (!state.authenticated) { requireLogin(); return; }
  if (!mayLeave()) return;
  if (sectionComments.pending() && !confirm('등록하지 않은 코멘트가 있습니다. 로그아웃할까요?')) return;
  try { await api('logout', { method: 'POST', body: '{}' }); location.reload(); } catch (e) { error(e.message); }
});
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('login-submit').disabled = true; $('login-error').hidden = true;
  try { await api('login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; state.authenticated = true; state.editing = true; updateSession(); $('login-dialog').close(); toast('편집할 수 있습니다.'); }
  catch (er) { $('login-error').textContent = er.message; $('login-error').hidden = false; } finally { $('login-submit').disabled = false; }
});
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!state.saving) $(b.dataset.close).close(); }));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => { if (state.saving) e.preventDefault(); }));
for (const [id, step] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => { const i = state.visible.findIndex(x => x.id === state.node?.id), n = state.visible[i + step]; if (i >= 0 && n) openNode(n.id); });
addEventListener('beforeunload', e => { if (state.dirty || state.saving || sectionComments.pending()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!document.querySelector('dialog[open]')) save(); } });
function requestedNode() { const p = new URL(location.href).searchParams; return outlineNodes().find(n => n.id === p.get('node')) || nodeForSection(p.get('section')) || outlineNodes().find(n => n.body_section_id) || outlineNodes()[0]; }
addEventListener('popstate', async () => { if (!state.index) return; const n = requestedNode(); if (!n) { if (mayLeave()) showEmpty(); else setNodeURL(state.node); return; } if (!await openNode(n.id, { push: false })) setNodeURL(state.node); });
(async () => {
  try {
    await Store.ready; const [, session] = await Promise.all([refreshIndex(), api('session')]); state.authenticated = session.authenticated; updateSession();
    const n = requestedNode(); if (n) await openNode(n.id, { initial: true, push: false }); else showEmpty();
  } catch (e) { $('loading').hidden = true; error(e.message); }
})();

