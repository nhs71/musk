/* 자료실: 공유 파일 보관(브라우저 IndexedDB) + GitHub 저장소 files/ 폴더 업로드 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id), dialog = byId('library-dialog');
  let uploading = false;
  const size = b => b < 1000 ? `${b} B` : b < 1e6 ? `${(b / 1000).toFixed(1)} KB` : `${(b / 1e6).toFixed(1)} MB`;
  const message = (t = '') => { byId('library-error').textContent = t; byId('library-error').hidden = !t; };
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  async function refresh() {
    byId('library-refresh').disabled = true;
    try {
      const files = await Store.files.list(); byId('library-count').textContent = `${files.length}개`;
      const rows = files.map(f => {
        const row = el('article', '', 'library-file-row'), info = el('div', '', 'library-file-info'), acts = el('div', '', 'library-file-actions');
        info.append(el('h4', f.name)); if (f.description) info.append(el('p', f.description, 'library-file-description'));
        info.append(el('small', `${size(f.size)} · ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(f.uploaded_at))}`));
        const dl = el('button', '다운로드', 'text-button'); dl.type = 'button';
        dl.addEventListener('click', async () => { const blob = await Store.files.blob(f.id); if (!blob) return message('파일을 찾을 수 없습니다.'); const a = el('a'); a.href = URL.createObjectURL(blob); a.download = f.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
        const gh = el('button', 'GitHub에 올리기', 'text-button'); gh.type = 'button';
        gh.addEventListener('click', async () => { gh.disabled = true; message(); try { await Store.gh.upload(new File([await Store.files.blob(f.id)], f.name)); gh.textContent = '올림'; } catch (e) { message(e.message); gh.disabled = false; } });
        const rm = el('button', '삭제', 'text-button'); rm.type = 'button';
        rm.addEventListener('click', async () => { if (!confirm(`‘${f.name}’ 파일을 자료실에서 삭제할까요?`)) return; try { await Store.files.remove(f.id); await refresh(); } catch (e) { message(e.message); } });
        acts.append(dl, gh, rm); row.append(info, acts); return row;
      });
      byId('library-list').replaceChildren(...(rows.length ? rows : [el('p', '아직 공유한 파일이 없습니다. 위에서 첫 파일을 올려 주세요.', 'muted')]));
    } finally { byId('library-refresh').disabled = false; }
  }
  byId('library-open').addEventListener('click', async () => {
    if (!Store.authed()) { window.requireLogin && window.requireLogin(); return; }
    dialog.showModal(); message(); try { await refresh(); } catch (e) { message(e.message); }
  });
  byId('library-close').addEventListener('click', () => { if (!uploading) dialog.close(); });
  byId('library-refresh').addEventListener('click', async () => { message(); try { await refresh(); } catch (e) { message(e.message); } });
  byId('library-form').addEventListener('submit', async e => {
    e.preventDefault(); if (uploading) return; const f = byId('library-file').files[0]; message();
    uploading = true; for (const id of ['library-submit', 'library-file', 'library-description', 'library-close']) byId(id).disabled = true; byId('library-progress').textContent = '저장 중…';
    try { await Store.files.add(f, byId('library-description').value); byId('library-form').reset(); byId('library-progress').textContent = '파일을 올렸습니다.'; await refresh(); }
    catch (er) { message(er.message); byId('library-progress').textContent = ''; }
    finally { uploading = false; for (const id of ['library-submit', 'library-file', 'library-description', 'library-close']) byId(id).disabled = false; }
  });
})();
