// Data + state store.
//
// State for every subject lives in ONE committed file, data/state.json:
//   { updatedAt, subjects: { <subjectId>: { topics: { <id>: {status,links,sessions} } } } }
// While you use the UI, edits are held in a single per-device "working overlay"
// in localStorage. Pressing Update exports the whole data/state.json to commit.
// On load, if the committed file has moved on since the overlay was based on it,
// the overlay is discarded so a freshly committed file always wins.

import { url } from './config.js?v=1789082332';

const LS_KEY = 'ess:working';
const STATE_FILE = 'data/state.json';

const cache = { subjects: null, profile: null, content: {}, base: null, working: null };

async function getJSON(path) {
  const res = await fetch(url(path) + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

function emptyTopic() { return { status: 'N', links: [], sessions: [] }; }

function normalise(state) {
  return { updatedAt: state?.updatedAt || '', subjects: state?.subjects || {} };
}

function reconcileWorking() {
  let working = null;
  try { working = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
  if (!working || working.basedOn !== cache.base.updatedAt) {
    working = { basedOn: cache.base.updatedAt, subjects: structuredClone(cache.base.subjects) };
    localStorage.removeItem(LS_KEY);
  }
  cache.working = working;
}

export async function loadCore() {
  if (!cache.subjects) cache.subjects = (await getJSON('data/subjects.json')).subjects;
  if (!cache.profile) {
    try { cache.profile = await getJSON('data/profile.json'); }
    catch { cache.profile = { student: '', defaultSubject: 'maths', tier: 'F' }; }
  }
  if (!cache.base) {
    try { cache.base = normalise(await getJSON(STATE_FILE)); }
    catch { cache.base = { updatedAt: '', subjects: {} }; }
    reconcileWorking();
  }
  return { subjects: cache.subjects, profile: cache.profile };
}

export function subjectMeta(id) {
  return (cache.subjects || []).find((s) => s.id === id);
}

function ensureSubject(subjectId) {
  if (!cache.working.subjects[subjectId]) cache.working.subjects[subjectId] = { topics: {} };
  return cache.working.subjects[subjectId];
}

export async function loadSubject(subjectId) {
  const meta = subjectMeta(subjectId);
  if (!meta || meta.status !== 'active') throw new Error('Subject not available');
  if (!cache.content[subjectId]) cache.content[subjectId] = await getJSON(meta.content);
  ensureSubject(subjectId);
  return { content: cache.content[subjectId], meta };
}

// Every subtopic in the content, with its current (working) state merged in.
export function allTopics(subjectId) {
  const content = cache.content[subjectId];
  const wsub = ensureSubject(subjectId);
  const out = [];
  for (const strand of content.strands) {
    for (const st of strand.subtopics) {
      const state = wsub.topics[st.id] || emptyTopic();
      out.push({ ...st, strandId: strand.id, strandName: strand.name, state });
    }
  }
  return out;
}

export function getTopic(subjectId, topicId) {
  return allTopics(subjectId).find((t) => t.id === topicId);
}

function ensureTopic(subjectId, topicId) {
  const sub = ensureSubject(subjectId);
  if (!sub.topics[topicId]) sub.topics[topicId] = emptyTopic();
  return sub.topics[topicId];
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(cache.working));
}

// --- mutations (UI is the only writer) ---

export function setStatus(subjectId, topicId, status) {
  ensureTopic(subjectId, topicId).status = status;
  persist();
}

export function setLinks(subjectId, topicId, links) {
  ensureTopic(subjectId, topicId).links = links;
  persist();
}

export function addSession(subjectId, topicId, session) {
  ensureTopic(subjectId, topicId).sessions.push(session);
  persist();
}

export function updateSession(subjectId, topicId, index, patch) {
  const t = ensureTopic(subjectId, topicId);
  if (t.sessions[index]) Object.assign(t.sessions[index], patch);
  persist();
}

export function removeSession(subjectId, topicId, index) {
  const t = ensureTopic(subjectId, topicId);
  t.sessions.splice(index, 1);
  persist();
}

// --- dirty tracking + export (whole file, across all subjects) ---

export function changeCount() {
  const base = cache.base, working = cache.working;
  if (!base || !working) return 0;
  let n = 0;
  const subjIds = new Set([...Object.keys(base.subjects), ...Object.keys(working.subjects)]);
  for (const sid of subjIds) {
    const bt = base.subjects[sid]?.topics || {};
    const wt = working.subjects[sid]?.topics || {};
    const ids = new Set([...Object.keys(bt), ...Object.keys(wt)]);
    for (const id of ids) {
      if (JSON.stringify(bt[id] || emptyTopic()) !== JSON.stringify(wt[id] || emptyTopic())) n++;
    }
  }
  return n;
}

// Produce the exact contents to commit as data/state.json (stable ordering).
export function exportState() {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const out = { updatedAt: stamp, subjects: {} };
  const order = (cache.subjects || []).filter((s) => s.status === 'active').map((s) => s.id);
  const extras = Object.keys(cache.working.subjects).filter((id) => !order.includes(id));
  for (const sid of [...order, ...extras]) {
    const wt = cache.working.subjects[sid]?.topics;
    if (!wt) continue;
    let ids = cache.content[sid]
      ? cache.content[sid].strands.flatMap((st) => st.subtopics.map((s) => s.id)).filter((id) => id in wt)
      : Object.keys(cache.base.subjects[sid]?.topics || wt);
    for (const id of Object.keys(wt)) if (!ids.includes(id)) ids.push(id);
    out.subjects[sid] = { topics: Object.fromEntries(ids.map((id) => [id, wt[id]])) };
  }
  return { json: JSON.stringify(out, null, 2) + '\n', path: STATE_FILE };
}

export function discardChanges() {
  cache.working = { basedOn: cache.base.updatedAt, subjects: structuredClone(cache.base.subjects) };
  localStorage.removeItem(LS_KEY);
}

// The committed base the UI is working from — sent to the Worker so it can
// reject the write if the repo moved on (optimistic concurrency).
export function baseUpdatedAt() { return cache.base?.updatedAt || ''; }

// After a successful direct save, adopt the saved content as the new base so
// the unsaved-count resets and the next save's concurrency check is correct.
export function markSaved(saved) {
  cache.base = normalise(saved);
  cache.working = { basedOn: cache.base.updatedAt, subjects: structuredClone(cache.base.subjects) };
  localStorage.setItem(LS_KEY, JSON.stringify(cache.working));
}

// --- three-way rebase, used to auto-resolve a save conflict (409) ---
function canonUrl(u) {
  u = u || '';
  try { if (u.includes('pdf-pages') && u.includes('pdf=')) { const q = new URL(u, 'https://x/').searchParams.get('pdf'); if (q) u = q; } } catch { /* */ }
  let prev = null;
  while (prev !== u) { prev = u; try { u = decodeURIComponent(u); } catch { break; } }
  return u.toLowerCase().trim();
}
function unionLinks(a, b) {
  const out = [], seen = new Set();
  for (const l of [...(a || []), ...(b || [])]) { const k = canonUrl(l.url); if (!seen.has(k)) { seen.add(k); out.push(l); } }
  return out;
}
const sesKey = (s) => `${s.date}|${s.time || ''}|${s.type || ''}`;
function mergeSessions(base, a, b) {
  const bm = new Map((base || []).map((s) => [sesKey(s), s]));
  const m = new Map();
  for (const s of [...(a || []), ...(b || [])]) {
    const k = sesKey(s);
    if (!m.has(k)) m.set(k, { ...s });
    else { const cur = m.get(k), bd = bm.get(k)?.done ?? false; cur.done = (cur.done === s.done) ? cur.done : (cur.done === bd) ? s.done : (s.done === bd) ? cur.done : (cur.done || s.done); }
  }
  return [...m.values()];
}

// The current committed file (fresh) — the "theirs" side of a rebase.
// Keeps updatedBy (who last saved it) for display; normalise() drops it.
export async function fetchCommitted() {
  const raw = await getJSON(STATE_FILE);
  return { ...normalise(raw), updatedBy: raw?.updatedBy };
}

// Rebase local edits (working) onto `theirs`, ancestor = cache.base (what we
// loaded). Returns { subjects, conflicts:[{key,subjectId,topicId,base,ours,theirs}] }.
// Non-conflicting status changes, and all link/session additions, merge
// automatically; genuine same-topic status clashes are reported and resolved
// via resolutions[key] === 'ours' | 'theirs' (default 'theirs').
export function rebase(theirs, resolutions = {}) {
  const ancestor = cache.base, ours = cache.working;
  const subjects = {}, conflicts = [];
  const sids = new Set([...Object.keys(ancestor.subjects), ...Object.keys(ours.subjects), ...Object.keys(theirs.subjects)]);
  for (const sid of sids) {
    const at = ancestor.subjects[sid]?.topics || {};
    const yt = ours.subjects[sid]?.topics || {};
    const tt = theirs.subjects[sid]?.topics || {};
    const topics = {};
    for (const tid of new Set([...Object.keys(at), ...Object.keys(yt), ...Object.keys(tt)])) {
      const v0 = at[tid], oy = yt[tid], ot = tt[tid];
      const bs = v0?.status ?? 'N', ys = oy?.status ?? 'N', ts = ot?.status ?? 'N';
      let status;
      if (ys === ts) status = ys;
      else if (ys === bs) status = ts;
      else if (ts === bs) status = ys;
      else {
        const key = sid + '::' + tid;
        conflicts.push({ key, subjectId: sid, topicId: tid, base: bs, ours: ys, theirs: ts });
        status = resolutions[key] === 'ours' ? ys : ts;
      }
      topics[tid] = { status, links: unionLinks(oy?.links, ot?.links), sessions: mergeSessions(v0?.sessions, oy?.sessions, ot?.sessions) };
    }
    subjects[sid] = { topics };
  }
  return { subjects, conflicts };
}

// Adopt `theirs` as the new base and the merged subjects as working, so the
// next export/save carries the rebased content and the right concurrency stamp.
export function applyRebase(theirs, mergedSubjects) {
  cache.base = normalise(theirs);
  cache.working = { basedOn: cache.base.updatedAt, subjects: mergedSubjects };
  localStorage.setItem(LS_KEY, JSON.stringify(cache.working));
}

// All scheduled sessions across every active subject, flattened for the calendar.
export async function allSessions() {
  const out = [];
  for (const s of cache.subjects || []) {
    if (s.status !== 'active') continue;
    try { await loadSubject(s.id); } catch { continue; }
    for (const t of allTopics(s.id)) {
      (t.state.sessions || []).forEach((ses, i) => {
        out.push({
          subjectId: s.id, subjectName: s.short || s.name, colour: s.colour,
          topicId: t.id, topicTitle: t.title, index: i, ...ses,
        });
      });
    }
  }
  return out;
}
