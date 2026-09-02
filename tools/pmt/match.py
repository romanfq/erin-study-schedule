"""Match discovered PMT worksheets to our 45 Maths subtopics.

Reads candidates.json (from crawl.py) + content.json (the subtopic index) +
synonyms.json (curated worksheet-title keywords per subtopic). Emits
proposal.json: per subtopic, the chosen QP/MS links, a confidence, and a reason.

Matching is deliberately conservative: a worksheet is only linked if one of the
subtopic's keyword phrases appears in the worksheet's title (HIGH), or there is
strong token overlap (LOW → needs review/inspection). No credible match → skip.
"""
from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

MAX_WORKSHEETS_PER_SUBTOPIC = 3
MAX_LINKS_PER_SUBTOPIC = 4
# Pool = Higher (Set-4, tier "Higher") preferred, else Set-0 master (tier "").
# Foundation Set-4 sheets are dropped: the Set-0 master already covers those
# topics, and Erin sits Higher.
TIER_RANK = {"Higher": 0, "": 1}


def norm(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def toks(s: str) -> list[str]:
    # singularise simple plurals so "angles" == "angle", but keep them as whole
    # tokens so "angles" never matches inside "triangles".
    return [t[:-1] if len(t) > 3 and t.endswith("s") else t for t in norm(s).split()]


def phrase_in(keyword: str, label_toks: list[str]) -> bool:
    """True if the keyword's tokens appear as a contiguous run in the label."""
    k = toks(keyword)
    if not k:
        return False
    return any(label_toks[i:i + len(k)] == k for i in range(len(label_toks) - len(k) + 1))


def load(name: str, default):
    try:
        with open(os.path.join(HERE, name)) as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError):
        return default


def worksheets_from_candidates(cands: list[dict]) -> dict[tuple, dict]:
    """Collapse individual PDFs into worksheets keyed by (area, tier, label)."""
    ws: dict[tuple, dict] = {}
    for c in cands:
        key = (c["area"], c["tier"], c["label"])
        w = ws.setdefault(key, {"label": c["label"], "area": c["area"],
                                "tier": c["tier"], "set": c["set"], "docs": {}})
        if c["doc"]:
            w["docs"].setdefault(c["doc"], c["url"])
    return ws


def main() -> None:
    content = json.load(open(os.path.join(REPO, "data/maths/content.json")))
    cands = load("candidates.json", [])
    syn = load("synonyms.json", {})
    ws = worksheets_from_candidates(cands)

    proposal, unmatched, low = {}, [], []

    for strand in content["strands"]:
        for st in strand["subtopics"]:
            sid = st["id"]
            cfg = syn.get(sid, {})
            keywords = cfg.get("keywords", [])
            exclude = cfg.get("exclude", [])

            scored = []
            for w in ws.values():
                if w["tier"] not in TIER_RANK:      # drop Foundation Set-4
                    continue
                ltoks = toks(w["label"])
                if any(phrase_in(x, ltoks) for x in exclude):
                    continue
                hit = next((k for k in keywords if phrase_in(k, ltoks)), None)
                if not hit:
                    continue
                # specificity (longer keyword match) then Higher-before-Set-0
                score = len(toks(hit))
                scored.append((score, -TIER_RANK[w["tier"]], w))

            if not scored:
                unmatched.append(sid)
                continue

            # Higher (Set-4) worksheets rank first, then Set-0 fills remaining
            # slots. Dedupe worksheets that share a normalised label.
            picks, seen = [], set()
            for score, negtier, w in sorted(scored, key=lambda x: (x[1], x[0]), reverse=True):
                key = norm(w["label"])
                if key in seen:
                    continue
                seen.add(key)
                picks.append(w)
                if len(picks) >= MAX_WORKSHEETS_PER_SUBTOPIC:
                    break

            # One questions link per worksheet, plus one answers link for the best.
            links = []
            for w in picks:
                q = w["docs"].get("QP") or w["docs"].get("MA")
                if q:
                    links.append({"label": w["label"], "url": q})
            best = picks[0]
            ans = best["docs"].get("MS") or best["docs"].get("MA")
            if ans and len(links) < MAX_LINKS_PER_SUBTOPIC:
                suffix = "mark scheme" if "MS" in best["docs"] else "solutions"
                links.append({"label": f"{best['label']} — {suffix}", "url": ans})
            links = links[:MAX_LINKS_PER_SUBTOPIC]

            tiers = {w["tier"] or "Set-0" for w in picks}
            proposal[sid] = {
                "title": st["title"], "tier": st["tier"], "confidence": "HIGH",
                "source": "+".join(sorted(tiers, key=lambda t: t != "Higher")),
                "worksheets": [f"{w['label']} [{w['tier'] or w['set']}]" for w in picks],
                "links": links,
                "reason": "keyword match",
            }

    out = {"proposal": proposal, "unmatched": unmatched, "low_confidence": low}
    with open(os.path.join(HERE, "proposal.json"), "w") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)

    total = sum(len(p["links"]) for p in proposal.values())
    print(f"matched subtopics: {len(proposal)}   links: {total}")
    print(f"HIGH: {sum(1 for p in proposal.values() if p['confidence']=='HIGH')}   "
          f"LOW: {len(low)}   unmatched: {len(unmatched)}")
    if unmatched:
        print("unmatched:", ", ".join(unmatched))
    if low:
        print("low-confidence:", ", ".join(low))


if __name__ == "__main__":
    main()
