'use strict';
/* 섹션 코멘트: 로그인 후 열람·작성, 미등록 초안은 섹션별로 보관한다. */
window.SectionComments = {
  init({ api, toast }) {
    const $ = id => document.getElementById(id), drafts = new Map();
    let section = null, authenticated = false, loading = false, busy = false, token = 0, rows = [];
    const node = (tag, text, cls) => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
    const draft = () => drafts.get(section) || { author: '', body: '', id: null };
    const failure = m => { $('comment-error').textContent = m; $('comment-error').hidden = !m; };
    function controls() {
      $('comment-form').hidden = !authenticated; $('comment-login-hint').hidden = authenticated;
      $('comment-submit').disabled = !section || !authenticated || busy || loading || !$('comment-body').value.trim();
      $('comment-submit').textContent = busy ? '처리 중…' : '코멘트 등록';
      $('comment-body').disabled = busy; $('comment-author').disabled = busy;
      $('comments-refresh').disabled = !authenticated || !section || loading || busy;
      $('comment-length').textContent = `${$('comment-body').value.length.toLocaleString()} / 5,000`;
      $('comment-list').querySelectorAll('button').forEach(b => b.disabled = busy);
    }
    function render() {
      $('comment-count').textContent = authenticated && !loading ? `${rows.length}개` : '';
      const list = $('comment-list'); list.replaceChildren();
      if (!authenticated) { controls(); return; }
      if (loading) { list.append(node('li', '코멘트를 불러오고 있습니다.', 'comment-empty')); controls(); return; }
      if (!rows.length) list.append(node('li', '아직 코멘트가 없습니다. 이 섹션의 검토 의견을 남겨 주세요.', 'comment-empty'));
      for (const row of rows) {
        const li = document.createElement('li'), head = document.createElement('header'), time = document.createElement('time');
        time.textContent = new Date(row.created_at).toLocaleString('ko-KR');
        const rm = node('button', '삭제', 'text-button'); rm.type = 'button'; rm.addEventListener('click', () => remove(row));
        head.append(node('strong', row.author), time, rm); li.append(head, node('p', row.body, 'comment-body')); list.append(li);
      }
      controls();
    }
    async function load() {
      const id = section, t = ++token;
      if (!id || !authenticated) { loading = false; rows = []; render(); return; }
      loading = true; failure(''); render();
      try { const r = await api(`sections/${id}/comments`); if (t === token) rows = r.comments; }
      catch (e) { if (t === token) failure(e.message); }
      finally { if (t === token) { loading = false; render(); } }
    }
    function activate(id, loggedIn) {
      const changed = id !== section || loggedIn !== authenticated; section = id; authenticated = loggedIn;
      if (changed) { rows = []; const v = draft(); $('comment-author').value = v.author; $('comment-body').value = v.body; load(); }
      controls();
    }
    function remember() {
      const prev = draft(); drafts.set(section, { author: $('comment-author').value, body: $('comment-body').value, id: null });
      if (prev.body === $('comment-body').value && prev.author === $('comment-author').value) drafts.get(section).id = prev.id; controls();
    }
    async function submit(e) {
      e.preventDefault(); if (busy || loading || !authenticated || !section || !$('comment-body').value.trim()) return;
      remember(); const id = section, v = draft(); if (!v.id) v.id = Store.uid();
      busy = true; failure(''); controls();
      try {
        const saved = await api(`sections/${id}/comments`, { method: 'POST', body: JSON.stringify(v) }); drafts.delete(id);
        if (section === id) { $('comment-body').value = ''; drafts.set(id, { author: v.author, body: '', id: null }); rows = rows.filter(r => r.id !== saved.id); rows.push(saved); render(); }
        toast('코멘트를 등록했습니다.');
      } catch (er) { if (section === id) failure(er.message); } finally { busy = false; controls(); }
    }
    async function remove(row) {
      if (busy || !confirm('이 코멘트를 삭제할까요?')) return; const id = section; busy = true; failure(''); controls();
      try { await api(`sections/${id}/comments/${row.id}/delete`, { method: 'POST', body: '{}' }); if (section === id) { rows = rows.filter(r => r.id !== row.id); render(); } toast('코멘트를 삭제했습니다.'); }
      catch (er) { if (section === id) failure(er.message); } finally { busy = false; controls(); }
    }
    $('comment-form').addEventListener('submit', submit);
    $('comment-body').addEventListener('input', remember); $('comment-author').addEventListener('input', remember);
    $('comments-refresh').addEventListener('click', load);
    return { activate, busy: () => busy, pending: () => busy || [...drafts.values()].some(v => v.body.trim()) };
  }
};
