#!/usr/bin/env python3
"""Download any picked showcase photos that don't yet have a local copy in
photos/, OCR them (macOS Vision via tools/ocr.swift), and blur regions that
contain customer names, phone numbers, or emails.

Privacy rule: the map must never show a customer's name — shop tags in
photos sometimes carry them. Brand decals (Steinway, Hailun, "...PIANOS")
are never blurred.

Usage:
    python3 tools/blur_photos.py            # process photos missing locally
    python3 tools/blur_photos.py --all      # re-scan every local photo
"""

import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PHOTOS_DIR = os.path.join(REPO, "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)

sys.path.insert(0, HERE)
from build_data import CSV_URL, COL_OWNER, COL_MAKE, COL_URL, piano_key  # noqa: E402

STREETISH = {"north", "south", "east", "west", "street", "drive", "lane", "road",
             "avenue", "court", "circle", "blvd", "way", "main", "center", "park",
             "the", "and", "delivery", "pickup", "sold", "paid", "full", "consignment",
             "deliver", "gmail", "yahoo", "hotmail", "com", "net", "org", "moving",
             "address", "upon", "completion", "house", "steps", "owner", "daughter",
             "mother", "father", "wife", "husband"}
PHONE_PAT = re.compile(r"\d{3}[-. )]\s?\d{3,4}[-. ]?\d{2,4}|@")
NAME_PAT = re.compile(r"\b([A-Z][a-zA-Z'’-]{2,15})\s+([A-Z][a-zA-Z'’-]{2,18})\b")


def main():
    rescan_all = "--all" in sys.argv
    print("fetching piano log …")
    raw = urllib.request.urlopen(CSV_URL, timeout=120).read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(raw)))

    # brand words (never blurred — they're painted on the pianos)
    brands = {"pianos", "piano", "company", "sons", "bros", "grand", "upright",
              "rebuilt", "restored", "quality", "made", "established", "york",
              "boston", "chicago"}
    for r in rows[2:]:
        if len(r) > COL_MAKE and r[COL_MAKE].strip():
            for w in re.findall(r"[A-Za-z'&-]{3,}", r[COL_MAKE].lower()):
                brands.add(w)

    # per-piano owner tokens and global full-name pairs
    key_tokens, names = {}, set()
    for r in rows[2:]:
        if len(r) <= COL_URL or not r[COL_OWNER].strip():
            continue
        toks = set()
        for w in re.findall(r"\b[A-Z][a-zA-Z'’-]{2,17}\b|\b[A-Z]{3,18}\b", r[COL_OWNER]):
            lw = w.lower()
            if lw not in brands and lw not in STREETISH:
                toks.add(lw)
        key_tokens[piano_key(r)] = toks
        for m in NAME_PAT.finditer(r[COL_OWNER]):
            a, b = m.group(1).lower(), m.group(2).lower()
            if a not in brands and b not in brands and a not in STREETISH and b not in STREETISH:
                names.add((a, b))

    photos = json.load(open(os.path.join(HERE, "photos.json")))["pianos"]

    # only photos actually referenced by the map (js/data.js) are processed,
    # so the repo doesn't accumulate photos of unmapped pianos
    ref = None
    data_js = os.path.join(REPO, "js", "data.js")
    if os.path.exists(data_js):
        pins = json.loads(open(data_js).read().split("= ", 1)[1].rstrip(";\n"))
        ref = set()
        for p in pins:
            for f in ("bp", "ap"):
                v = p.get(f)
                if v:
                    ref.add(v.split("/")[-1].replace(".jpg", ""))

    fid_tokens = {}
    for key, entry in photos.items():
        for side in ("b", "a"):
            fid = entry.get(side)
            if fid and (ref is None or fid in ref):
                fid_tokens.setdefault(fid, set()).update(key_tokens.get(key, set()))

    # download photos missing locally
    todo = [fid for fid in fid_tokens
            if rescan_all or not os.path.exists(os.path.join(PHOTOS_DIR, fid + ".jpg"))]
    if not todo:
        print("no new photos to process")
        return

    def dl(fid):
        p = os.path.join(PHOTOS_DIR, fid + ".jpg")
        if not os.path.exists(p) or rescan_all:
            subprocess.run(["curl", "-sL", "--max-time", "30",
                "https://lh3.googleusercontent.com/d/%s=w800" % fid, "-o", p], check=False)

    print("downloading %d photos …" % len(todo))
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(dl, todo))
    todo = [f for f in todo if os.path.exists(os.path.join(PHOTOS_DIR, f + ".jpg"))
            and os.path.getsize(os.path.join(PHOTOS_DIR, f + ".jpg")) > 1000]

    # OCR
    ocr = {}
    for i in range(0, len(todo), 60):
        batch = [os.path.join(PHOTOS_DIR, f + ".jpg") for f in todo[i:i+60]]
        out = subprocess.run(["swift", os.path.join(HERE, "ocr.swift")] + batch,
                             capture_output=True, text=True, timeout=1800).stdout
        for line in out.strip().splitlines():
            try:
                j = json.loads(line)
                ocr[os.path.basename(j["file"])[:-4]] = j.get("items", [])
            except Exception:
                pass
        print("  ocr %d/%d" % (min(i + 60, len(todo)), len(todo)))

    def sensitive(fid, text):
        if PHONE_PAT.search(text):
            return True
        words = re.findall(r"[a-z'’-]{3,}", text.lower())
        for i in range(len(words) - 1):
            if (words[i], words[i + 1]) in names:
                return True
        own = fid_tokens.get(fid, set())
        return any(len(w) >= 4 and w in own and w not in brands for w in words)

    blurred, failed = 0, 0
    for fid in todo:
        regs = [it for it in ocr.get(fid, []) if sensitive(fid, it["text"])]
        if not regs:
            continue
        src = os.path.join(PHOTOS_DIR, fid + ".jpg")
        probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", src],
            capture_output=True, text=True).stdout.strip()
        try:
            W, H = [int(x) for x in probe.split(",")]
        except Exception:
            continue
        fc, n_ok = "[0:v]copy[base]", 0
        for n, r in enumerate(regs):
            x = max(0, int((r["x"] - r["w"] * 0.3) * W))
            y = max(0, int((r["y"] - r["h"] * 0.5) * H))
            w = min(W - x, int(r["w"] * 1.6 * W))
            h = min(H - y, int(r["h"] * 2.0 * H))
            x -= x % 2; y -= y % 2; w -= w % 2; h -= h % 2
            if w < 8 or h < 8:
                continue
            rad = min(16, max(2, min(w, h) // 2 - 1))
            crad = max(1, min(rad // 2, min(w, h) // 4 - 1))
            fc += ";[0:v]crop=%d:%d:%d:%d,boxblur=%d:2:%d:2[b%d];[base][b%d]overlay=%d:%d[base]" % (
                w, h, x, y, rad, crad, n, n, x, y)
            n_ok += 1
        if not n_ok:
            continue
        fc = fc.rsplit("[base]", 1)[0] + "[out]"
        tmp = src + ".tmp.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
            "-filter_complex", fc, "-map", "[out]", "-q:v", "4", tmp],
            capture_output=True, text=True)
        if os.path.exists(tmp) and os.path.getsize(tmp) > 1000:
            os.replace(tmp, src)
            blurred += 1
        else:
            failed += 1
    print("done: %d photos processed, %d blurred, %d blur failures" % (len(todo), blurred, failed))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
