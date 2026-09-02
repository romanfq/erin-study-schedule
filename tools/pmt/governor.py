"""Politeness governor for the PMT crawler.

Every network request in this toolset must go through `get()`. It enforces:
  - single-threaded, jittered spacing between requests (via a shared timestamp
    lockfile, so multiple processes/agents coordinate through one token bucket);
  - an on-disk cache for page GETs (so re-runs don't re-hit the site);
  - a descriptive, identifiable User-Agent;
  - a hard cap of 5 PDF downloads per session, at human-like speed.

Standard library only — no third-party deps.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "cache")
STATE_FILE = os.path.join(HERE, ".ratelimit")

UA = ("erin-study-schedule PMT link crawler "
      "(personal educational use; contact roman.fq@gmail.com)")

# Spacing (seconds). Page GETs are light; downloads are deliberately slow.
PAGE_MIN, PAGE_MAX = 5.0, 9.0
DOWNLOAD_MIN, DOWNLOAD_MAX = 25.0, 55.0
MAX_DOWNLOADS_PER_SESSION = 5


def _load_state() -> dict:
    try:
        with open(STATE_FILE) as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError):
        return {"last": 0.0, "downloads": 0, "session": None}


def _save_state(st: dict) -> None:
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(st, fh)
    os.replace(tmp, STATE_FILE)


def reset_session(session_id: str) -> None:
    """Start a fresh download budget for a named session."""
    st = _load_state()
    st["session"] = session_id
    st["downloads"] = 0
    _save_state(st)


def downloads_used() -> int:
    return _load_state().get("downloads", 0)


def _wait(min_s: float, max_s: float) -> None:
    st = _load_state()
    gap = time.time() - st.get("last", 0.0)
    target = random.uniform(min_s, max_s)
    if gap < target:
        time.sleep(target - gap)
    st = _load_state()
    st["last"] = time.time()
    _save_state(st)


def _cache_path(url: str) -> str:
    h = hashlib.sha256(url.encode()).hexdigest()[:20]
    return os.path.join(CACHE_DIR, h + ".json")


def get(url: str, *, is_download: bool = False, force: bool = False) -> dict:
    """Fetch a URL through the governor.

    Returns {"status", "url", "final_url", "body"} (body is text for pages,
    a local file path for downloads). Page responses are cached; downloads are
    counted against the session cap and never cached.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)

    if not is_download and not force:
        cp = _cache_path(url)
        if os.path.exists(cp):
            with open(cp) as fh:
                cached = json.load(fh)
            cached["cached"] = True
            return cached

    if is_download:
        st = _load_state()
        if st.get("downloads", 0) >= MAX_DOWNLOADS_PER_SESSION:
            raise RuntimeError(
                f"Download cap reached ({MAX_DOWNLOADS_PER_SESSION}/session). Refusing.")
        _wait(DOWNLOAD_MIN, DOWNLOAD_MAX)
    else:
        _wait(PAGE_MIN, PAGE_MAX)

    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            final_url = resp.geturl()
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        result = {"status": e.code, "url": url, "final_url": url, "body": ""}
        if not is_download:
            with open(_cache_path(url), "w") as fh:
                json.dump(result, fh)
        return result

    if is_download:
        st = _load_state()
        st["downloads"] = st.get("downloads", 0) + 1
        _save_state(st)
        os.makedirs(os.path.join(HERE, "downloads"), exist_ok=True)
        name = hashlib.sha256(url.encode()).hexdigest()[:16] + ".pdf"
        path = os.path.join(HERE, "downloads", name)
        with open(path, "wb") as fh:
            fh.write(raw)
        return {"status": status, "url": url, "final_url": final_url, "body": path}

    result = {"status": status, "url": url, "final_url": final_url,
              "body": raw.decode("utf-8", "replace")}
    with open(_cache_path(url), "w") as fh:
        json.dump(result, fh)
    return result


if __name__ == "__main__":
    import sys
    r = get(sys.argv[1] if len(sys.argv) > 1 else "https://www.physicsandmathstutor.com/robots.txt")
    print(r["status"], r["final_url"], "cached" if r.get("cached") else "fresh")
    print(r["body"][:300])
