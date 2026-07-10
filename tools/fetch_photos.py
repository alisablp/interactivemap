#!/usr/bin/env python3
"""Resolve before/after photo folders (Piano Log columns N and P) to a
showcase image per folder, cached in tools/photos.json.

Folders are public Google Drive links. The first image (alphabetical) is
used — the shop's convention names the hero front-angle shot 001.jpg, and
walk-around sets start at the front.

Usage:
    python3 tools/fetch_photos.py            # resolve missing entries
    python3 tools/fetch_photos.py --refresh  # re-resolve everything
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_data import CSV_URL, COL_OWNER, COL_URL, piano_key  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTOS_PATH = os.path.join(HERE, "photos.json")

COL_BEFORE, COL_AFTER = 13, 15  # N, P

FOLDER_PAT = re.compile(r"https://drive\.google\.com/drive/folders/([\w-]+)")
ENTRY_PAT = re.compile(r'flip-entry" id="entry-([\w-]+)')
TITLE_PAT = re.compile(r'flip-entry-title">([^<]+)')
IMAGE_EXT = re.compile(r"\.(jpe?g|png|webp|heic|heif)$", re.I)


def folder_images(folder_id, cache):
    """ALL image file IDs in a public Drive folder, name-sorted (empty list
    if inaccessible). Cached as a list so photo curation can always see
    every candidate, not just the first."""
    if isinstance(cache.get(folder_id), list):
        return cache[folder_id]
    url = "https://drive.google.com/embeddedfolderview?id=%s#grid" % folder_id
    try:
        html = urllib.request.urlopen(url, timeout=30).read().decode("utf-8", "ignore")
        ids = ENTRY_PAT.findall(html)
        names = TITLE_PAT.findall(html)
        pairs = [(n, i) for i, n in zip(ids, names) if IMAGE_EXT.search(n.strip())]
        pairs.sort(key=lambda t: t[0].lower())
        cache[folder_id] = [p[1] for p in pairs]
    except Exception:
        cache[folder_id] = []  # private, deleted, or network hiccup
    time.sleep(0.15)
    return cache[folder_id]


def main():
    refresh = "--refresh" in sys.argv
    photos = {}
    folder_cache = {}
    if os.path.exists(PHOTOS_PATH) and not refresh:
        saved = json.load(open(PHOTOS_PATH))
        photos = saved.get("pianos", {})
        folder_cache = saved.get("folders", {})

    print("fetching piano log …")
    raw = urllib.request.urlopen(CSV_URL, timeout=120).read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(raw)))

    todo = []
    for r in rows[2:]:
        if len(r) <= COL_URL or not r[COL_OWNER].strip():
            continue
        key = piano_key(r)
        b = FOLDER_PAT.search(r[COL_BEFORE]) if len(r) > COL_BEFORE else None
        a = FOLDER_PAT.search(r[COL_AFTER]) if len(r) > COL_AFTER else None
        if b or a:
            todo.append((key, b.group(1) if b else None, a.group(1) if a else None))

    print("resolving %d pianos' photo folders …" % len(todo))
    for n, (key, bfold, afold) in enumerate(todo, 1):
        b_ids = folder_images(bfold, folder_cache) if bfold else []
        a_ids = folder_images(afold, folder_cache) if afold else []
        prior = photos.get(key, {})
        photos[key] = {
            # keep an existing curated pick; default new pianos to the first
            # image until the weekly review picks the best angle
            "b": prior.get("b") or (b_ids[0] if b_ids else None),
            "a": prior.get("a") or (a_ids[0] if a_ids else None),
        }
        if n % 50 == 0:
            print("  %d/%d" % (n, len(todo)))
            json.dump({"pianos": photos, "folders": folder_cache},
                      open(PHOTOS_PATH, "w"), indent=0)

    json.dump({"pianos": photos, "folders": folder_cache},
              open(PHOTOS_PATH, "w"), indent=0)
    both = sum(1 for v in photos.values() if v["b"] and v["a"])
    only_a = sum(1 for v in photos.values() if v["a"] and not v["b"])
    print("done: %d pianos have before+after, %d after-only" % (both, only_a))


if __name__ == "__main__":
    main()
