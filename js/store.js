// Data + state store.
//
// The committed state file (data/<subject>/state.json) is the source of truth.
// While you use the UI, edits are held in a per-device "working overlay" in
// localStorage. Pressing Update exports a fresh state.json for you to commit.
// On load, if the committed file has moved on since the overlay was based on it,
// the overlay is discarded so a freshly committed file always wins.

import { url } from './config.js?v=1788562101';

const LS_KEY = (subject) => `ess:${subject}:working`;

const cache = { subjects: null, profile: null, content: {}, base: {}, working: {} };

async function getJSON(path) {
  const res = await fetch(url(path) + '?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

export async function loadCore() {
  if (!cache.subjects) cache.subjects = (await getJSON('data/subjects.json')).subjects;
  if (!cache.profile) {
    try { cache.profile = await getJSON('data/profile.json'); }
    catch { cache.profile = { student: '', defaultSubject: 'maths', tier: 'F' }; }
  }
  return { subjects: cache.subjects, profile: cache.profile };
}

export function subjectMeta(id) {
  return (cache.subjects || []).find((s) => s.id === id);
}

function emptyTopic() { return { status: 'N', links: [], sessions: [] }; }

export async function loadSubject(subjectId) {
  const meta = subjectMeta(subjectId);
  if (!meta || meta.status !== 'active') throw new Error('Subject not available');

  if (!cache.content[subjectId]) cache.content[subjectId] = await getJSON(meta.content);
  if (!cache.base[subjectId]) cache.base[subjectId] = await getJSON(meta.state);

  const content = cache.content[subjectId];
  const base = cache.base[subjectId];

  // Reconcile the working overlay with the committed base.
  let working = null;
  try { working = JSON.parse(localStorage.getItem(LS_KEY(subjectId)) || 'null'); } catch { /* ignore */ }
  if (!working || working.basedOn !== base.updatedAt) {
    // No unsaved edits, or the committed file has changed — start clean from base.
    working = { basedOn: base.updatedAt, topics: structuredClone(base.topics) };
    localStorage.removeItem(LS_KEY(subjectId));
  }
  cache.working[subjectId] = working;

  return { content, meta, updatedAt: base.updatedAt };
}

// Every subtopic in the content, with its current (working) state merged in.
export function allTopics(subjectId) {
  const content = cache.content[subjectId];
  const working = cache.working[subjectId];
  const out = [];
  for (const strand of content.strands) {
    for (const st of strand.subtopics) {
      const state = working.topics[st.id] || emptyTopic();
      out.push({ ...st, strandId: strand.id, strandName: strand.name, state });
    }
  }
  return out;
}

export function getTopic(subjectId, topicId) {
  return allTopics(subjectId).find((t) => t.id === topicId);
}

function ensureTopic(subjectId, topicId) {
  const working = cache.working[subjectId];
  if (!working.topics[topicId]) working.topics[topicId] = emptyTopic();
  return working.topics[topicId];
}

function persistWorking(subjectId) {
  localStorage.setItem(LS_KEY(subjectId), JSON.stringify(cache.working[subjectId]));
}

// --- mutations (UI is the only writer) ---

export function setStatus(subjectId, topicId, status) {
  ensureTopic(subjectId, topicId).status = status;
  persistWorking(subjectId);
}

export function setLinks(subjectId, topicId, links) {
  ensureTopic(subjectId, topicId).links = links;
  persistWorking(subjectId);
}

export function addSession(subjectId, topicId, session) {
  ensureTopic(subjectId, topicId).sessions.push(session);
  persistWorking(subjectId);
}

export function updateSession(subjectId, topicId, index, patch) {
  const t = ensureTopic(subjectId, topicId);
  if (t.sessions[index]) Object.assign(t.sessions[index], patch);
  persistWorking(subjectId);
}

export function removeSession(subjectId, topicId, index) {
  const t = ensureTopic(subjectId, topicId);
  t.sessions.splice(index, 1);
  persistWorking(subjectId);
}

// --- dirty tracking + export ---

export function changeCount(subjectId) {
  const base = cache.base[subjectId];
  const working = cache.working[subjectId];
  if (!base || !working) return 0;
  let n = 0;
  const ids = new Set([...Object.keys(base.topics), ...Object.keys(working.topics)]);
  for (const id of ids) {
    const a = JSON.stringify(base.topics[id] || emptyTopic());
    const b = JSON.stringify(working.topics[id] || emptyTopic());
    if (a !== b) n++;
  }
  return n;
}

// Produce the exact file contents to commit as data/<subject>/state.json.
export function exportState(subjectId) {
  const working = cache.working[subjectId];
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const out = { updatedAt: stamp, topics: {} };
  // Preserve content order for a stable, readable diff.
  for (const t of allTopics(subjectId)) out.topics[t.id] = t.state;
  return { json: JSON.stringify(out, null, 2) + '\n', path: subjectMeta(subjectId).state };
}

export function discardChanges(subjectId) {
  const base = cache.base[subjectId];
  cache.working[subjectId] = { basedOn: base.updatedAt, topics: structuredClone(base.topics) };
  localStorage.removeItem(LS_KEY(subjectId));
}

// All scheduled sessions across every active subject, flattened for the calendar.
export async function allSessions() {
  const out = [];
  for (const s of cache.subjects || []) {
    if (s.status !== 'active') continue;
    if (!cache.content[s.id]) { try { await loadSubject(s.id); } catch { continue; } }
    for (const t of allTopics(s.id)) {
      (t.state.sessions || []).forEach((ses, i) => {
        out.push({
          subjectId: s.id, subjectName: s.short || s.name, colour: s.colour,
          topicId: t.id, topicTitle: t.title, index: i, ...ses
        });
      });
    }
  }
  return out;
}
