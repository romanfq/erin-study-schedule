"""Discover Edexcel GCSE Maths topic-question worksheet PDFs — read-only.

Route (no PDF downloads, no URL guessing):
  sitemap_index.xml  ->  page-sitemapN.xml  ->  GCSE-maths listing pages
  ->  extract pmt.* CDN "Topic-Qs/Edexcel" PDF links found on those pages.

Writes candidates.json (structured, deduped). Every request goes through the
governor (spacing + cache + identifiable UA).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse

import governor

HERE = os.path.dirname(os.path.abspath(__file__))
SITEMAP_INDEX = "https://www.physicsandmathstutor.com/sitemap_index.xml"

LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
# Hrefs are quoted and filenames contain spaces, so terminate on the quote/tag,
# not on whitespace.
DIRECT_RE = re.compile(r"https?://pmt\.physicsandmathstutor\.com/download/[^\"'<>]+?\.pdf", re.I)
ENC_RE = re.compile(r"pdf=([^\"'&<>\s]+)", re.I)


def sitemaps() -> list[str]:
    body = governor.get(SITEMAP_INDEX)["body"]
    return [u for u in LOC_RE.findall(body) if "page-sitemap" in u]


def listing_pages(max_pages: int) -> list[str]:
    """GCSE-maths topic-question pages from the sitemaps, most-relevant first.

    Keeps the per-topic '…-videos' pages (each = one worksheet's QP/MS/MA) and
    the 'gcse-questions-edexcel' master index. Skips '/past-papers/' pages, which
    are whole exam papers, not topic worksheets.
    """
    found: set[str] = set()
    for sm in sitemaps():
        body = governor.get(sm)["body"]
        for loc in LOC_RE.findall(body):
            p = urllib.parse.urlparse(loc).path.lower()
            if "past-papers" in p or "maths" not in p or "gcse" not in p:
                continue
            if p.rstrip("/").endswith("-videos") or p.rstrip("/").endswith("gcse-questions-edexcel"):
                found.add(loc)

    # Higher topic pages first (Erin's tier), then the master index, then the rest.
    def score(u: str) -> int:
        s = u.lower()
        return -(("/higher-" in s) * 3 + ("gcse-questions-edexcel" in s) * 2)
    return sorted(found, key=score)[:max_pages]


def unquote_all(u: str) -> str:
    prev = None
    while prev != u:
        prev, u = u, urllib.parse.unquote(u)
    return u


def parse_pdf(url: str) -> dict | None:
    """Pull structured fields out of a CDN download URL."""
    path = urllib.parse.urlparse(url).path
    parts = [urllib.parse.unquote(x) for x in path.split("/") if x]
    if "download" not in parts:
        return None
    seg = parts[parts.index("download") + 1:]
    low = [s.lower() for s in seg]
    if "topic-qs" not in low or "edexcel" not in low:
        return None
    tier = next((s for s in seg if s.lower() in ("higher", "foundation")), "")
    doc = next((s for s in seg if s.upper() in ("QP", "MS", "MA")), "")
    set_ = next((s for s in seg if s.lower().startswith("set-")), "")
    filename = seg[-1][:-4] if seg[-1].lower().endswith(".pdf") else seg[-1]
    # topic area = first segment after the Set-... folder (Set-4 layout)
    area = ""
    if set_ in seg:
        after = seg[seg.index(set_) + 1:]
        area = after[0] if after else ""
    label = re.sub(r"\s*\((?:H|F)\)\s*", " ", filename)
    label = re.sub(r"\b(QP|MS|MA)\b", "", label).strip(" -")
    return {
        "url": url, "filename": filename, "label": label or filename,
        "doc": doc.upper(), "tier": tier, "set": set_, "area": area,
        "segments": seg,
    }


def extract(html: str) -> list[str]:
    # URLs are often JSON-escaped inside page data (https:\/\/…\/download\/…),
    # or unicode-escaped (/). Normalise before matching.
    html = (html.replace("&amp;", "&")
                .replace("\\/", "/")
                .replace("\\u002F", "/").replace("\\u002f", "/"))
    urls = set(DIRECT_RE.findall(html))
    for enc in ENC_RE.findall(html):
        dec = unquote_all(enc)
        if "pmt.physicsandmathstutor.com/download/" in dec and dec.lower().endswith(".pdf"):
            urls.add(dec.split("#")[0])
    # store with spaces percent-encoded (PMT/browser convention)
    return sorted(u.strip().replace(" ", "%20") for u in urls)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-pages", type=int, default=40)
    args = ap.parse_args()

    pages = listing_pages(args.max_pages)
    print(f"Candidate listing pages: {len(pages)}")
    candidates: dict[str, dict] = {}
    pages_with_hits = 0
    for url in pages:
        html = governor.get(url)["body"]
        pdfs = extract(html)
        hits = 0
        for pdf in pdfs:
            info = parse_pdf(pdf)
            if not info:
                continue
            info["source_page"] = url
            candidates[info["url"]] = info
            hits += 1
        if hits:
            pages_with_hits += 1
            print(f"  {hits:3d} pdfs  {url}")

    out = sorted(candidates.values(), key=lambda c: (c["area"], c["tier"], c["filename"]))
    with open(os.path.join(HERE, "candidates.json"), "w") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print(f"\nPages with worksheet links: {pages_with_hits}")
    print(f"Total Edexcel Topic-Qs PDFs: {len(out)}  -> candidates.json")
    tiers = {}
    for c in out:
        tiers[c["tier"] or "?"] = tiers.get(c["tier"] or "?", 0) + 1
    print("By tier:", tiers)


if __name__ == "__main__":
    main()
