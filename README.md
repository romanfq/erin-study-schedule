# Erin · Study Schedule

A static revision tracker hosted on GitHub Pages. It shows each subject's
revision checklist with an **N / W / C** status per subtopic (Not started /
Working on it / Confident), full topic notes seeded from the GCSE guide, a
manual review scheduler, and a calendar with a prominent 3-day view.

No build step, no server, no database. Just static files. `git push` deploys.

## How saving works

The committed file `data/<subject>/state.json` is the single source of truth.
You never edit it by hand — the UI is the only writer:

1. Tap the big **N/W/C** badge (or a checklist chip) to cycle the status;
   add review sessions and exercise links on a topic page.
2. Press **Update schedule file** → copy or download the produced `state.json`.
3. Save it over `data/<subject>/state.json` and commit:
   ```
   git add data/maths/state.json
   git commit -m "Update maths status"
   git push
   ```

Edits are held in the browser (localStorage) until you export, so the UI stays
live mid-session. When a newer `state.json` is committed, the next load on any
device picks it up automatically.

## Preview locally

```
python3 serve.py      # → http://localhost:8000
```
This mirrors GitHub Pages, including clean routes like `/maths/circles`.

## Structure

```
index.html            landing (subject picker)
404.html              SPA redirect shim for clean deep links
app.css
js/                   config, router, store, views, app (vanilla ES modules)
data/
  subjects.json       list of subjects
  profile.json        student, tier, timezone
  maths/
    content.json      notes, formulae, exam technique (reference — rarely changes)
    state.json        status + review sessions + links (edited via the UI)
```

## Adding a subject

1. Add an entry to `data/subjects.json` with `"status": "active"` and paths to
   its `content` and `state` files.
2. Create `data/<subject>/content.json` in the same shape as `maths` (strands →
   subtopics with `title`, `tier`, `method`, `formulae`, `tips`).
3. Create `data/<subject>/state.json` with an `N` entry per subtopic id, or let
   the UI treat missing topics as `N` and export a full file on first Update.

## Notes

- Content is common to AQA (8300), Edexcel (1MA1) and OCR (J560). Always check
  your board's current formulae sheet and paper instructions.
- Higher-only topics are tagged `H`; the Foundation/Higher toggle hides or shows
  them (remembered per device).
