#!/usr/bin/env python3
"""Regenerate js/data.js from the Piano Log.

Reads only city + state from the OWNER column — names, phone numbers,
emails, and street addresses never leave the spreadsheet.

Usage:
    python3 tools/build_data.py

Requires internet on first run (downloads the GeoNames cities database,
cached next to this script afterwards).
"""

import csv
import io
import json
import math
import os
import re
import urllib.request
import zipfile

SHEET_ID = "1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc"
CSV_URL = "https://docs.google.com/spreadsheets/d/%s/export?format=csv" % SHEET_ID
GEONAMES_URL = "https://download.geonames.org/export/dump/cities500.zip"

HERE = os.path.dirname(os.path.abspath(__file__))
CITIES_CACHE = os.path.join(HERE, "cities500.txt")
OUT_PATH = os.path.join(HERE, "..", "js", "data.js")

# Column indexes (0-based): B=1 owner, C=2 serial, E=4 year, F=5 make, G=6 model,
# J=9 category tags, R=17 after video, BO=66 marketing title, BV=73 Shopify URL
COL_OWNER, COL_SERIAL, COL_YEAR, COL_MAKE, COL_MODEL, COL_CAT = 1, 2, 4, 5, 6, 9
COL_AFTER_VIDEO, COL_TITLE, COL_URL = 17, 66, 73

# Trigger rule: a NEW piano is only added to the map once it has an after
# video (column R). Pianos already on the map when this rule was adopted are
# grandfathered in via tools/baseline.json.
BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baseline.json")

PROVO = (40.2338, -111.6585)  # delivery rule reference point

STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
          "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split()
CITY_PAT = re.compile(r"([A-Za-z][A-Za-z .'-]{2,32}?),?\s+(" + "|".join(STATES) + r")\b")

UPRIGHT_CATS = {"upright", "tall upright", "console", "spinet", "studio"}


def load_cities():
    if not os.path.exists(CITIES_CACHE):
        print("downloading GeoNames cities500 …")
        data = urllib.request.urlopen(GEONAMES_URL, timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            with open(CITIES_CACHE, "wb") as f:
                f.write(z.read("cities500.txt"))
    lookup = {}
    for line in open(CITIES_CACHE, encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if f[8] != "US":
            continue
        name, lat, lng, admin1, pop = f[1], float(f[4]), float(f[5]), f[10], int(f[14] or 0)
        keys = [(name.lower(), admin1)]
        for alt in f[3].split(","):
            alt = alt.strip().lower()
            if alt and re.fullmatch(r"[a-z .'-]+", alt):
                keys.append((alt, admin1))
        for k in keys:
            if k not in lookup or pop > lookup[k][2]:
                lookup[k] = (lat, lng, pop)
    lookup[("slc", "UT")] = lookup[("salt lake city", "UT")]
    return lookup


def match_city(lookup, raw, st):
    """Match the tail words of a raw fragment against known city names,
    so street fragments like 'Bocowood Dr Dallas' resolve to Dallas."""
    words = re.sub(r"[^A-Za-z '-]", " ", raw).split()
    for n in (3, 2, 1):
        if len(words) >= n:
            cand = " ".join(words[-n:]).lower()
            if (cand, st) in lookup:
                lat, lng, _ = lookup[(cand, st)]
                return " ".join(w.capitalize() for w in cand.split()), lat, lng
    return None


def dist(a, b):
    return math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.78)


def piano_key(r):
    """Stable identity for a row: serial number when present, else title-ish."""
    serial = re.sub(r"\W", "", r[COL_SERIAL]).lower() if len(r) > COL_SERIAL else ""
    if serial:
        return "sn:" + serial
    return "t:" + "|".join(x.strip().lower() for x in (r[COL_YEAR], r[COL_MAKE], r[COL_MODEL], r[COL_OWNER][:20]))


def has_after_video(r):
    v = r[COL_AFTER_VIDEO].lower() if len(r) > COL_AFTER_VIDEO else ""
    return "http" in v or "youtu" in v or "drive" in v


def main():
    lookup = load_cities()
    print("fetching piano log …")
    raw = urllib.request.urlopen(CSV_URL, timeout=120).read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(raw)))

    baseline = set()
    if os.path.exists(BASELINE_PATH):
        baseline = set(json.load(open(BASELINE_PATH)))

    out, skipped_no_video = [], 0
    for r in rows[2:]:
        if len(r) <= COL_URL or not r[COL_OWNER].strip():
            continue
        # Trigger rule: new pianos need an after video; grandfathered ones don't.
        if piano_key(r) not in baseline and not has_after_video(r):
            skipped_no_video += 1
            continue
        locs = []
        for m in CITY_PAT.finditer(r[COL_OWNER]):
            hit = match_city(lookup, m.group(1), m.group(2))
            if hit and (hit[0], m.group(2)) not in [(l[0], l[1]) for l in locs]:
                locs.append((hit[0], m.group(2), hit[1], hit[2]))
        if not locs:
            continue
        # Delivery rule: with multiple addresses, pin the one farthest from Utah.
        city, st, lat, lng = max(locs, key=lambda l: dist((l[2], l[3]), PROVO))

        year, make, model = r[COL_YEAR].strip(), r[COL_MAKE].strip(), r[COL_MODEL].strip()
        if not (year or make):
            continue
        if not re.fullmatch(r"(18|19|20)\d\d", year):
            year = ""
        cats = [c.strip() for c in r[COL_CAT].split(",") if c.strip()]
        url = r[COL_URL].strip()
        if not url.startswith("http") or url.rstrip("/").endswith("/products"):
            url = ""
        title = r[COL_TITLE].strip() or " ".join(x for x in [year, make, model] if x) or "Piano"
        typ = ("Grand" if any("grand" in c.lower() for c in cats)
               else "Upright" if any(c.lower() in UPRIGHT_CATS for c in cats)
               else "")
        out.append(dict(t=title[:80], y=year, mk=make[:30], md=model[:30], tp=typ,
                        c=cats[:8], u=url, ct=city, st=st,
                        la=round(lat, 4), lo=round(lng, 4)))

    # Safety net: refuse to write anything that smells like PII.
    blob = json.dumps(out)
    assert not re.search(r"@|\d{3}[-.)]\s?\d{3}[-.]\d{4}", blob), "possible PII detected — aborting"

    with open(OUT_PATH, "w") as f:
        f.write("// Auto-generated from the Piano Log — city/state only, no personal information.\n")
        f.write("// Regenerate with tools/build_data.py\n")
        f.write("const PIANOS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote %d pianos to js/data.js" % len(out))
    if skipped_no_video:
        print("held back %d rows that are new since the baseline and have no after video yet" % skipped_no_video)


if __name__ == "__main__":
    main()
