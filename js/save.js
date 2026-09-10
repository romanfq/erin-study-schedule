// Direct save via the Cloudflare Worker, gated by Google sign-in.
// Reads/writes still go through data/state.json in git; this just automates the
// "commit the file" step for allow-listed Google accounts.

import { SAVE } from './config.js?v=1789083599';

export function saveEnabled() {
  return !!(SAVE.workerUrl && SAVE.googleClientId);
}

let token = null, tokenExp = 0, gisScript = null;

function loadGis() {
  if (gisScript) return gisScript;
  gisScript = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisScript;
}

const jwtExp = (jwt) => { try { return (JSON.parse(atob(jwt.split('.')[1])).exp || 0) * 1000; } catch { return 0; } };

// Return a fresh Google ID token, prompting sign-in via a modal button if needed.
export async function ensureToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  await loadGis();
  return new Promise((resolve, reject) => {
    let done = false;
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `<div class="modal signin">
        <h2>Sign in to save</h2>
        <p class="muted">Saving writes to the shared schedule. Sign in with your Google account.</p>
        <div id="gbtn" class="gbtn"></div>
        <div class="modal-actions"><button class="btn ghost" data-x>Cancel</button></div>
      </div>`;
    const cleanup = () => modal.remove();
    const finish = (cred) => { if (!done) { done = true; token = cred; tokenExp = jwtExp(cred); cleanup(); resolve(cred); } };
    const fail = (e) => { if (!done) { done = true; cleanup(); reject(e); } };
    modal.querySelector('[data-x]').onclick = () => fail(new Error('sign-in cancelled'));
    modal.addEventListener('click', (e) => { if (e.target === modal) fail(new Error('sign-in cancelled')); });
    document.body.appendChild(modal);

    google.accounts.id.initialize({
      client_id: SAVE.googleClientId,
      callback: (resp) => { if (resp?.credential) finish(resp.credential); },
      auto_select: false,
    });
    google.accounts.id.renderButton(modal.querySelector('#gbtn'), { theme: 'outline', size: 'large', width: 240 });
    try { google.accounts.id.prompt(); } catch { /* One Tap optional */ }
  });
}

// POST the whole state file to the Worker. Throws typed errors: code 'conflict'
// (409, someone else saved) or 'forbidden' (403, not allow-listed).
export async function directSave(idToken, content, baseUpdatedAt) {
  const res = await fetch(SAVE.workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, content, baseUpdatedAt }),
  });
  if (res.status === 409) {
    const j = await res.json().catch(() => ({}));
    const e = new Error('conflict'); e.code = 'conflict'; e.currentUpdatedAt = j.currentUpdatedAt; throw e;
  }
  if (res.status === 403) { const e = new Error('You are not allow-listed to save.'); e.code = 'forbidden'; throw e; }
  if (!res.ok) { const e = new Error('Save failed (' + res.status + ')'); e.detail = await res.text().catch(() => ''); throw e; }
  return res.json();
}

export function signOut() { token = null; tokenExp = 0; }
