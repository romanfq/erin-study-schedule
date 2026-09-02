"""Regenerate Biology content.json + state.json from the authoritative draft.

The draft (data/biology/draft_structure.txt) is the single source of truth:
  - "Topic N - Name"            → a strand
  - "Practical Skills"          → a strand
  - "- Item - <C|W|N>"          → a subtopic with status
  - "N. Item (topic) - <C|W|N>" → a practical subtopic with status

Run:  python3 tools/biology_from_draft.py
"""
from __future__ import annotations

import datetime
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
DRAFT = os.path.join(REPO, "data/biology/draft_structure.txt")

# Obvious spelling fixes in the draft (kept minimal and explicit).
TYPO = {"Monocional": "Monoclonal", "Homeostatis": "Homeostasis"}

STATUS = {"C", "W", "N"}


def slug(s: str) -> str:
    s = re.sub(r"\([^)]*\)", "", s)          # drop parentheticals for the id
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")


def fix(s: str) -> str:
    for a, b in TYPO.items():
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def parse():
    strands, cur = [], None
    board = "AQA GCSE Biology"
    for raw in open(DRAFT, encoding="utf-8"):
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        s = line.strip()
        if s.lower().startswith("biology"):
            board = fix(s)
            continue
        m = re.match(r"Topic\s+\d+\s*[-–]\s*(.+)", s)
        if m:
            cur = {"id": slug(m.group(1)), "name": fix(m.group(1)), "subtopics": []}
            strands.append(cur)
            continue
        if s.lower() == "practical skills":
            cur = {"id": "practical-skills", "name": "Practical Skills", "subtopics": []}
            strands.append(cur)
            continue
        # subtopic / practical line, ending in a status
        body, _, status = s.rpartition(" - ")
        status = status.strip().upper()
        if status not in STATUS:
            continue
        body = re.sub(r"^[-•]\s*", "", body)      # leading bullet
        body = re.sub(r"^\d+\.\s*", "", body)          # leading "N."
        title = fix(body)
        prefix = "practical-" if cur and cur["id"] == "practical-skills" else ""
        cur["subtopics"].append({"id": prefix + slug(title), "title": title, "status": status})
    return board, strands


def main():
    board, strands = parse()

    # content.json — structure only (no tier split, no rich notes yet)
    content = {"subject": "Biology", "board": board, "strands": []}
    seen = set()
    for st in strands:
        subs = []
        for s in st["subtopics"]:
            sid = s["id"]
            while sid in seen:                          # guarantee unique ids
                sid += "-2"
            seen.add(sid)
            s["id"] = sid
            subs.append({"id": sid, "title": s["title"], "tier": "F",
                         "formulae": [], "method": "", "tips": []})
        content["strands"].append({"id": st["id"], "name": st["name"], "subtopics": subs})

    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    state = {"updatedAt": stamp, "topics": {}}
    for st in strands:
        for s in st["subtopics"]:
            state["topics"][s["id"]] = {"status": s["status"], "links": [], "sessions": []}

    json.dump(content, open(os.path.join(REPO, "data/biology/content.json"), "w"), indent=2, ensure_ascii=False)
    json.dump(state, open(os.path.join(REPO, "data/biology/state.json"), "w"), indent=2, ensure_ascii=False)

    counts = {"C": 0, "W": 0, "N": 0}
    for t in state["topics"].values():
        counts[t["status"]] += 1
    print(f"strands: {len(strands)}   subtopics: {len(state['topics'])}")
    print(f"status → C:{counts['C']}  W:{counts['W']}  N:{counts['N']}")
    for st in content["strands"]:
        print(f"  {st['name']} ({len(st['subtopics'])})")


if __name__ == "__main__":
    main()
