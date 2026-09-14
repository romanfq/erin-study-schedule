// Important dates: a countdown list, sorted soonest first, used on the landing
// page (everything) and on each subject page (that subject's exams only).
// Data: data/important_dates.json — { exams: {subjectId: "Board code"},
//   dates: [{ title, start: "YYYY-MM-DD", end?, session?: "am"|"pm", subject? }] }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY = 86400000;
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SESSION = { am: 'Morning', pm: 'Afternoon' };

// Dates are calendar days in the viewer's local time (midnight to midnight).
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysUntil = (iso, from) => Math.round((parse(iso) - from) / DAY);   // round absorbs DST shifts

const fmt = (iso, withYear = true) => {
  const d = parse(iso);
  return `${WDAY[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
};
const fmtRange = (ev) => {
  if (!ev.end) return fmt(ev.start);
  const sameYear = ev.start.slice(0, 4) === ev.end.slice(0, 4);
  return `${fmt(ev.start, !sameYear)} – ${fmt(ev.end)}`;
};

// Whole calendar months from `from` to `to`, then the leftover days
// (14 Sep → 17 Dec = 3 months, 3 days). Month-end days clamp (31 Jan + 1 month = 28 Feb).
function monthsAndDays(from, to) {
  const addMonths = (n) => {
    const y = from.getFullYear(), m = from.getMonth() + n;
    return new Date(y, m, Math.min(from.getDate(), new Date(y, m + 1, 0).getDate()));
  };
  let months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  if (addMonths(months) > to) months--;
  return { months, days: Math.round((to - addMonths(months)) / DAY) };
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

// "tomorrow", "a week and a half from now", "a month from now",
// "eight months and three days from now"…
export function whenText(iso, from) {
  const to = parse(iso);
  const days = Math.round((to - from) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  const { months, days: rest } = monthsAndDays(from, to);
  if (months >= 1) {
    const y = Math.floor(months / 12), m = months % 12;
    const parts = [y && plural(y, 'year'), m && plural(m, 'month'), rest && plural(rest, 'day')].filter(Boolean);
    const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    return `${joined} from now`;
  }
  const w = Math.floor(days / 7), r = days % 7;
  const weeks = (n) => (n === 1 ? 'a week' : `${n} weeks`);
  if (r === 0) return `${weeks(w)} from now`;
  if (r <= 2) return `just over ${weeks(w)} from now`;
  if (r >= 5) return `almost ${weeks(w + 1)} from now`;
  return w === 1 ? 'a week and a half from now' : `${w} and a half weeks from now`;
}

// Red ≤ 7 days, yellow 8–30, green 31+; grey once it's over.
const level = (days) => (days <= 7 ? 'red' : days <= 30 ? 'yellow' : 'green');

function describe(ev, from) {
  const toStart = daysUntil(ev.start, from);
  const toEnd = ev.end ? daysUntil(ev.end, from) : toStart;
  if (toEnd < 0) return { past: true, lvl: 'past', badge: 'Done', phrase: '' };
  if (toStart < 0) return { lvl: 'red', badge: 'On now', phrase: toEnd === 0 ? 'ends today' : `ends ${whenText(ev.end, from)}` };
  if (toStart === 0) return { lvl: 'red', badge: 'Today', phrase: ev.end ? 'starts today' : '' };
  return {
    lvl: level(toStart),
    badge: `${toStart} day${toStart === 1 ? '' : 's'}`,
    phrase: (ev.end ? 'starts ' : '') + whenText(ev.start, from),
  };
}

const sortKey = (ev) => `${ev.start}|${ev.session === 'pm' ? 1 : 0}|${ev.end || ''}`;

// Render into `box` (a <section>). opts.subjects → landing (all dates, subject
// pills); opts.subjectId → that subject's dates only. Hides the box when empty.
export function mountDates(box, data, { subjects = [], subjectId = null } = {}) {
  const from = today();
  const meta = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const all = (data?.dates || [])
    .filter((ev) => ev.start && (!subjectId || ev.subject === subjectId))
    .map((ev) => ({ ev, ...describe(ev, from) }))
    .sort((a, b) => sortKey(a.ev).localeCompare(sortKey(b.ev)));
  const upcoming = all.filter((x) => !x.past);
  const past = all.filter((x) => x.past);
  box.hidden = all.length === 0;
  if (!all.length) return;

  const row = ({ ev, lvl, badge, phrase }) => {
    const s = !subjectId && ev.subject ? meta[ev.subject] : null;
    const pill = s ? `<a class="idate-subj" style="--subj:${esc(s.colour || '#64748b')}" href="${esc(s.id)}" data-link>${esc(s.short || s.name)}</a>` : '';
    return `<li class="idate lvl-${lvl}">
      <div class="idate-when"><span class="idate-date">${esc(fmtRange(ev))}</span>${ev.session ? `<span class="idate-session">${esc(SESSION[ev.session] || ev.session)}</span>` : ''}</div>
      <div class="idate-what">${pill}${esc(ev.title)}</div>
      <div class="idate-count"><span class="idate-days">${esc(badge)}</span>${phrase ? `<span class="idate-phrase">${esc(phrase)}</span>` : ''}</div>
    </li>`;
  };

  const heading = subjectId ? 'Exam dates' : 'Important dates';
  const sub = subjectId ? data?.exams?.[subjectId] || '' : '';
  let showPast = false;
  const draw = () => {
    const rows = [...(showPast ? past : []), ...upcoming];
    box.innerHTML = `<div class="idates-head"><h2>${heading}</h2>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</div>
      ${rows.length ? `<ul class="idate-list">${rows.map(row).join('')}</ul>` : '<p class="muted small">Nothing coming up.</p>'}
      ${past.length ? `<button class="btn ghost sm idates-more" data-past>${showPast ? 'Hide' : 'Show'} ${past.length} past date${past.length === 1 ? '' : 's'}</button>` : ''}`;
    const btn = box.querySelector('[data-past]');
    if (btn) btn.onclick = () => { showPast = !showPast; draw(); };
  };
  draw();
}
