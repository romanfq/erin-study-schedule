"""Build a subject's content.json + state.json from its draft_structure.txt.

The draft (data/<id>/draft_structure.txt) is the single source of truth:
  - first non-empty line            → the board/title line (shown as sub-header)
  - "Topic N - Name" or any heading → a strand
  - "- Item - <C|W|N>"              → a subtopic with status
  - "N. Item (note) - <C|W|N>"      → a practical subtopic with status
  - a "Practical Skills" heading    → practical subtopics get a "practical-" id

Usage:
  python3 tools/subject_from_draft.py physics --name Physics --short Phys --register
  python3 tools/subject_from_draft.py --all            # process every data/*/draft_structure.txt
"""
from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
PALETTE = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"]
STATUS = {"C", "W", "N"}


def slug(s: str) -> str:
    s = re.sub(r"\([^)]*\)", "", s)                 # drop parentheticals for the id
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def fix(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse(path: str):
    strands, cur, board = [], None, None
    for raw in open(path, encoding="utf-8"):
        s = raw.strip()
        if not s:
            continue
        body, _, st = s.rpartition(" - ")
        if st.strip().upper() in STATUS and body.strip():
            if cur is None:
                cur = {"name": "General", "subtopics": []}
                strands.append(cur)
            title = fix(re.sub(r"^\d+\.\s*", "", re.sub(r"^[-•]\s*", "", body)))
            cur["subtopics"].append({"title": title, "status": st.strip().upper()})
            continue
        if board is None:
            board = fix(s)
            continue
        m = re.match(r"Topic\s+\d+\s*[-–]\s*(.+)", s)
        cur = {"name": fix(m.group(1)) if m else fix(s), "subtopics": []}
        strands.append(cur)
    return board, strands


def build(name: str, draft_path: str):
    board, strands = parse(draft_path)
    content = {"subject": name, "board": board, "strands": []}
    topics, seen = {}, set()
    for st in strands:
        prefix = "practical-" if st["name"].strip().lower() == "practical skills" else ""
        subs = []
        for sub in st["subtopics"]:
            sid = prefix + slug(sub["title"])
            while sid in seen:
                sid += "-2"
            seen.add(sid)
            subs.append({"id": sid, "title": sub["title"], "tier": "F",
                         "formulae": [], "method": "", "tips": []})
            topics[sid] = {"status": sub["status"], "links": [], "sessions": []}
        content["strands"].append({"id": slug(st["name"]), "name": st["name"], "subtopics": subs})
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return content, {"updatedAt": stamp, "topics": topics}


def register(subject_id, name, short, colour, board):
    path = os.path.join(REPO, "data/subjects.json")
    doc = json.load(open(path))
    entry = {
        "id": subject_id, "name": name, "short": short or name, "status": "active",
        "colour": colour, "board": board,
        "content": f"data/{subject_id}/content.json", "state": f"data/{subject_id}/state.json",
    }
    subs = doc["subjects"]
    for i, s in enumerate(subs):
        if s["id"] == subject_id:
            subs[i] = {**s, **entry}
            break
    else:
        subs.append(entry)
    json.dump(doc, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")


def process(subject_id, name, short, colour, outdir, do_register, force):
    draft = os.path.join(REPO, f"data/{subject_id}/draft_structure.txt")
    if not os.path.exists(draft):
        raise SystemExit(f"no draft at {draft}")
    content, state = build(name, draft)

    out = outdir or os.path.join(REPO, f"data/{subject_id}")
    os.makedirs(out, exist_ok=True)
    sp = os.path.join(out, "state.json")
    if os.path.exists(sp) and not force:
        prev = json.load(open(sp)).get("topics", {})
        if any(t.get("links") or t.get("sessions") for t in prev.values()):
            raise SystemExit(f"{sp} has links/sessions — refusing to overwrite (use --force)")

    json.dump(content, open(os.path.join(out, "content.json"), "w"), indent=2, ensure_ascii=False)
    json.dump(state, open(sp, "w"), indent=2, ensure_ascii=False)

    if do_register and not outdir:
        register(subject_id, name, short, colour, content["board"])

    counts = {"C": 0, "W": 0, "N": 0}
    for t in state["topics"].values():
        counts[t["status"]] += 1
    print(f"{subject_id}: {len(content['strands'])} strands, {len(state['topics'])} subtopics "
          f"(C:{counts['C']} W:{counts['W']} N:{counts['N']}) → {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("id", nargs="?")
    ap.add_argument("--name")
    ap.add_argument("--short")
    ap.add_argument("--colour")
    ap.add_argument("--outdir")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--all", action="store_true", help="process every data/*/draft_structure.txt")
    args = ap.parse_args()

    existing = json.load(open(os.path.join(REPO, "data/subjects.json")))["subjects"]
    known = {s["id"] for s in existing}

    ids = ([os.path.basename(os.path.dirname(p)) for p in
            glob.glob(os.path.join(REPO, "data/*/draft_structure.txt"))]
           if args.all else [args.id])
    for i, sid in enumerate(ids):
        if not sid:
            raise SystemExit("provide a subject id, or --all")
        name = args.name or sid.replace("-", " ").title()
        colour = args.colour or PALETTE[(len(known) + i) % len(PALETTE)]
        process(sid, name, args.short, colour, args.outdir, args.register or args.all, args.force)


if __name__ == "__main__":
    main()
