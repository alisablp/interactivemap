# Pianos Across America — Interactive Map

An interactive, zoomable map of pianos restored and placed by
[Brigham Larson Pianos](https://www.brighamlarsonpianos.com), built from the
Piano Log spreadsheet.

## Features

- **Real map** — pan, pinch, and zoom from coast to coast down to street level
  (CARTO/OpenStreetMap basemap, no API key required)
- **Gold pins** at the city each piano now calls home; clusters of nearby pianos
  merge into gold badges that split apart as you zoom in
- **Red star** marks the Utah workshop
- **Search bar** — try "Steinway", "Grand", "1910", "Utah"
- **Filters** — Grand/Upright, Restoration, Heirloom, Player, Vintage Player,
  Antique, and a make dropdown
- **Pin cards** — every pin opens a card with the piano's story details and a
  "View This Piano" button linking to its page on the website
- Fully mobile-friendly

## Privacy

Only the **city and state** are ever read from the owner column. Names, phone
numbers, emails, and street addresses never leave the spreadsheet, and
`tools/build_data.py` refuses to write the data file if anything resembling
personal information slips through. Pins are placed at city centers (with a
small scatter so same-city pins don't stack), never at real addresses.

When a piano has two addresses (pickup and delivery), the pin goes to the
delivery address — approximated as the address farthest from Utah.

## Running locally

Any static file server works:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Updating the map from the Piano Log

```bash
python3 tools/build_data.py
```

This re-reads the spreadsheet, rebuilds `js/data.js`, and the map picks it up
on the next page load. (First run downloads a free city-coordinates database
and caches it.)

### Weekly update plan

Once a week, the map is refreshed from the Piano Log:

1. Run `python3 tools/build_data.py`
2. Commit and push the updated `js/data.js`

**The after-video trigger:** a *new* piano is only added to the map once it
has an **after video** (column R in the log) — that's the signal a piano's
story is ready to show. Pianos that were already on the map when this rule
was adopted are grandfathered in via `tools/baseline.json` and stay put.
To make the rule strict for everyone (drop grandfathered pianos without
videos too), delete `tools/baseline.json` and rerun the build.

## Embedding in Shopify

1. Enable **GitHub Pages** on this repo (Settings → Pages → deploy from
   `main`, root folder). The map will be live at
   `https://alisablp.github.io/interactivemap/`.
2. In Shopify admin: **Online Store → Pages → Add page** (e.g. "Piano Map").
3. In the page editor, click the **`<>`** (Show HTML) button and paste:

   ```html
   <iframe
     src="https://alisablp.github.io/interactivemap/"
     style="width:100%;height:80vh;border:0;border-radius:8px;"
     title="Pianos Across America"
     loading="lazy"></iframe>
   ```

4. Save, and add the page to your navigation menu.
