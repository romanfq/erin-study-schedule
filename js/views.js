import { STATUS, STATUS_CYCLE } from './config.js';
import { navigate } from './router.js';
import * as store from './store.js';

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
  const n = store.changeCount(subjectId);
  if (!n) return;
  const bar = el(`<div id="savebar" class="savebar">
    <span><strong>${n}</strong> unsaved change${n === 1 ? '' : 's'} — export the file and commit it to save.</span>
    <span class="savebar-actions">
      <button class="btn ghost" data-act="discard">Discard</button>
      <button class="btn primary" data-act="export">Update file</button>
    </span>
  </div>`);
  bar.querySelector('[data-act="export"]').onclick = () => openExport(subjectId);
  bar.querySelector('[data-act="discard"]').onclick = () => {
    if (confirm('Discard all unsaved changes on this device?')) { store.discardChanges(subjectId); navigate(location.pathname); }
  };
  document.body.appendChild(bar);
}

function openExport(subjectId) {
  const { json, path } = store.exportState(subjectId);
  const modal = el(`<div class="modal-bg">
    <div class="modal">
      <h2>Update the schedule file</h2>
      <p>Save this as <code>${esc(path)}</code>, then commit &amp; push:</p>
      <pre class="cmd">git add ${esc(path)} &amp;&amp; git commit -m "Update ${esc(subjectId)} status" &amp;&amp; git push</pre>
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

  const draw = () => {
    const showH = tier === 'H';
    const strands = content.strands.map((strand) => {
      const rows = strand.subtopics
        .filter((st) => showH || st.tier !== 'H')
        .map((st) => {
          const t = topics.find((x) => x.id === st.id);
          const status = t.state.status;
          return `<a class="row" href="${esc(subjectId)}/${esc(st.id)}" data-link>
            <button class="row-chip ${STATUS[status].cls}" data-cycle="${esc(st.id)}" title="Tap to change">${status}</button>
            <span class="row-title">${esc(st.title)}${st.tier === 'H' ? '<span class="htag">H</span>' : ''}</span>
            <span class="row-go">›</span>
          </a>`;
        }).join('');
      if (!rows) return '';
      const weight = strand.weightF ? `<span class="weight">F ${esc(strand.weightF)} · H ${esc(strand.weightH)}</span>` : '';
      return `<section class="strand">
        <div class="strand-head"><h2>${esc(strand.name)}</h2>${weight}</div>
        <div class="rows">${rows}</div>
      </section>`;
    }).join('');

    const hasHigher = content.strands.some((s) => s.subtopics.some((st) => st.tier === 'H'));
    const tierToggle = hasHigher ? `<div class="seg">
          <button class="${tier === 'F' ? 'on' : ''}" data-tier="F">Foundation</button>
          <button class="${tier === 'H' ? 'on' : ''}" data-tier="H">Higher</button>
        </div>` : '<span></span>';
    const etBtn = content.examTechnique ? `<a class="btn ghost" href="${esc(subjectId)}/exam-technique" data-link>Exam technique</a>` : '';

    root.innerHTML = `${header(content.subject, content.board)}
      <div class="toolbar">${tierToggle}${etBtn}</div>
      <p class="legend">${chip('N')} not started ${chip('W')} working on it ${chip('C')} confident</p>
      ${strands}`;

    root.querySelectorAll('[data-tier]').forEach((b) => b.onclick = () => { tier = b.dataset.tier; setTierPref(tier); draw(); });
    root.querySelectorAll('[data-cycle]').forEach((b) => b.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = b.dataset.cycle;
      const t = topics.find((x) => x.id === id);
      t.state.status = nextStatus(t.state.status);
      store.setStatus(subjectId, id, t.state.status);
      b.textContent = t.state.status;
      b.className = 'row-chip ' + STATUS[t.state.status].cls;
      mountSaveBar(root, subjectId);
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
        <button class="btn primary big" id="update-btn">Update schedule file</button>
        <p class="muted">Saves your changes to a file you commit &amp; push.</p>
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

    root.querySelector('#update-btn').onclick = () => openExport(subjectId);
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

  // --- Outlook-style day panel (9am–8pm) ---
  const START = 9, END = 20, PXH = 46;
  const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const hourLabel = (h) => h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`;
  const panel = root.querySelector('#day-panel');

  const drawDay = (iso) => {
    const items = sessions.filter((s) => s.date === iso)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const head = new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    let lines = '';
    for (let h = START; h <= END; h++) {
      lines += `<div class="hourline" style="top:${(h - START) * PXH}px"><span class="hlabel">${hourLabel(h)}</span></div>`;
    }
    const events = items.map((s) => {
      const [hh, mm] = (s.time || '09:00').split(':').map(Number);
      const start = hh * 60 + (mm || 0);
      const dur = s.duration || (s.end ? (Number(s.end.split(':')[0]) * 60 + Number(s.end.split(':')[1]) - start) : 60);
      const end = start + Math.max(dur, 30);
      const top = Math.max(0, (start - START * 60) / 60 * PXH);
      const bottom = Math.min((END - START) * PXH, (end - START * 60) / 60 * PXH);
      const height = Math.max(bottom - top, 22);
      return `<a class="day-event ${s.done ? 'done' : ''}" href="${esc(s.subjectId)}/${esc(s.topicId)}" data-link
        style="top:${top}px;height:${height}px;--evt:${esc(s.colour || '#2563eb')}">
        <span class="de-time">${hm(start)}–${hm(end)}</span>
        <span class="de-title"><span class="cal-subject">${esc(s.subjectName)}</span>${esc(s.topicTitle)}</span>
      </a>`;
    }).join('');

    panel.innerHTML = `
      <div class="day-head"><h2>${esc(head)}</h2>
        <span class="muted small">${items.length} session${items.length === 1 ? '' : 's'}</span></div>
      <div class="day-grid" style="height:${(END - START) * PXH}px">
        ${lines}<div class="day-track">${events}</div>
      </div>`;
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
