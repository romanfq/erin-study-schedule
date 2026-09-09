"""Build a subject's content.json from its draft_structure.txt and merge its
statuses into the consolidated data/state.json (preserving links/sessions).

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


BULLET = re.compile(r"^\s*([-•]|\d+\.)")            # a subtopic line
STAT = re.compile(r"[-_\s]+([cwn])\s*$", re.I)      # trailing C/W/N, however it's glued
LEAD = re.compile(r"^\s*(\d+\.\s*|[-•\s]+)")        # leading bullet(s) / number
TOPIC = re.compile(r"Topic\s+\d+[^-–]*[-–]\s*(.+)", re.I)


def parse(path: str):
    """Tolerant parse: subtopic lines start with a bullet/number and end in a
    C/W/N (glued by any of - _ or space); everything else non-first is a heading.
    Items with no trailing status default to N and are flagged (nostatus)."""
    strands, cur, board = [], None, None
    for raw in open(path, encoding="utf-8"):
        s = raw.strip()
        if not s:
            continue
        if not BULLET.match(s):
            if board is None:
                board = fix(s)
            else:
                mt = TOPIC.match(s)
                cur = {"name": fix(mt.group(1)) if mt else fix(s), "subtopics": []}
                strands.append(cur)
            continue
        m = STAT.search(s)
        status = m.group(1).upper() if m else None
        title = fix(LEAD.sub("", s[:m.start()] if m else s))
        if cur is None:
            cur = {"name": "General Topic", "subtopics": []}
            strands.append(cur)
        cur["subtopics"].append({"title": title, "status": status or "N", "nostatus": status is None})
    return board or "", strands


def build(name_override, draft_path: str):
    title, strands = parse(draft_path)
    file_name, _, board = title.partition(" - ")   # "Chemistry - AQA" -> name, board
    name = fix(name_override) if name_override else fix(file_name) or "Subject"
    content = {"subject": name, "board": fix(board), "strands": []}
    topics, seen, nostatus = {}, set(), []
    for st in strands:
        prefix = "practical-" if "practical" in st["name"].lower() else ""
        subs = []
        for sub in st["subtopics"]:
            sid = prefix + slug(sub["title"])
            while sid in seen:
                sid += "-2"
            seen.add(sid)
            subs.append({"id": sid, "title": sub["title"], "tier": "F",
                         "formulae": [], "method": "", "tips": []})
            topics[sid] = {"status": sub["status"], "links": [], "sessions": []}
            if sub.get("nostatus"):
                nostatus.append(sub["title"])
        content["strands"].append({"id": slug(st["name"]), "name": st["name"], "subtopics": subs})
    return content, topics, nostatus, name


def register(subject_id, name, short, colour, board):
    path = os.path.join(REPO, "data/subjects.json")
    doc = json.load(open(path))
    entry = {
        "id": subject_id, "name": name, "short": short or name, "status": "active",
        "colour": colour, "board": board,
        "content": f"data/{subject_id}/content.json",
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


def now_stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def merge_state(subject_id, topics):
    """Write this subject's topics into the consolidated data/state.json,
    preserving any existing links/sessions for surviving topic ids. Only this
    subject's section is touched."""
    path = os.path.join(REPO, "data/state.json")
    try:
        doc = json.load(open(path))
    except (FileNotFoundError, ValueError):
        doc = {"updatedAt": "", "subjects": {}}
    doc.setdefault("subjects", {})
    existing = doc["subjects"].get(subject_id, {}).get("topics", {})
    merged = {}
    for tid, t in topics.items():
        prev = existing.get(tid, {})
        merged[tid] = {"status": t["status"], "links": prev.get("links", []), "sessions": prev.get("sessions", [])}
    doc["subjects"][subject_id] = {"topics": merged}
    doc["updatedAt"] = now_stamp()
    json.dump(doc, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")


def process(subject_id, name, short, colour, outdir, do_register, force):
    draft = os.path.join(REPO, f"data/{subject_id}/draft_structure.txt")
    if not os.path.exists(draft):
        raise SystemExit(f"no draft at {draft}")
    content, topics, nostatus, name = build(name, draft)

    if outdir:   # dry run — write content + a standalone state for inspection only
        os.makedirs(outdir, exist_ok=True)
        json.dump(content, open(os.path.join(outdir, "content.json"), "w"), indent=2, ensure_ascii=False)
        json.dump({"updatedAt": now_stamp(), "topics": topics},
                  open(os.path.join(outdir, "state.json"), "w"), indent=2, ensure_ascii=False)
    else:
        json.dump(content, open(os.path.join(REPO, f"data/{subject_id}/content.json"), "w"), indent=2, ensure_ascii=False)
        merge_state(subject_id, topics)
        if do_register:
            register(subject_id, name, short, colour, content["board"])

    counts = {"C": 0, "W": 0, "N": 0}
    for t in topics.values():
        counts[t["status"]] += 1
    where = outdir or "data/state.json + content.json"
    print(f"{subject_id}: {len(content['strands'])} strands, {len(topics)} subtopics "
          f"(C:{counts['C']} W:{counts['W']} N:{counts['N']}) → {where}")
    if nostatus:
        print(f"  ⚠ {len(nostatus)} item(s) had no C/W/N status, defaulted to N: "
              + ", ".join(nostatus[:8]) + (" …" if len(nostatus) > 8 else ""))


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
        colour = args.colour or PALETTE[(len(known) + i) % len(PALETTE)]
        # name defaults to the file's title line (handled in build)
        process(sid, args.name, args.short, colour, args.outdir, args.register or args.all, args.force)


if __name__ == "__main__":
    main()
