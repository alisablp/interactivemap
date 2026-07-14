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
# J=9 category tags, P=15 after photos, BO=66 marketing title, BV=73 Shopify URL
COL_OWNER, COL_SERIAL, COL_SUMMARY, COL_YEAR, COL_MAKE, COL_MODEL, COL_CAT = 1, 2, 3, 4, 5, 6, 9
COL_AFTER_PHOTOS, COL_TITLE, COL_URL = 15, 66, 73

# Trigger rule: a piano appears on the map when it has a showable AFTER
# photo, OR when it sits below the log's "SOLD" divider row and has a
# product URL in column BV. Pianos without a showable after photo get a
# restoration-story card instead of photos (before-only photos are never
# shown — pre-restoration pianos don't photograph well).
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ZIPS_URL = "https://download.geonames.org/export/zip/US.zip"

PROVO = (40.2338, -111.6585)  # delivery rule reference point

STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
          "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split()
CITY_PAT = re.compile(r"([A-Za-z][A-Za-z .'-]{2,32}?),?\s+(" + "|".join(STATES) + r")\b")

# "Ewa Beach, Hawaii" — full state names, comma required to stay conservative
STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY"
}
FULLSTATE_PAT = re.compile(
    r"([A-Za-z][A-Za-z .'-]{2,32}?),\s*(" +
    "|".join(sorted(STATE_NAMES, key=len, reverse=True)) + r")\b", re.I)

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
        names = {name.lower()}
        for alt in f[3].split(","):
            alt = alt.strip().lower()
            if alt and re.fullmatch(r"[a-z .'-]+", alt):
                names.add(alt)
        # normalize: strip periods, and index both St/Saint spellings
        for n in list(names):
            plain = n.replace(".", "")
            names.add(plain)
            if plain.startswith("saint "):
                names.add("st " + plain[6:])
            elif plain.startswith("st "):
                names.add("saint " + plain[3:])
        for n in names:
            k = (n, admin1)
            if k not in lookup or pop > lookup[k][2]:
                lookup[k] = (lat, lng, pop)
    lookup[("slc", "UT")] = lookup[("salt lake city", "UT")]
    return lookup


def load_zips():
    cache = os.path.join(HERE, "USzips.txt")
    if not os.path.exists(cache):
        print("downloading GeoNames US zip codes …")
        data = urllib.request.urlopen(ZIPS_URL, timeout=120).read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            with open(cache, "wb") as f:
                f.write(z.read("US.txt"))
    zips = {}
    for line in open(cache, encoding="utf-8"):
        f = line.split("\t")
        if len(f) > 10 and f[9] and f[10]:
            zips[f[1]] = (f[2].title(), f[4], float(f[9]), float(f[10]))
    return zips


# A 5-digit number only counts as a zip when it reads like the END of an
# address: preceded by a word (city or state), and not the start of a street
# address ("12173 N Royal Troon Rd") or a dollar/invoice figure.
ZIP_PAT = re.compile(
    r"([A-Za-z][A-Za-z.,]*)[,\s]+(\d{5})(?:-\d{4})?\b"
    r"(?!\s+(?:[NSEW]\b|North\b|South\b|East\b|West\b|"
    r"(?:[A-Za-z'-]+\s+){0,3}(?:St|Street|Dr|Drive|Ln|Lane|Rd|Road|Ave|Avenue|"
    r"Way|Ct|Court|Cir|Circle|Blvd|Loop|Pl|Place|Pkwy|Parkway)\b))", re.I)

ZIP_WORD_BLACKLIST = {"invoice", "inv", "cogs", "qbo", "check", "tag", "po", "order",
                      "acct", "account", "deposit", "paid", "owes", "balance", "total",
                      "price", "quote", "serial", "sn", "phone", "call", "text", "job"}

# street address that ends in a bare city name with no state or zip,
# e.g. "1234 Main St Orem" — matched against Utah cities only
STREET_SUFFIX = (r"(?:St|Street|Dr|Drive|Ln|Lane|Rd|Road|Ave|Avenue|Way|Ct|Court|Cir|Circle|"
                 r"Blvd|Loop|Cove|Pl|Place|Pkwy|Parkway|Trail|Bend|Ridge|View|N|S|E|W|"
                 r"North|South|East|West)\.?,?")
ADDR_PAT = re.compile(r"\d{2,5}\s+[A-Za-z0-9 .'-]{2,40}?" + STREET_SUFFIX +
                      r"\s+([A-Za-z .'-]{3,25})", re.I)


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


def has_after_photo(r):
    v = r[COL_AFTER_PHOTOS].strip().lower() if len(r) > COL_AFTER_PHOTOS else ""
    if not v or v in ("x", "no", "n/a", "na", "-", "none", "tbd"):
        return False
    return True


PICKUP_WORDS = re.compile(r"pick\s?-?up|picked\s+up|pickup", re.I)
DELIVERY_WORDS = re.compile(r"deliver|ship", re.I)

# "pick up in Denver" / "DELIVERY: Miami" — a keyword followed by a bare
# city name with no state; accepted only when the whole fragment is a known
# city (so "delivered to Sandy Johnson" never matches Sandy, UT)
KEYWORD_CITY_PAT = re.compile(
    r"(pick\s?-?up|pick(?:ed|ing)\s+up|pickup|deliver(?:y|ed|ing)?|ship(?:ping|ped)?)"
    r"\s*(?:to|in|from|at)?\s*:?\s*([A-Z][A-Za-z .'-]{2,25}?)\s*(?:$|[|,;(\n-])", re.M)


def kind_of(owner, pos):
    """Classify a location match as pickup / delivery / plain by the words
    just before it."""
    before = owner[max(0, pos - 30):pos]
    if PICKUP_WORDS.search(before):
        return "pickup"
    if DELIVERY_WORDS.search(before):
        return "delivery"
    return "plain"


def find_locations(lookup, zips, owner):
    """All location candidates in an owner cell — 'City, ST' patterns, zip
    codes, street addresses ending in a bare Utah city name, and bare cities
    right after pickup/delivery keywords — each tagged with its kind."""
    locs = []

    def add(city, st, lat, lng, kind, src):
        for j, l in enumerate(locs):
            if (l[0], l[1]) == (city, st):
                if src == "text" and l[5] == "zip":
                    locs[j] = (city, st, lat, lng, kind, src)
                return
        locs.append((city, st, lat, lng, kind, src))

    for m in CITY_PAT.finditer(owner):
        hit = match_city(lookup, m.group(1), m.group(2))
        if hit:
            add(hit[0], m.group(2), hit[1], hit[2], kind_of(owner, m.start()), "text")
    for m in FULLSTATE_PAT.finditer(owner):
        st = STATE_NAMES[m.group(2).lower()]
        hit = match_city(lookup, m.group(1), st)
        if hit:
            add(hit[0], st, hit[1], hit[2], kind_of(owner, m.start()), "text")
    for m in ZIP_PAT.finditer(owner):
        word, z = m.group(1).strip(".,").lower(), m.group(2)
        if word not in ZIP_WORD_BLACKLIST and "#" not in word and z in zips:
            city, st, lat, lng = zips[z]
            # a mistyped zip can point at the wrong coast — when a spelled-out
            # state sits right before the zip, it outranks the zip's own state
            before = owner[max(0, m.start() - 28):m.end(1)].lower()
            written = [ab for name, ab in STATE_NAMES.items() if name in before]
            if written and st not in written:
                continue
            # snap to the city's public center — a zip area's own centroid
            # is neighborhood-level, which is more precision than we want
            if (city.lower(), st) in lookup:
                lat, lng, _ = lookup[(city.lower(), st)]
            add(city, st, lat, lng, kind_of(owner, m.start()), "zip")
    for m in ADDR_PAT.finditer(owner):
        words = m.group(1).strip().lower().split()
        for n in (3, 2, 1):
            if len(words) >= n:
                cand = " ".join(words[:n])
                if (cand, "UT") in lookup:
                    lat, lng, _ = lookup[(cand, "UT")]
                    add(" ".join(w.capitalize() for w in cand.split()), "UT", lat, lng,
                        kind_of(owner, m.start()), "text")
                    break
    for m in KEYWORD_CITY_PAT.finditer(owner):
        frag = m.group(2).strip().lower()
        if len(frag) < 3:
            continue
        # whole fragment must be a known city; pick the most populous state
        best = None
        for (name, st), (lat, lng, pop) in lookup.items():
            if name == frag and (best is None or pop > best[4]):
                best = (name, st, lat, lng, pop)
        if best and best[4] >= 20000:
            kind = "pickup" if PICKUP_WORDS.search(m.group(1)) else "delivery"
            add(frag.title(), best[1], best[2], best[3], kind, "text")
    return locs


def main():
    lookup = load_cities()
    zips = load_zips()
    print("fetching piano log …")
    raw = urllib.request.urlopen(CSV_URL, timeout=120).read().decode("utf-8")
    rows = list(csv.reader(io.StringIO(raw)))

    # showcase photos resolved by tools/fetch_photos.py (piano_key -> {b, a})
    photos = {}
    photos_path = os.path.join(TOOLS_DIR, "photos.json")
    if os.path.exists(photos_path):
        photos = json.load(open(photos_path)).get("pianos", {})

    # locate the "SOLD" divider row — a section header whose only content in
    # the first columns is the word SOLD (currently in the owner column)
    sold_idx = None
    for i, r in enumerate(rows):
        first = [c.strip() for c in r[:8]]
        if "SOLD" in (c.upper() for c in first) and sum(1 for c in first if c) == 1:
            sold_idx = i
            break
    print("SOLD divider at spreadsheet row", (sold_idx + 1) if sold_idx is not None else "NOT FOUND")

    out, skipped = [], 0
    for i, r in enumerate(rows):
        if i < 2:
            continue
        if len(r) <= COL_URL or not r[COL_OWNER].strip():
            continue
        below_sold = sold_idx is not None and i > sold_idx
        locs = find_locations(lookup, zips, r[COL_OWNER])
        if not locs:
            continue
        # Farthest-journey rule: the pin marks the far end of the piano's
        # journey — whichever mentioned location lies farthest from Utah,
        # delivery or not. Zip-derived spots count only when the cell has no
        # written city/state (a mistyped zip is likelier than a mistyped city).
        pool = [l for l in locs if l[5] == "text"] or locs
        city, st, lat, lng = max(pool, key=lambda l: dist((l[2], l[3]), PROVO))[:4]

        year, make, model = r[COL_YEAR].strip(), r[COL_MAKE].strip(), r[COL_MODEL].strip()
        summary = r[COL_SUMMARY].strip()
        if not (year or make or summary):
            continue
        if not re.fullmatch(r"(18|19|20)\d\d", year):
            # a year logged as NEW is meaningful — new pianos get their own
            # story wording on the card
            year = "New" if year.lower().startswith("new") else ""
        cats = [c.strip() for c in r[COL_CAT].split(",") if c.strip()]
        # QRS = modern player system: pianos not tagged Player in column J
        # but mentioning QRS in owner (B) or summary (D) count as players
        if "Player" not in cats and re.search(r"\bQRS\b", r[COL_OWNER] + " " + summary, re.I):
            cats.append("Player")
        url = r[COL_URL].strip()
        if not url.startswith("http") or url.rstrip("/").endswith("/products"):
            url = ""
        title = (r[COL_TITLE].strip() or " ".join(x for x in [year, make, model] if x)
                 or summary or "Piano")
        typehints = " ".join(cats).lower() or (title + " " + summary).lower()
        typ = ("Grand" if "grand" in typehints
               else "Upright" if any(w in typehints for w in UPRIGHT_CATS)
               else "")
        rec = dict(t=title[:80], y=year, mk=make[:30], md=model[:30], tp=typ,
                   c=cats[:8], u=url, ct=city, st=st,
                   la=round(lat, 4), lo=round(lng, 4))
        ph = photos.get(piano_key(r))
        if ph:
            for side, field in (("b", "bp"), ("a", "ap")):
                fid = ph.get(side)
                if not fid:
                    continue
                # prefer the local (name-blurred) copy in photos/; fall back
                # to the Drive CDN only if no local copy exists
                local = os.path.join(TOOLS_DIR, "..", "photos", fid + ".jpg")
                rec[field] = ("photos/" + fid + ".jpg") if os.path.exists(local) else fid
        # before-only photos are never shown — pre-restoration pianos don't
        # photograph well
        if "ap" not in rec:
            rec.pop("bp", None)
        # qualify: showable after photo, OR below the SOLD divider with a
        # product URL, OR tagged Family Heirloom — the latter two without
        # photos get a restoration-story card
        if "ap" not in rec and not (below_sold and rec["u"]) and "Family Heirloom" not in cats:
            skipped += 1
            continue
        out.append(rec)

    # Safety net: refuse to write anything that smells like PII.
    blob = json.dumps(out)
    assert not re.search(r"@|\d{3}[-.)]\s?\d{3}[-.]\d{4}", blob), "possible PII detected — aborting"

    with open(OUT_PATH, "w") as f:
        f.write("// Auto-generated from the Piano Log — city/state only, no personal information.\n")
        f.write("// Regenerate with tools/build_data.py\n")
        f.write("const PIANOS = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote %d pianos to js/data.js" % len(out))
    if skipped:
        print("held back %d rows (no after photo and not sold-with-URL)" % skipped)


if __name__ == "__main__":
    main()
