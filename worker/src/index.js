// Cloudflare Worker: authenticated save of data/state.json to the repo.
//
// Flow: the site POSTs { idToken, content, baseUpdatedAt }.
//   1. Verify the Google ID token via Google's tokeninfo endpoint.
//   2. Check aud == our OAuth client id, email is verified and allow-listed.
//   3. Optimistic concurrency: reject if the committed file moved on since the
//      caller loaded it (baseUpdatedAt != current file's updatedAt) -> 409.
//   4. Commit `content` to data/state.json via the GitHub Contents API using a
//      server-held fine-grained token.
//
// Secrets/vars (set in Cloudflare → Worker → Settings → Variables and Secrets):
//   GITHUB_TOKEN      (secret) fine-grained PAT, Contents:read/write on the repo
//   ALLOWED_EMAILS    (secret) comma-separated Google emails allowed to write
//   GOOGLE_CLIENT_ID  (text)   the OAuth Web client id (public)

const OWNER = 'romanfq';
const REPO = 'erin-study-schedule';
const PATH = 'data/state.json';
const BRANCH = 'main';

const ALLOWED_ORIGINS = [
  'https://romanfq.github.io',
  'http://localhost:8000',
  'http://localhost:8123',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const reply = (status, obj, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' }, headers);

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: 'invalid JSON body' }, headers); }
    const { idToken, content, baseUpdatedAt } = body || {};
    if (!idToken || typeof content !== 'string') return reply(400, { error: 'missing idToken or content' }, headers);

    // 1–2. verify Google identity + allow-list
    const info = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const allowed = (env.ALLOWED_EMAILS || '').split(/[\s;,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const email = (info?.email || '').toLowerCase();
    const ok = info
      && info.aud === env.GOOGLE_CLIENT_ID
      && String(info.email_verified) === 'true'
      && allowed.includes(email);
    if (!ok) return reply(403, { error: 'not authorised' }, headers);

    // sanity: content must be a state file
    let parsed;
    try { parsed = JSON.parse(content); } catch { return reply(400, { error: 'content is not JSON' }, headers); }
    if (!parsed || typeof parsed.subjects !== 'object') return reply(400, { error: 'not a data/state.json file' }, headers);

    const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
    const gh = (url, opts = {}) => fetch(url, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'gcse-schedule-updater',
        ...(opts.headers || {}),
      },
    });

    // current sha + updatedAt (for optimistic concurrency)
    const cur = await gh(`${api}?ref=${BRANCH}`);
    if (!cur.ok && cur.status !== 404) return reply(502, { error: 'github read failed', status: cur.status }, headers);
    let sha = null, currentUpdatedAt = null;
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
      try { currentUpdatedAt = JSON.parse(b64decode(j.content)).updatedAt; } catch { /* ignore */ }
    }
    if (baseUpdatedAt && currentUpdatedAt && baseUpdatedAt !== currentUpdatedAt) {
      return reply(409, { error: 'conflict', currentUpdatedAt }, headers);
    }

    // 4. commit — stamp who saved it (kept next to updatedAt) so the UI can show
    // "last saved by …" when reconciling a conflict.
    const stamped = JSON.stringify({ updatedAt: parsed.updatedAt, updatedBy: email, subjects: parsed.subjects }, null, 2) + '\n';
    const put = await gh(api, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update revision status (${email})`,
        content: b64encode(stamped),
        sha: sha || undefined,
        branch: BRANCH,
      }),
    });
    if (!put.ok) return reply(502, { error: 'github write failed', detail: await put.text() }, headers);
    const pj = await put.json();
    return reply(200, { ok: true, commit: pj.commit?.sha, updatedAt: parsed.updatedAt, by: email }, headers);
  },
};
