# Pianos Across America — Interactive Map

An interactive, zoomable map of pianos restored and placed by
[Brigham Larson Pianos](https://www.brighamlarsonpianos.com), built from the
Piano Log spreadsheet.

## Features

- **Real map** — pan, pinch, and zoom from coast to coast down to street level
  (CARTO/OpenStreetMap basemap, no API key required)
- **Every piano visible** — all pianos appear at once as 3D gold dots at
  country level; as you zoom in, each dot becomes a gold map pin. Same-city
  pianos fan out in a spiral so each one stays clickable
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

**The after-photo trigger:** a piano appears on the map only when it has a
**showable after photo** (column P in the log must resolve to a real image) —
that's the signal a piano's story is ready to show. No exceptions: every pin's
card displays its after photo. Add an after-photo Drive link to a row and the
piano joins the map on the next build.

Locations are read three ways: "City, ST" patterns, zip codes (validated so
house numbers and invoice figures don't masquerade as zips), and street
addresses ending in a bare Utah city name.

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
