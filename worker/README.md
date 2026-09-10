# gcse-schedule-updater (Cloudflare Worker)

Authenticated save endpoint for `data/state.json`. The site POSTs the new file
plus a Google ID token; the Worker verifies the token, checks the email against
an allow-list, and commits to the repo with a server-held GitHub token.

URL: https://gcse-schedule-updater.roman-fq.workers.dev

## Deploy

```
npm i -g wrangler
wrangler login                 # authorise your Cloudflare account (interactive)
cd worker
wrangler deploy                # uploads src/index.js
```

(Or paste `src/index.js` into the Worker's dashboard editor and deploy there.)

## Secrets / variables

Set in Cloudflare → your Worker → **Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `GITHUB_TOKEN` | Secret | fine-grained PAT, Contents: read/write on `romanfq/erin-study-schedule` |
| `ALLOWED_EMAILS` | Secret | `roman.fq@gmail.com,erin@…` (comma-separated, lowercase) |
| `GOOGLE_CLIENT_ID` | Text | the OAuth Web client id, e.g. `…apps.googleusercontent.com` |

CLI alternative:
```
wrangler secret put GITHUB_TOKEN
wrangler secret put ALLOWED_EMAILS
# GOOGLE_CLIENT_ID is public — a plain var is fine (dashboard "Text" or [vars] in wrangler.toml)
```

## Contract

`POST` JSON:
```json
{ "idToken": "<google id token>", "content": "<data/state.json as a string>", "baseUpdatedAt": "<updatedAt the client loaded>" }
```
Responses: `200 {ok,commit,updatedAt,by}` · `403 not authorised` · `409 {error:"conflict",currentUpdatedAt}` · `4xx/502` on bad input / GitHub errors.
