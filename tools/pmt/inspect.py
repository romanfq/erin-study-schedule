"""Gated PDF inspection for ambiguous matches — max 5 downloads per session.

For LOW-confidence worksheets whose title doesn't clearly match, download the
QP via the governor (human-like pacing, hard 5/session cap) and print the first
question so a human/subagent can confirm relevance before it is bound.

Usage:
  python3 inspect.py <pdf-url> [<pdf-url> ...]
  python3 inspect.py --session <name> <pdf-url>     # name the download budget
"""
from __future__ import annotations

import argparse
import subprocess
import sys

import governor


def first_question(pdf_path: str) -> str:
    try:
        txt = subprocess.run(
            ["pdftotext", "-f", "1", "-l", "1", "-layout", pdf_path, "-"],
            capture_output=True, text=True, timeout=30).stdout
    except FileNotFoundError:
        return "(pdftotext not installed)"
    lines = [ln.rstrip() for ln in txt.splitlines()]
    # skip PMT header/boilerplate; show the first ~40 non-empty content lines
    body = [ln for ln in lines if ln.strip()]
    return "\n".join(body[:40])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="+")
    ap.add_argument("--session", default="inspect")
    args = ap.parse_args()

    governor.reset_session(args.session)
    print(f"download budget: {governor.MAX_DOWNLOADS_PER_SESSION} (session '{args.session}')\n")
    for url in args.urls:
        used = governor.downloads_used()
        if used >= governor.MAX_DOWNLOADS_PER_SESSION:
            print(f"STOP: cap reached ({used}). Not downloading: {url}")
            break
        print(f"[{used + 1}/{governor.MAX_DOWNLOADS_PER_SESSION}] downloading (paced)…\n  {url}")
        try:
            res = governor.get(url, is_download=True)
        except RuntimeError as e:
            print("  refused:", e)
            break
        if res["status"] != 200:
            print("  HTTP", res["status"])
            continue
        print("  --- first question ---")
        print(first_question(res["body"]))
        print("  ----------------------\n")


if __name__ == "__main__":
    main()
