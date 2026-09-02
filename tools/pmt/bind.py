"""Merge approved proposal links into data/maths/state.json — additively.

Never removes or reorders Roman's existing links, and never touches status or
sessions. Adds only new links (deduped by normalised URL), bumps updatedAt.

Usage:
  python3 bind.py --dry-run          # write to state.preview.json, show diff summary
  python3 bind.py                    # write state.json in place
  python3 bind.py --include-low      # also bind LOW-confidence subtopics
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
STATE = os.path.join(REPO, "data/maths/state.json")


def canon(url: str) -> str:
    """Normalise for dedupe: unwrap the pdf-pages viewer, decode, lowercase host."""
    u = url
    if "pdf-pages" in u and "pdf=" in u:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
        if q.get("pdf"):
            u = q["pdf"][0]
    prev = None
    while prev != u:
        prev, u = u, urllib.parse.unquote(u)
    p = urllib.parse.urlparse(u)
    return (p.netloc + p.path).lower().strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-low", action="store_true")
    args = ap.parse_args()

    state = json.load(open(STATE))
    prop = json.load(open(os.path.join(HERE, "proposal.json")))["proposal"]

    added_total, changed = 0, []
    for sid, entry in prop.items():
        if entry["confidence"] != "HIGH" and not args.include_low:
            continue
        topic = state["topics"].setdefault(sid, {"status": "N", "links": [], "sessions": []})
        topic.setdefault("links", [])
        have = {canon(l["url"]) for l in topic["links"]}
        added = 0
        for link in entry["links"]:
            if canon(link["url"]) not in have:
                topic["links"].append(link)
                have.add(canon(link["url"]))
                added += 1
        if added:
            changed.append((sid, added))
            added_total += added

    state["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    out = os.path.join(REPO, "data/maths/state.preview.json") if args.dry_run else STATE
    with open(out, "w") as fh:
        json.dump(state, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"{'DRY-RUN → ' + out if args.dry_run else 'wrote ' + out}")
    print(f"subtopics changed: {len(changed)}   links added: {added_total}")
    for sid, n in changed:
        print(f"  +{n}  {sid}")


if __name__ == "__main__":
    main()
