import { STATUS, STATUS_CYCLE } from './config.js?v=1789068452';
import { navigate, currentPath } from './router.js?v=1789068452';
import * as store from './store.js?v=1789068452';
import { saveEnabled, ensureToken, directSave } from './save.js?v=1789068452';

// --- helpers ---
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const todayISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const fmtDay = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const addMinutes = (t, d) => { const [h, m] = String(t).split(':').map(Number); const tot = h * 60 + (m || 0) + (Number(d) || 60); return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`; };
const nextStatus = (s) => STATUS_CYCLE[(STATUS_CYCLE.indexOf(s) + 1) % STATUS_CYCLE.length];

function chip(status) {
  const s = STATUS[status] || STATUS.N;
  return `<span class="chip ${s.cls}" title="${esc(s.label)}">${status}</span>`;
}

// Tier preference (F hides Higher-only topics). Persisted per device.
function tierPref(profile) {
  return localStorage.getItem('ess:tier') || profile?.tier || 'F';
}
function setTierPref(t) { localStorage.setItem('ess:tier', t); }

function header(title, sub) {
  return `<header class="topbar">
    <a class="brand" href="" data-link>Erin · Study Schedule</a>
    <nav class="topnav">
      <a href="calendar" data-link>Calendar</a>
    </nav>
  </header>
  <div class="page-head"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>`;
}

// --- Save bar (shown when there are unsaved changes) ---
function mountSaveBar(root, subjectId) {
  const existing = document.getElementById('savebar');
  if (existing) existing.remove();
  const n = store.changeCount();
  if (!n) return;
  const direct = saveEnabled();
  const bar = el(`<div id="savebar" class="savebar">
    <span><strong>${n}</strong> unsaved change${n === 1 ? '' : 's'}${direct ? '' : ' — export the file and commit it to save'}.</span>
    <span class="savebar-actions">
      <button class="btn ghost" data-act="discard">Discard</button>
      <button class="btn primary" data-act="save">${direct ? 'Save' : 'Update file'}</button>
    </span>
  </div>`);
  bar.querySelector('[data-act="save"]').onclick = () => save();
  bar.querySelector('[data-act="discard"]').onclick = () => {
    if (confirm('Discard all unsaved changes on this device?')) { store.discardChanges(); navigate(currentPath()); }
  };
  document.body.appendChild(bar);
}

// --- Save: direct-to-repo via the Worker (Google sign-in), else export modal ---
function toast(msg, isError) {
  const t = el(`<div class="toast ${isError ? 'err' : ''}">${esc(msg)}</div>`);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function conflictModal() {
  const m = el(`<div class="modal-bg"><div class="modal">
    <h2>Couldn't merge automatically</h2>
    <p>The schedule changed on the server and we couldn't reconcile it. Export your changes if you want to keep them, then reload to get the latest.</p>
    <div class="modal-actions">
      <button class="btn ghost" data-x>Keep editing</button>
      <button class="btn" data-export>Export my changes</button>
      <button class="btn primary" data-reload>Reload latest</button>
    </div></div></div>`);
  m.querySelector('[data-x]').onclick = () => m.remove();
  m.querySelector('[data-export]').onclick = () => { m.remove(); openExport(); };
  m.querySelector('[data-reload]').onclick = () => location.reload();
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
}

// Present per-topic status clashes; resolves to a { key: 'ours'|'theirs' } map
// or null if cancelled. `savedBy` = who last saved the server version.
async function resolveConflicts(conflicts, savedBy) {
  const titles = {}, names = {};
  for (const c of conflicts) {
    if (c.subjectId in titles) continue;
    titles[c.subjectId] = {};
    try {
      const { content, meta } = await store.loadSubject(c.subjectId);
      names[c.subjectId] = meta.short || meta.name || c.subjectId;
      for (const st of content.strands) for (const s of st.subtopics) titles[c.subjectId][s.id] = s.title;
    } catch { names[c.subjectId] = c.subjectId; }
  }
  const who = savedBy ? ` (last saved by <strong>${esc(savedBy)}</strong>)` : '';
  const rows = conflicts.map((c) => {
    const title = titles[c.subjectId]?.[c.topicId] || c.topicId;
    return `<div class="rb-row" data-key="${esc(c.key)}">
      <div class="rb-title">${esc(title)} <span class="rb-sub">${esc(names[c.subjectId] || c.subjectId)}</span></div>
      <div class="rb-opts">
        <button class="rb-opt" data-choice="ours"><span class="who">Yours</span>${chip(c.ours)}</button>
        <button class="rb-opt" data-choice="theirs"><span class="who">Server</span>${chip(c.theirs)}</button>
      </div></div>`;
  }).join('');
  return new Promise((resolve) => {
    const res = {};
    const m = el(`<div class="modal-bg"><div class="modal">
      <h2>Resolve ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}</h2>
      <p class="muted">These were changed both here and on the server${who}. Pick which to keep — everything else merged automatically.</p>
      <div class="rb-list">${rows}</div>
      <div class="modal-actions">
        <button class="btn ghost" data-x>Cancel</button>
        <button class="btn ghost" data-allmine>Keep all mine</button>
        <button class="btn ghost" data-allserver>Keep all server</button>
        <button class="btn primary" data-apply disabled>Apply &amp; save</button>
      </div></div></div>`);
    const applyBtn = m.querySelector('[data-apply]');
    const refresh = () => { applyBtn.disabled = conflicts.some((c) => !res[c.key]); };
    const select = (row, choice) => {
      res[row.dataset.key] = choice;
      row.querySelectorAll('.rb-opt').forEach((o) => o.classList.toggle('sel', o.dataset.choice === choice));
    };
    m.querySelectorAll('.rb-row').forEach((row) => row.querySelectorAll('.rb-opt').forEach((o) => o.onclick = () => { select(row, o.dataset.choice); refresh(); }));
    m.querySelector('[data-allmine]').onclick = () => { m.querySelectorAll('.rb-row').forEach((r) => select(r, 'ours')); refresh(); };
    m.querySelector('[data-allserver]').onclick = () => { m.querySelectorAll('.rb-row').forEach((r) => select(r, 'theirs')); refresh(); };
    m.querySelector('[data-x]').onclick = () => { m.remove(); resolve(null); };
    applyBtn.onclick = () => { m.remove(); resolve(res); };
    document.body.appendChild(m);
  });
}

// Fetch the latest committed file and rebase our edits onto it. Returns true
// (ready to retry save), or false if the user cancelled conflict resolution.
async function reconcile() {
  const theirs = await store.fetchCommitted();
  const { conflicts } = store.rebase(theirs);
  let resolutions = {};
  if (conflicts.length) {
    resolutions = await resolveConflicts(conflicts, theirs.updatedBy);
    if (!resolutions) return false;
  }
  store.applyRebase(theirs, store.rebase(theirs, resolutions).subjects);
  return true;
}

async function save(attempt = 0, rebased = false) {
  if (!saveEnabled()) return openExport();
  const btn = document.querySelector('#savebar [data-act="save"], #update-btn');
  const prev = btn?.textContent;
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const idToken = await ensureToken();
    const { json } = store.exportState();
    await directSave(idToken, json, store.baseUpdatedAt());
    store.markSaved(JSON.parse(json));
    if (rebased) { navigate(currentPath()); } else { mountSaveBar(); if (btn && document.body.contains(btn)) { btn.textContent = prev; btn.disabled = false; } }
    toast('Saved ✓');
  } catch (e) {
    if (btn) { btn.textContent = prev; btn.disabled = false; }
    if (e.code === 'conflict' && attempt < 3) {
      let ok;
      try { ok = await reconcile(); } catch { toast('Could not merge — reload', true); return conflictModal(); }
      if (ok === false) return;              // cancelled
      return save(attempt + 1, true);        // retry with rebased content
    }
    if (e.code === 'conflict') return conflictModal();
    if (e.message === 'sign-in cancelled') return;
    if (e.code === 'forbidden') return toast(e.message, true);
    toast('Direct save failed — use manual export', true);
    openExport();
  }
}

function openExport() {
  const { json, path } = store.exportState();
  const modal = el(`<div class="modal-bg">
    <div class="modal">
      <h2>Update the schedule file</h2>
      <p>Save this as <code>${esc(path)}</code>, then commit &amp; push:</p>
      <pre class="cmd">git add ${esc(path)} &amp;&amp; git commit -m "Update revision status" &amp;&amp; git push</pre>
      <textarea readonly class="export-text">${esc(json)}</textarea>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close">Close</button>
        <button class="btn" data-act="copy">Copy to clipboard</button>
        <button class="btn primary" data-act="download">Download file</button>
      </div>
    </div></div>`);
  const close = () => modal.remove();
  modal.querySelector('[data-act="close"]').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  modal.querySelector('[data-act="copy"]').onclick = async (e) => {
    try { await navigator.clipboard.writeText(json); e.target.textContent = 'Copied ✓'; }
    catch { modal.querySelector('.export-text').select(); document.execCommand('copy'); e.target.textContent = 'Copied ✓'; }
  };
  modal.querySelector('[data-act="download"]').onclick = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'state.json'; a.click();
    URL.revokeObjectURL(a.href);
  };
  document.body.appendChild(modal);
}

// ===================== VIEWS =====================

export function renderLanding(root, { subjects, profile }) {
  document.getElementById('savebar')?.remove();
  const cards = subjects.map((s) => {
    const active = s.status === 'active';
    const tag = active ? '' : '<span class="soon">coming soon</span>';
    const inner = `<div class="subject-card" style="--accent:${esc(s.colour || '#2563eb')}">
        <h2>${esc(s.name)} ${tag}</h2>
        <p>${esc(s.board || '')}</p>
      </div>`;
    return active ? `<a href="${esc(s.id)}" data-link>${inner}</a>` : `<div class="disabled">${inner}</div>`;
  }).join('');
  root.innerHTML = `${header('Study Schedule', profile?.student ? `${profile.student}'s revision` : '')}
    <p class="lead">Pick a subject.</p>
    <div class="subject-grid">${cards}</div>
    <p class="merge-link"><a href="merge.html">Merge two people's downloaded status files →</a></p>`;
}

export async function renderSubject(root, subjectId, profile) {
  const { content } = await store.loadSubject(subjectId);
  const topics = store.allTopics(subjectId);
  let tier = tierPref(profile);
  let hideConfident = false;   // "Hide Confident" toggle (default: show all)
  let sortMode = false;        // "Sort" flat W·N·C view vs strand-grouped

  const draw = () => {
    const showH = tier === 'H';
    const statusOf = (st) => topics.find((x) => x.id === st.id).state.status;
    const visible = (st) => (showH || st.tier !== 'H') && !(hideConfident && statusOf(st) === 'C');

    const rowHtml = (st, parent) => {
      const status = statusOf(st);
      return `<a class="row" href="${esc(subjectId)}/${esc(st.id)}" data-link>
        <button class="row-chip ${STATUS[status].cls}" data-cycle="${esc(st.id)}" title="Tap to change">${status}</button>
        <span class="row-title">${esc(st.title)}${st.tier === 'H' ? '<span class="htag">H</span>' : ''}${parent ? ` <span class="row-parent">(${esc(parent)})</span>` : ''}</span>
        <span class="row-go">›</span>
      </a>`;
    };

    let body;
    if (sortMode) {
      const order = { W: 0, N: 1, C: 2 };
      const flat = [];
      content.strands.forEach((s) => s.subtopics.forEach((st) => { if (visible(st)) flat.push({ st, parent: s.name }); }));
      flat.sort((a, b) => (order[statusOf(a.st)] ?? 9) - (order[statusOf(b.st)] ?? 9));
      const rows = flat.map(({ st, parent }) => rowHtml(st, parent)).join('');
      body = rows ? `<section class="strand"><div class="rows">${rows}</div></section>` : '<p class="muted">Nothing to show.</p>';
    } else {
      body = content.strands.map((strand) => {
        const rows = strand.subtopics.filter(visible).map((st) => rowHtml(st)).join('');
        if (!rows) return '';
        const weight = strand.weightF ? `<span class="weight">F ${esc(strand.weightF)} · H ${esc(strand.weightH)}</span>` : '';
        return `<section class="strand">
          <div class="strand-head"><h2>${esc(strand.name)}</h2>${weight}</div>
          <div class="rows">${rows}</div>
        </section>`;
      }).join('') || '<p class="muted">Nothing to show.</p>';
    }

    const hasHigher = content.strands.some((s) => s.subtopics.some((st) => st.tier === 'H'));
    const tierToggle = hasHigher ? `<div class="seg">
          <button class="${tier === 'F' ? 'on' : ''}" data-tier="F">Foundation</button>
          <button class="${tier === 'H' ? 'on' : ''}" data-tier="H">Higher</button>
        </div>` : '<span></span>';
    const etBtn = content.examTechnique ? `<a class="btn ghost" href="${esc(subjectId)}/exam-technique" data-link>Exam technique</a>` : '';

    root.innerHTML = `${header(content.subject, content.board)}
      <div class="toolbar">${tierToggle}${etBtn}</div>
      <div class="legend-row">
        <p class="legend">${chip('N')} not started ${chip('W')} working on it ${chip('C')} confident</p>
        <div class="legend-controls">
          <button class="btn ghost sm" data-toggle-confident>${hideConfident ? 'Show' : 'Hide'} Confident</button>
          <button class="btn ghost sm ${sortMode ? 'on' : ''}" data-sort>${sortMode ? 'Grouped' : 'Sort W·N·C'}</button>
        </div>
      </div>
      ${body}`;

    root.querySelectorAll('[data-tier]').forEach((b) => b.onclick = () => { tier = b.dataset.tier; setTierPref(tier); draw(); });
    root.querySelector('[data-toggle-confident]').onclick = () => { hideConfident = !hideConfident; draw(); };
    root.querySelector('[data-sort]').onclick = () => { sortMode = !sortMode; draw(); };
    root.querySelectorAll('[data-cycle]').forEach((b) => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = b.dataset.cycle;
      const t = topics.find((x) => x.id === id);
      t.state.status = nextStatus(t.state.status);
      store.setStatus(subjectId, id, t.state.status);
      if (sortMode || hideConfident) {
        draw();   // status change can affect order/visibility
      } else {
        b.textContent = t.state.status;
        b.className = 'row-chip ' + STATUS[t.state.status].cls;
        mountSaveBar(root, subjectId);
      }
    });
    mountSaveBar(root, subjectId);
  };
  draw();
}

export async function renderExamTechnique(root, subjectId) {
  const { content } = await store.loadSubject(subjectId);
  const et = content.examTechnique || {};
  const cmd = (et.commandWords || []).map((c) => `<tr><td><strong>${esc(c.word)}</strong></td><td>${esc(c.meaning)}</td></tr>`).join('');
  const marks = (et.markTypes || []).map((m) => `<li><strong>${esc(m.code)}</strong> — ${esc(m.meaning)}</li>`).join('');
  const last = (et.lastFiveMinutes || []).map((x) => `<li>${esc(x)}</li>`).join('');
  root.innerHTML = `${header('Exam technique', content.subject)}
    <a class="back" href="${esc(subjectId)}" data-link>‹ Back to ${esc(content.subject)}</a>
    <section class="card"><h2>The papers</h2><p>${esc(et.papers || '')}</p></section>
    <section class="card"><h2>Timing</h2><p>${esc(et.timing || '')}</p></section>
    <section class="card"><h2>How marks are awarded</h2><ul>${marks}</ul></section>
    <section class="card"><h2>Command words</h2><table class="tbl"><tbody>${cmd}</tbody></table></section>
    <section class="card"><h2>Exact values to learn</h2><p>${esc(et.exactValues || '')}</p></section>
    <section class="card"><h2>The last five minutes</h2><ul>${last}</ul></section>`;
}

export async function renderTopic(root, subjectId, topicId, profile) {
  await store.loadSubject(subjectId);
  const t = store.getTopic(subjectId, topicId);
  if (!t) return renderNotFound(root);

  const draw = () => {
    const st = t.state;
    const formulae = (t.formulae || []).length
      ? `<section class="card"><h2>Formulae</h2><ul class="formulae">${t.formulae.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : '';
    const tips = (t.tips || []).length
      ? `<section class="card"><h2>Tips</h2><ul>${t.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : '';
    const sections = (t.sections || []).map((s) => `<section class="card"><h2>${esc(s.heading)}</h2>${
      s.text ? `<p>${esc(s.text)}</p>` : ''}${
      s.list ? `<ul>${s.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`).join('');

    // Schedule split into upcoming / past.
    const today = todayISO();
    const sessions = (st.sessions || []).map((s, i) => ({ ...s, i })).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const upcoming = sessions.filter((s) => s.date >= today && !s.done);
    const nextUp = upcoming[0];
    const sessionRows = sessions.length ? sessions.map((s) => `
      <li class="ses ${s.done ? 'done' : s.date < today ? 'past' : 'future'}">
        <label><input type="checkbox" data-done="${s.i}" ${s.done ? 'checked' : ''}> </label>
        <span class="ses-when">${esc(fmtDay(s.date))}${s.time ? ' · ' + esc(s.time) + '–' + esc(addMinutes(s.time, s.duration)) : ''}</span>
        <span class="ses-type">${esc(s.type || 'Review')}</span>
        <button class="link-x" data-del="${s.i}" title="Remove">✕</button>
      </li>`).join('') : '<li class="muted">No sessions scheduled yet.</li>';

    const links = (st.links || []);
    const linkRows = links.length ? links.map((l, i) => `
      <li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>
      <button class="link-x" data-rmlink="${i}" title="Remove">✕</button></li>`).join('')
      : '<li class="muted">No exercise links yet.</li>';

    root.innerHTML = `${header('', '')}
      <a class="back" href="${esc(subjectId)}" data-link>‹ Back to checklist</a>
      <div class="topic-head">
        <div>
          <p class="crumb">${esc(t.strandName)}${t.tier === 'H' ? ' · <span class="htag">Higher</span>' : ''}</p>
          <h1>${esc(t.title)}</h1>
          ${nextUp ? `<p class="nextup">Next review: <strong>${esc(fmtDay(nextUp.date))}${nextUp.time ? ' · ' + esc(nextUp.time) : ''}</strong></p>`
            : '<p class="nextup muted">No upcoming review scheduled.</p>'}
        </div>
        <button id="bigbadge" class="bigbadge ${STATUS[st.status].cls}" title="Tap to change status">
          <span class="bb-letter">${st.status}</span><span class="bb-label">${esc(STATUS[st.status].label)}</span>
        </button>
      </div>

      ${t.method ? `<section class="card"><h2>Method</h2><p>${esc(t.method)}</p></section>` : ''}
      ${formulae}
      ${tips}
      ${sections}

      <section class="card"><h2>Review schedule</h2>
        <ul class="sessions">${sessionRows}</ul>
        <div class="add-row">
          <input type="date" id="s-date" value="${today}">
          <input type="time" id="s-time" value="16:00">
          <select id="s-type"><option>Review</option><option>Practice</option><option>Test</option></select>
          <select id="s-dur" title="Duration">
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60" selected>1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
          </select>
          <button class="btn" id="s-add">Add session</button>
        </div>
      </section>

      <section class="card"><h2>Exercise links (Physics &amp; Maths Tutor, etc.)</h2>
        <ul class="links">${linkRows}</ul>
        <div class="add-row">
          <input type="text" id="l-label" placeholder="Label (e.g. PMT — Surds)">
          <input type="url" id="l-url" placeholder="https://…">
          <button class="btn" id="l-add">Add link</button>
        </div>
      </section>

      <div class="update-foot">
        <button class="btn primary big" id="update-btn">${saveEnabled() ? 'Save' : 'Update schedule file'}</button>
        <p class="muted">${saveEnabled() ? 'Signs in and saves to the shared schedule.' : 'Saves your changes to a file you commit &amp; push.'}</p>
      </div>`;

    // big badge cycle
    root.querySelector('#bigbadge').onclick = () => {
      st.status = nextStatus(st.status);
      store.setStatus(subjectId, topicId, st.status);
      draw();
    };
    // sessions
    root.querySelector('#s-add').onclick = () => {
      const date = root.querySelector('#s-date').value;
      if (!date) return;
      store.addSession(subjectId, topicId, { date, time: root.querySelector('#s-time').value, type: root.querySelector('#s-type').value, duration: Number(root.querySelector('#s-dur').value), done: false });
      draw();
    };
    root.querySelectorAll('[data-done]').forEach((c) => c.onchange = () => { store.updateSession(subjectId, topicId, +c.dataset.done, { done: c.checked }); draw(); });
    root.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { store.removeSession(subjectId, topicId, +b.dataset.del); draw(); });
    // links
    root.querySelector('#l-add').onclick = () => {
      const u = root.querySelector('#l-url').value.trim();
      if (!u) return;
      const label = root.querySelector('#l-label').value.trim();
      store.setLinks(subjectId, topicId, [...(st.links || []), { label, url: u }]);
      draw();
    };
    root.querySelectorAll('[data-rmlink]').forEach((b) => b.onclick = () => {
      const arr = [...st.links]; arr.splice(+b.dataset.rmlink, 1);
      store.setLinks(subjectId, topicId, arr); draw();
    });

    root.querySelector('#update-btn').onclick = () => save();
    mountSaveBar(root, subjectId);
  };
  draw();
}

export async function renderCalendar(root, { profile }) {
  root.innerHTML = header('Calendar', profile?.student ? `${profile.student}'s reviews` : '');
  const sessions = await store.allSessions();
  const today = todayISO();

  // 3-day view
  const days = [0, 1, 2].map((off) => {
    const d = new Date(); d.setDate(d.getDate() + off);
    const iso = d.toLocaleDateString('en-CA');
    const items = sessions.filter((s) => s.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const list = items.length ? items.map((s) => `
      <a class="cal-item" href="${esc(s.subjectId)}/${esc(s.topicId)}" data-link style="--accent:${esc(s.colour || '#2563eb')}">
        <span class="cal-time">${esc(s.time || '')}</span>
        <span class="cal-topic"><span class="cal-subject">${esc(s.subjectName)}</span>${esc(s.topicTitle)} <em>${esc(s.type || '')}</em></span>
      </a>`).join('') : '<p class="muted small">Nothing scheduled.</p>';
    const lbl = off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' });
    return `<div class="day3 ${off === 0 ? 'is-today' : ''}"><h3>${lbl}<span>${esc(fmtDay(iso))}</span></h3>${list}</div>`;
  }).join('');

  // Month grid
  const cur = new Date(); cur.setDate(1);
  const monthName = cur.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstDow = (cur.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="mcell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = new Date(cur.getFullYear(), cur.getMonth(), d).toLocaleDateString('en-CA');
    const items = sessions.filter((s) => s.date === iso);
    const dots = items.slice(0, 4).map((s) => `<span class="dot" style="background:${esc(s.colour || '#2563eb')}"></span>`).join('');
    cells += `<div class="mcell ${iso === today ? 'today' : ''}" data-date="${iso}"><span class="mnum">${d}</span><div class="mdots">${dots}</div></div>`;
  }
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => `<div class="mhd">${x}</div>`).join('');

  root.insertAdjacentHTML('beforeend', `
    <a class="back" href="" data-link>‹ Home</a>
    <section class="three-day">${days}</section>
    <div class="cal-body">
      <section class="card month-card">
        <h2>${monthName}</h2>
        <div class="month"><div class="mrow head">${dow}</div><div class="mgrid">${cells}</div></div>
      </section>
      <section class="card day-panel" id="day-panel"></section>
    </div>`);

  // --- Outlook-style day panel: 24h + roll-over into the (greyed) next day ---
  const PXH = 44, DAY = 24, ROLL = 13, TOTAL = DAY + ROLL;   // hours rendered
  const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const hourLabel = (h) => { const x = h % 24; return x === 0 ? '12 am' : x < 12 ? `${x} am` : x === 12 ? '12 pm' : `${x - 12} pm`; };
  const panel = root.querySelector('#day-panel');

  const eventBlock = (s, offset) => {
    const [hh, mm] = (s.time || '09:00').split(':').map(Number);
    const base = hh * 60 + (mm || 0);
    const dur = s.duration || (s.end ? (Number(s.end.split(':')[0]) * 60 + Number(s.end.split(':')[1]) - base) : 60);
    const start = base + offset, end = start + Math.max(dur, 30);
    const top = start / 60 * PXH;
    const height = Math.max((Math.min(TOTAL * 60, end) - start) / 60 * PXH, 22);
    return `<a class="day-event ${s.done ? 'done' : ''}${offset ? ' next' : ''}" href="${esc(s.subjectId)}/${esc(s.topicId)}" data-link
      title="${esc(s.topicTitle)}${s.type ? ' · ' + esc(s.type) : ''}"
      style="top:${top}px;height:${height}px;--evt:${esc(s.colour || '#2563eb')}">
      <span class="de-time">${hm(start)}–${hm(end)}</span>
      <span class="de-title"><span class="cal-subject">${esc(s.subjectName)}</span></span>
    </a>`;
  };

  const drawDay = (iso) => {
    const items = sessions.filter((s) => s.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const nextISO = new Date(new Date(iso + 'T00:00').getTime() + 864e5).toLocaleDateString('en-CA');
    const nextItems = sessions.filter((s) => s.date === nextISO && Number((s.time || '0').split(':')[0]) < ROLL);
    const head = new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const nextShort = new Date(nextISO + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

    let lines = '';
    for (let h = 0; h <= TOTAL; h++) {
      lines += `<div class="hourline" style="top:${h * PXH}px"><span class="hlabel">${hourLabel(h)}</span></div>`;
    }
    const events = [...items.map((s) => eventBlock(s, 0)), ...nextItems.map((s) => eventBlock(s, DAY * 60))].join('');
    const overlay = `<div class="next-day" style="top:${DAY * PXH}px;height:${ROLL * PXH}px"><span>${esc(nextShort)} →</span></div>`;
    const nowLine = iso === today
      ? `<div class="now-line" style="top:${(new Date().getHours() * 60 + new Date().getMinutes()) / 60 * PXH}px"></div>`
      : '';

    panel.innerHTML = `
      <div class="day-head"><h2>${esc(head)}</h2>
        <span class="muted small">${items.length} session${items.length === 1 ? '' : 's'}</span></div>
      <div class="day-scroll">
        <div class="day-grid" style="height:${TOTAL * PXH}px">
          ${lines}${overlay}${nowLine}<div class="day-track">${events}</div>
        </div>
      </div>`;
    const scroll = panel.querySelector('.day-scroll');
    if (scroll) scroll.scrollTop = new Date().getHours() * PXH;   // current hour at the top
  };

  root.querySelectorAll('.mcell[data-date]').forEach((c) => c.onclick = () => {
    root.querySelectorAll('.mcell.selected').forEach((x) => x.classList.remove('selected'));
    c.classList.add('selected');
    drawDay(c.dataset.date);
  });
  const initial = root.querySelector(`.mcell[data-date="${today}"]`) || root.querySelector('.mcell[data-date]');
  if (initial) { initial.classList.add('selected'); drawDay(initial.dataset.date); }
}

export function renderNotFound(root) {
  document.getElementById('savebar')?.remove();
  root.innerHTML = `${header('Not found', '')}<p>That page doesn’t exist. <a href="" data-link>Go home</a>.</p>`;
}
