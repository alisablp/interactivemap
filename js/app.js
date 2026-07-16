/* Pianos Across America — Brigham Larson Pianos
   Zoomable/pannable map (Leaflet) with gold pins, search, and filters. */

(function () {
  "use strict";

  var WORKSHOP = { lat: 40.2969, lng: -111.6946, label: "Brigham Larson Pianos — Orem, Utah" };

  // ---------- map ----------
  // USA only: panning is locked to the composed map (lower 48 with Alaska
  // and Hawaii pulled in below the Southwest, albers-atlas style).
  // Slightly padded so popups near the edges have room to auto-pan into view.
  var US_BOUNDS = L.latLngBounds([15, -136], [54, -63]);

  // maxZoom stops at city scale — visitors can never zoom to house level,
  // reinforcing that pins mark cities, not addresses
  // phones need to zoom out further than desktops to fit the whole country
  var IS_SMALL = window.matchMedia("(max-width: 640px)").matches;
  var map = L.map("map", {
    center: [39.5, -98.35],
    zoom: 4,
    minZoom: IS_SMALL ? 2.5 : 4,
    maxZoom: 11,
    zoomSnap: 0.25,
    scrollWheelZoom: true,
    maxBounds: US_BOUNDS,
    maxBoundsViscosity: 1.0
  });

  // ---------- Alaska & Hawaii relocation ----------
  // Their geometry and pins are translated + scaled in Mercator space to
  // sit aesthetically below the Southwest while staying fully interactive.
  var MERC = L.Projection.SphericalMercator;
  function makeRelocator(anchor, target, scale) {
    var A = MERC.project(L.latLng(anchor[0], anchor[1]));
    var T = MERC.project(L.latLng(target[0], target[1]));
    return function (lat, lng) {
      var p = MERC.project(L.latLng(lat, lng));
      return MERC.unproject(L.point(T.x + (p.x - A.x) * scale, T.y + (p.y - A.y) * scale));
    };
  }
  // Hawaii is pulled in below the Southwest (it has pianos); Alaska stays
  // at its true far-north position — with no pianos there, it isn't drawn
  // in the composition.
  var relocateHI = makeRelocator([20.7, -157.0], [23.8, -105.5], 1.55);

  function displayLatLng(p) {
    if (p.st === "HI") return relocateHI(p.la, p.lo);
    return L.latLng(p.la, p.lo);
  }

  // CARTO Voyager: clean, Google-style basemap (no API key required).
  // Terrain and labels are separate layers: the US mask sits between them,
  // so city names near borders and coasts never get sliced off.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  map.createPane("labels");
  map.getPane("labels").style.zIndex = 450;      // above the mask (400)…
  map.getPane("labels").style.pointerEvents = "none"; // …but never blocks clicks

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    pane: "labels"
  }).addTo(map);

  map.zoomControl.setPosition("topright");
  map.attributionControl.setPrefix(""); // required tile credits only, no Leaflet branding

  // ---------- geolocation: fly the map to the visitor's neighborhood ----------
  var LocateControl = L.Control.extend({
    options: { position: "topright" },
    onAdd: function () {
      var box = L.DomUtil.create("div", "leaflet-bar locate-ctrl");
      var a = L.DomUtil.create("a", "", box);
      a.href = "#";
      a.title = "Pianos near you";
      a.setAttribute("aria-label", "Show the map near your location");
      a.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
        '<line x1="12" y1="1.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22.5"/>' +
        '<line x1="1.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22.5" y2="12"/></svg>';
      L.DomEvent.on(a, "click", function (e) {
        L.DomEvent.stop(e);
        if (!navigator.geolocation) return;
        box.classList.add("locating");
        navigator.geolocation.getCurrentPosition(function (pos) {
          box.classList.remove("locating");
          var here = L.latLng(pos.coords.latitude, pos.coords.longitude);
          if (US_BOUNDS.contains(here)) {
            map.flyTo(here, 9, { duration: 1.8 });
          } else {
            map.flyTo([39.5, -98.35], 4.5, { duration: 1.4 }); // abroad — show the whole story
          }
        }, function () {
          box.classList.remove("locating");
        }, { timeout: 8000, maximumAge: 300000 });
      });
      return box;
    }
  });
  map.addControl(new LocateControl());

  // open with the full composition — lower 48 plus the pulled-in AK & HI
  var HOME_VIEW = L.latLngBounds([19.5, -126], [49.4, -66.9]);
  map.fitBounds(HOME_VIEW);

  // Mask out everything beyond the US border (Canada, Mexico, oceans)
  // with the site's cream, leaving a fine gold outline around the country.
  // spans three world-widths so no ocean peeks past the date line
  var WORLD_RING = [[-89.9, -540], [-89.9, 540], [89.9, 540], [89.9, -540]];
  var MASK_STYLE = {
    stroke: true, color: "#c9a227", weight: 1.2,
    fill: true, fillColor: "#e9dfc6", fillOpacity: 1, interactive: false
  };

  function ringCentroid(ring) {
    var la = 0, lo = 0;
    ring.forEach(function (ll) { la += ll[0]; lo += ll[1]; });
    return { lat: la / ring.length, lng: lo / ring.length };
  }

  // fetch with retries — if the border data fails to load, the mask and
  // clips would silently vanish, so never give up on the first try
  function fetchJSON(url, tries) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).catch(function (err) {
      if (tries > 0) {
        return new Promise(function (resolve) { setTimeout(resolve, 1200); })
          .then(function () { return fetchJSON(url, tries - 1); });
      }
      throw err;
    });
  }

  fetchJSON("https://cdn.jsdelivr.net/npm/us-atlas@3/nation-10m.json", 3)
    .then(function (topo) {
      var nation = topojson.feature(topo, topo.objects.nation);
      var geoms = nation.type === "FeatureCollection"
        ? nation.features.map(function (f) { return f.geometry; })
        : [nation.geometry];
      var rings = [];
      geoms.forEach(function (g) {
        var polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
        polys.forEach(function (poly) {
          poly.forEach(function (ring) {
            rings.push(ring.map(function (pt) { return [pt[1], pt[0]]; }));
          });
        });
      });

      // split the country's outlines into lower 48 / Alaska / Hawaii
      var lower48 = [], alaska = [], hawaii = [];
      rings.forEach(function (ring) {
        var c = ringCentroid(ring);
        if (c.lat > 24 && c.lat < 50 && c.lng > -125.5 && c.lng < -66) lower48.push(ring);
        else if (c.lat > 50 && c.lng < -129) alaska.push(ring);
        else if (c.lat > 18 && c.lat < 23.5 && c.lng > -161 && c.lng < -154) hawaii.push(ring);
        // anything else (Puerto Rico, far Aleutians) stays under the mask
      });

      // only the lower 48 shows through the cream — AK & HI are drawn
      // relocated below as clean land-colored shapes
      L.polygon([WORLD_RING].concat(lower48), MASK_STYLE).addTo(map);

      var RELOC_STYLE = {
        stroke: true, color: "#c9a227", weight: 1.2,
        fill: true, fillColor: "#211d17", fillOpacity: 1, interactive: false
      };
      function drawRelocated(rings, relocate) {
        var moved = rings.map(function (ring) {
          return ring.map(function (ll) { return relocate(ll[0], ll[1]); });
        });
        L.polygon(moved, RELOC_STYLE).addTo(map);
      }
      drawRelocated(hawaii, relocateHI);

      // state-style label for the relocated region
      [["HAWAII", [21.2, -105.5]]].forEach(function (t) {
        L.marker(t[1], {
          icon: L.divIcon({ className: "region-label", html: t[0], iconSize: [80, 14], iconAnchor: [40, 7] }),
          interactive: false,
          keyboard: false
        }).addTo(map);
      });

      // state borders as a crisp light-tan vector layer (the tile filter
      // washes out the basemap's own lines)
      fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
        .then(function (r) { return r.json(); })
        .then(function (topo) {
          var borders = topojson.mesh(topo, topo.objects.states, function (a, b) { return a !== b; });
          L.geoJSON(borders, {
            style: { color: "#5f5133", weight: 1, opacity: .95, fill: false },
            interactive: false
          }).addTo(map);
        })
        .catch(function () { /* cosmetic */ });

      // hide the Great Lakes' open water under the same cream
      fetch("https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_lakes.geojson")
        .then(function (r) { return r.json(); })
        .then(function (lakes) {
          var GREAT = ["Lake Superior", "Lake Michigan", "Lake Huron", "Lake Erie", "Lake Ontario"];
          L.geoJSON(lakes, {
            filter: function (f) { return GREAT.indexOf(f.properties.name) !== -1; },
            style: { stroke: true, color: "#a08a4f", weight: 1, fill: true, fillColor: "#e9dfc6", fillOpacity: 1 },
            interactive: false
          }).addTo(map);
        })
        .catch(function () { /* cosmetic */ });

      // Clip both the tile layer and the label layer to the US border:
      // nothing outside the country ever renders — labels stay American,
      // and no tinted ocean can flash from under the mask mid-zoom.
      var labelsPane = map.getPane("labels");
      var tilePane = map.getPane("tilePane");
      function updateClips() {
        var d = lower48.map(function (ring) {
          return "M" + ring.map(function (ll) {
            var pt = map.latLngToLayerPoint(ll);
            return Math.round(pt.x) + " " + Math.round(pt.y);
          }).join(" L ") + " Z";
        }).join(" ");
        labelsPane.style.clipPath = 'path("' + d + '")';
        tilePane.style.clipPath = 'path("' + d + '")';
      }
      updateClips();
      map.on("zoomend viewreset", updateClips);
    })
    .catch(function () { /* mask is cosmetic — map still works without it */ });

  // ---------- gold markers ----------
  // Far out: every piano is a 3D gold dot. Zooming in, dots become gold pins.
  // polished gold/brass teardrop: dome top, straight taper — high-gloss
  // metal banding, hard specular streak, sky highlight on the dome.
  // Pianos with a before/after photo gallery wear the Ruby Crown: a
  // brand-red jewel set into the dome, rimmed in bright gold.
  function pinSVG(w, h, ruby) {
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#7c5c0e"/><stop offset=".16" stop-color="#c9a227"/>' +
      '<stop offset=".33" stop-color="#ffe9a0"/><stop offset=".47" stop-color="#e7c256"/>' +
      '<stop offset=".62" stop-color="#a5811f"/><stop offset=".78" stop-color="#6e5210"/>' +
      '<stop offset=".92" stop-color="#a5811f"/><stop offset="1" stop-color="#77590e"/></linearGradient>' +
      '<radialGradient id="gpd" cx=".5" cy=".1" r=".5">' +
      '<stop offset="0" stop-color="#fff8dc" stop-opacity=".95"/><stop offset=".6" stop-color="#fff8dc" stop-opacity=".2"/>' +
      '<stop offset="1" stop-color="#fff8dc" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="gps" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".75" stop-color="#ffffff" stop-opacity=".25"/>' +
      '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M20 54 A40 40 0 1 1 100 54 L61.5 158 A2.5 2.5 0 0 1 58.5 158 Z" transform="translate(-4 2)" fill="#6e5210" opacity=".5"/>' +
      '<path d="M20 54 A40 40 0 1 1 100 54 L61.5 158 A2.5 2.5 0 0 1 58.5 158 Z" fill="url(#gp)"/>' +
      '<path d="M20 54 A40 40 0 1 1 100 54 L61.5 158 A2.5 2.5 0 0 1 58.5 158 Z" fill="url(#gpd)"/>' +
      '<path d="M42 26 C37 44 38 78 45 108 L52 116 C47 84 46 46 50 24 Z" fill="url(#gps)"/>' +
      '<path d="M76 30 C79 46 78 72 73 96 L70 100 C74 74 75 48 72 28 Z" fill="#fff4cd" opacity=".38"/>' +
      '<ellipse cx="60" cy="150" rx="2.6" ry="4" fill="#ffe9a0" opacity=".55"/>' +
      (ruby
        ? '<circle cx="60" cy="36" r="14" fill="#7c1515"/>' +
          '<circle cx="60" cy="36" r="11.5" fill="#9e2020"/>' +
          '<ellipse cx="55.5" cy="31.5" rx="4.5" ry="3" fill="#e8746a" opacity=".85" transform="rotate(-24 55.5 31.5)"/>' +
          '<circle cx="60" cy="36" r="14" fill="none" stroke="#ffe9a0" stroke-width="2"/>'
        : '') +
      '<path d="M20 54 A40 40 0 1 1 100 54 L61.5 158 A2.5 2.5 0 0 1 58.5 158 Z" fill="none" stroke="#5f470c" stroke-width="1.4" stroke-opacity=".7"/></svg>';
  }

  function dotSVG(d) {
    return '<svg width="' + d + '" height="' + d + '" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><radialGradient id="gd" cx=".35" cy=".28" r=".85">' +
      '<stop offset="0" stop-color="#fff6cf"/><stop offset=".3" stop-color="#f2d270"/>' +
      '<stop offset=".62" stop-color="#c9a227"/><stop offset="1" stop-color="#6e5210"/></radialGradient></defs>' +
      '<circle cx="12" cy="12" r="10.4" fill="url(#gd)" stroke="#6e5210" stroke-width="1"/>' +
      '<ellipse cx="8.6" cy="7.6" rx="3.2" ry="1.9" fill="#ffffff" opacity=".8" transform="rotate(-24 8.6 7.6)"/></svg>';
  }

  // "Molten Drop" — solid 3D gold teardrops at every zoom, scaled with the view
  var iconCache = {};
  function iconForZoom(z, ruby) {
    var h = z <= 5 ? 19 : z < 7 ? 24 : z < 9 ? 29 : 37;
    var w = Math.round(h * 120 / 170);
    var key = "pin" + h + (ruby ? "r" : "");
    return iconCache[key] || (iconCache[key] = L.divIcon({
      className: "gold-pin",
      html: pinSVG(w, h, ruby),
      iconSize: [w, h],
      iconAnchor: [w / 2, h],
      popupAnchor: [0, -h + 3]
    }));
  }

  // ---------- device-aware card opening ----------
  // Phones get a bottom sheet (always fully visible); larger screens get a
  // map popup that auto-pans fully into view.
  function isPhone() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  var sheetBackdrop = L.DomUtil.create("div", "sheet-backdrop", document.body);
  var sheet = L.DomUtil.create("div", "sheet", document.body);
  function closeSheet() {
    sheet.classList.remove("open");
    sheetBackdrop.classList.remove("open");
    routeGlow.clearLayers();
  }
  sheetBackdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSheet();
  });

  function openCard(latlng, html) {
    if (isPhone()) {
      sheet.innerHTML = "<button class='sheet-close' aria-label='Close'>&times;</button>" + html;
      sheet.querySelector(".sheet-close").addEventListener("click", closeSheet);
      sheetBackdrop.classList.add("open");
      sheet.classList.add("open");
    } else {
      var pop = L.popup({
        maxWidth: 270,
        autoPanPaddingTopLeft: L.point(16, 16),
        autoPanPaddingBottomRight: L.point(16, 16)
      }).setLatLng(latlng).setContent(html).openOn(map);
      // Near the top edge the locked bounds can stop auto-pan short, which
      // would clip the card — flip it to open below the pin instead.
      var el = pop.getElement();
      if (el) {
        var h = el.offsetHeight;
        var y = map.latLngToContainerPoint(pop.getLatLng()).y;
        var mapH = map.getSize().y;
        if (y - h - 20 < 0) {
          if (y + h + 60 < mapH) {
            pop.options.offset = L.point(0, h + 52);
            L.DomUtil.addClass(el, "popup-flipped");
            pop.update();
          } else {
            // no room above or below (short window) — use the sheet
            map.closePopup(pop);
            sheet.innerHTML = "<button class='sheet-close' aria-label='Close'>&times;</button>" + html;
            sheet.querySelector(".sheet-close").addEventListener("click", closeSheet);
            sheetBackdrop.classList.add("open");
            sheet.classList.add("open");
          }
        }
      }
    }
  }

  // workshop star
  var workshopHTML = "<div class='pcard'><div class='strip'></div><div class='pad'><h3>The Workshop</h3><div class='meta'>" + WORKSHOP.label + "</div><a class='btn' href='https://www.brighamlarsonpianos.com' target='_blank' rel='noopener'>Visit Us</a></div></div>";
  L.marker([WORKSHOP.lat, WORKSHOP.lng], {
    icon: L.divIcon({ className: "home-star", html: "<span>&#9733;</span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
    title: WORKSHOP.label
  }).addTo(map).on("click", function () { openCard([WORKSHOP.lat, WORKSHOP.lng], workshopHTML); });

  // ---------- delivery routes ----------
  // A faint gold spiderweb radiates from the Orem workshop to every visible
  // pin at country zoom; clicking a pin lights its route with a glowing arc.
  var routeWeb = L.layerGroup().addTo(map);
  var routeGlow = L.layerGroup().addTo(map);
  var lastVisibleMarkers = [];
  var WORKSHOP_LL = L.latLng(WORKSHOP.lat, WORKSHOP.lng);

  function arcPoints(from, to) {
    var P1 = MERC.project(from), P2 = MERC.project(to);
    var dx = P2.x - P1.x, dy = P2.y - P1.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var mx = (P1.x + P2.x) / 2 - (dy / len) * len * 0.18;
    var my = (P1.y + P2.y) / 2 + (dx / len) * len * 0.18;
    var pts = [];
    for (var i = 0; i <= 32; i++) {
      var t = i / 32, u = 1 - t;
      pts.push(MERC.unproject(L.point(
        u * u * P1.x + 2 * u * t * mx + t * t * P2.x,
        u * u * P1.y + 2 * u * t * my + t * t * P2.y
      )));
    }
    return pts;
  }

  function rebuildWeb() {
    routeWeb.clearLayers();
    if (map.getZoom() > 6) return; // the web is a country-view effect
    lastVisibleMarkers.forEach(function (m) {
      routeWeb.addLayer(L.polyline(arcPoints(WORKSHOP_LL, m.getLatLng()), {
        color: "#c9a227", weight: 0.8, opacity: 0.14, interactive: false
      }));
    });
  }

  function drawGlowRoute(dest) {
    routeGlow.clearLayers();
    var pts = arcPoints(WORKSHOP_LL, dest);
    routeGlow.addLayer(L.polyline(pts, {
      color: "#e8c96a", weight: 5, opacity: 0.22, interactive: false, className: "route-glow-under"
    }));
    routeGlow.addLayer(L.polyline(pts, {
      color: "#ffe9a0", weight: 1.8, opacity: 0.95, interactive: false, className: "route-glow"
    }));
  }
  map.on("popupclose", function () { routeGlow.clearLayers(); });

  // Leaflet's transformed map pane flattens popup z-index, so cards can't
  // layer above the floating controls — instead, fade the controls away
  // whenever an open card or peek overlaps them.
  function updateControlsDim() {
    var controls = document.querySelector(".controls");
    if (!controls) return;
    var c = controls.getBoundingClientRect();
    var overlap = false;
    document.querySelectorAll(".leaflet-popup, .leaflet-tooltip").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!(r.bottom < c.top || r.top > c.bottom || r.right < c.left || r.left > c.right)) overlap = true;
    });
    document.body.classList.toggle("card-over-controls", overlap);
  }
  ["popupopen", "popupclose", "tooltipopen", "tooltipclose", "move", "zoomend"].forEach(function (ev) {
    map.on(ev, function () {
      requestAnimationFrame(updateControlsDim);
      setTimeout(updateControlsDim, 350); // again after Leaflet's fade-out removes the element
    });
  });

  // ---------- marker layer (no clustering — every piano stays visible) ----------
  var pianoLayer = L.layerGroup().addTo(map);

  map.on("zoomend", function () {
    var z = map.getZoom();
    markers.forEach(function (m) { m.setIcon(iconForZoom(z, m._ruby)); });
    rebuildWeb();
  });

  // ---------- popup card ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  var CARD_TAGS = ["Restoration", "Family Heirloom", "Player", "Vintage Player", "Antique", "Premier", "Art Case", "Concert Grand"];

  // great-circle distance in miles
  function milesBetween(aLat, aLng, bLat, bLng) {
    var R = 3958.8, toRad = Math.PI / 180;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * toRad) * Math.cos(bLat * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function milesFromWorkshop(lat, lng) {
    return milesBetween(WORKSHOP.lat, WORKSHOP.lng, lat, lng);
  }

  function photoURL(idOrPath, w) {
    if (idOrPath.indexOf("/") !== -1) return idOrPath; // local, name-blurred copy
    return "https://lh3.googleusercontent.com/d/" + idOrPath + "=w" + (w || 500);
  }

  function cardHTML(p) {
    var meta = [p.y, p.mk, p.tp].filter(Boolean).join(" · ");
    var place = p.ct + ", " + p.st;
    var tags = p.c.filter(function (c) { return CARD_TAGS.indexOf(c) !== -1; }).slice(0, 4);
    var h = "<div class='pcard'><div class='strip'></div>";
    if (p.ap && p.bp) {
      // before/after slider — drag to sweep across the piano
      h += "<div class='ba' style='--cut:50%'>" +
        "<img class='ba-after' src='" + photoURL(p.ap) + "' alt='After restoration' loading='lazy'>" +
        "<img class='ba-before' src='" + photoURL(p.bp) + "' alt='Before restoration' loading='lazy'>" +
        "<span class='ba-lbl l'>BEFORE</span><span class='ba-lbl r'>AFTER</span>" +
        "<div class='ba-handle'></div>" +
        "<input type='range' min='3' max='97' value='50' aria-label='Slide to compare before and after' " +
        "oninput=\"this.parentNode.style.setProperty('--cut', this.value + '%')\">" +
        "</div>";
    } else if (p.ap) {
      h += "<img class='pcard-photo' src='" + photoURL(p.ap) + "' alt='" + esc(p.t) + "' loading='lazy'>";
    }
    h += "<div class='pad'>";
    h += "<h3>" + esc(p.t) + "</h3>";
    h += "<div class='meta'>" + esc(meta ? meta + " · " + place : place) + "</div>";
    if (tags.length) {
      h += "<div class='tags'>" + tags.map(function (t) { return "<span class='tag'>" + esc(t) + "</span>"; }).join("") + "</div>";
    }
    var isHeirloom = p.c.indexOf("Family Heirloom") !== -1;
    var isNew = p.y === "New";
    var what = [p.mk, p.tp].filter(Boolean).join(" ") || "piano";
    var story;
    if (isNew && !isHeirloom) {
      story = "<p class='resto'>A beautiful piece of musical history in the making. Brand new, this " +
        esc(what) + " represents the finest of modern piano craftsmanship. Delivered to its new home, " +
        "we are proud that this instrument's legacy begins in " + esc(p.ct + ", " + p.st) + ".</p>";
    } else {
      story = "<p class='resto'>A beautiful piece of musical history. " +
        (p.y && !isNew
          ? "Built in " + esc(p.y) + ", this " + esc(what) + " represents an era of exceptional piano craftsmanship. "
          : "This " + esc(what) + " represents exceptional piano craftsmanship. ") +
        (isHeirloom
          ? "Preserved across generations as a cherished family heirloom, we are proud to restore " +
            "its brilliance and keep this instrument's legacy alive in "
          : "Whether receiving dedicated service in our Utah workshop or being delivered to its " +
            "new home, we are proud to keep this instrument's legacy alive in ") +
        esc(p.ct + ", " + p.st) + ".</p>";
    }
    if (p.ap) {
      h += story;
      h += p.u
        ? "<a class='btn' href='" + esc(p.u) + "' target='_blank' rel='noopener'>View This Piano</a>"
        : "<span class='nolink'>Story page coming soon</span>";
    } else {
      h += story;
      h += "<a class='btn' href='https://www.brighamlarsonpianos.com/pages/piano-restoration' " +
        "target='_blank' rel='noopener'>Explore Piano Restoration</a>";
    }
    var miles = milesFromWorkshop(p.la, p.lo);
    if (miles >= 600) {
      if (p.c.indexOf("Family Heirloom") !== -1) {
        // heirlooms make the journey twice: to the workshop and home again
        var rt = (Math.round(miles * 2 / 10) * 10).toLocaleString("en-US");
        h += "<p class='miles'>&#9834; This family heirloom piano traveled from " +
          esc(STATE_NAMES[p.st] || p.st) + " to our Utah workshop and back — a " +
          rt + "-mile round-trip journey.</p>";
      } else {
        var rounded = (Math.round(miles / 10) * 10).toLocaleString("en-US");
        h += "<p class='miles'>&#9834; This piano traveled about " + rounded +
          " miles between our Utah workshop and " + esc(p.ct + ", " + p.st) + ".</p>";
      }
    }
    h += "</div></div>";
    return h;
  }

  // ---------- markers ----------
  // Same-city pianos fan out in a golden-angle spiral around the city center,
  // so every piano stays individually visible and clickable.
  var cityCounts = {};
  var markers = PIANOS.map(function (p, i) {
    var key = p.ct + "|" + p.st;
    var k = cityCounts[key] = (cityCounts[key] || 0) + 1;
    var ang = k * 2.39996, r = 0.006 * Math.sqrt(k);
    var base = displayLatLng(p);
    var ruby = !!(p.bp && p.ap); // Ruby Crown marks a before/after gallery
    var m = L.marker([base.lat + r * Math.sin(ang), base.lng + r * Math.cos(ang) * 1.3],
      { icon: iconForZoom(4, ruby), title: p.t });
    m.on("click", function () {
      drawGlowRoute(m.getLatLng());
      openCard(m.getLatLng(), cardHTML(p));
    });
    if (ruby) {
      // hover bait: a tiny split before/after medallion above the pin —
      // clicking it opens the full card (delegated handler below)
      m.bindTooltip(
        "<div class='peek' data-mi='" + i + "'>" +
        "<img src='" + photoURL(p.ap) + "' alt=''>" +
        "<img class='pk-before' src='" + photoURL(p.bp) + "' alt=''>" +
        "<span class='pk-seam'></span></div>",
        { direction: "top", offset: [0, -26], className: "peek-tip", opacity: 1, interactive: true }
      );
      // keep the peek open while the cursor travels from pin to medallion,
      // so it can actually be hovered and clicked
      m.off("mouseout"); // drop Leaflet's instant-close
      var peekTimer;
      var peekClose = function () { peekTimer = setTimeout(function () { m.closeTooltip(); }, 280); };
      var peekStay = function () { clearTimeout(peekTimer); };
      m.on("mouseover", peekStay);
      m.on("mouseout", peekClose);
      m.on("tooltipopen", function (e) {
        var el = e.tooltip.getElement();
        if (el && !el._hoverWired) {
          el._hoverWired = true;
          el.addEventListener("mouseenter", peekStay);
          el.addEventListener("mouseleave", peekClose);
          // open the full card on tap or click — wired on the element so
          // touch devices work even though Leaflet swallows the bubble
          var openIt = function (ev) {
            if (ev.cancelable) ev.preventDefault();
            ev.stopPropagation();
            m.closeTooltip();
            drawGlowRoute(m.getLatLng());
            openCard(m.getLatLng(), cardHTML(p));
          };
          el.addEventListener("click", openIt);
          el.addEventListener("touchend", openIt);
        }
      });
    }
    m._piano = p;
    m._ruby = ruby;
    return m;
  });

  // clicking a hover-peek medallion opens that piano's full card
  document.addEventListener("click", function (e) {
    var peek = e.target.closest ? e.target.closest(".peek") : null;
    if (!peek) return;
    var m = markers[parseInt(peek.getAttribute("data-mi"), 10)];
    if (!m) return;
    m.closeTooltip();
    drawGlowRoute(m.getLatLng());
    openCard(m.getLatLng(), cardHTML(m._piano));
  });

  // ---------- filtering ----------
  var STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
    MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
    TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "Washington DC"
  };

  var state = { chip: "*", make: "", q: "", year: null, loc: null }; // year: era filter center, null = all eras; loc: {st[, ct]} region picked from the search dropdown
  var countEl = document.getElementById("count");

  function matches(p) {
    if (state.chip !== "*") {
      var kv = state.chip.split(":");
      if (kv[0] === "type" && p.tp !== kv[1]) return false;
      if (kv[0] === "cat" && p.c.indexOf(kv[1]) === -1) return false;
      if (kv[0] === "gallery" && !(p.bp && p.ap)) return false; // before/after slider pianos
    }
    if (state.loc) {
      if (p.st !== state.loc.st) return false;
      if (state.loc.ct && p.ct !== state.loc.ct) return false;
    }
    if (state.make && p.mk.toLowerCase().indexOf(state.make.toLowerCase()) === -1) return false;
    if (state.year !== null) {
      var y = parseInt(p.y, 10);
      if (!y || Math.abs(y - state.year) > 12) return false; // ±12-year era window
    }
    if (state.q) {
      var hay = [p.t, p.y, p.mk, p.md, p.tp, p.ct, p.st, STATE_NAMES[p.st] || "", p.c.join(" ")].join(" ").toLowerCase();
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  function apply(fit) {
    var visible = markers.filter(function (m) { return matches(m._piano); });
    var z = map.getZoom();
    pianoLayer.clearLayers();
    visible.forEach(function (m) { m.setIcon(iconForZoom(z, m._ruby)); pianoLayer.addLayer(m); });
    lastVisibleMarkers = visible;
    rebuildWeb();
    if (countEl) countEl.textContent = "Showing " + visible.length + " of " + PIANOS.length + " pianos";
    if (fit && visible.length) {
      var b = L.latLngBounds(visible.map(function (m) { return m.getLatLng(); }));
      map.fitBounds(b.pad(0.2), { maxZoom: 10 });
    }
  }

  // chips
  var chipsEl = document.getElementById("chips");
  chipsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip[data-filter]");
    if (!btn) return;
    chipsEl.querySelectorAll(".chip[data-filter]").forEach(function (c) { c.classList.remove("on"); });
    btn.classList.add("on");
    state.chip = btn.getAttribute("data-filter");
    apply(true);
  });

  // make dropdown, built from the data
  var makeSelect = document.getElementById("makeSelect");
  var makes = {};
  PIANOS.forEach(function (p) {
    var mk = p.mk.trim();
    if (mk) makes[mk] = (makes[mk] || 0) + 1;
  });
  Object.keys(makes)
    .sort(function (a, b) { return makes[b] - makes[a]; })
    .slice(0, 25)
    .forEach(function (mk) {
      var o = document.createElement("option");
      o.value = mk;
      o.textContent = mk + " (" + makes[mk] + ")";
      makeSelect.appendChild(o);
    });
  makeSelect.addEventListener("change", function () {
    state.make = makeSelect.value;
    apply(true);
  });

  // ---------- search + autocomplete dropdown ----------
  // Typing suggests places and individual pianos — a keyboard-friendly
  // alternative to hunting for a pin on the map.
  var searchEl = document.getElementById("search");
  var suggestEl = document.getElementById("suggest");

  // region index: pianos per state and per city
  var stateCounts = {}, cityLocs = {};
  PIANOS.forEach(function (p) {
    stateCounts[p.st] = (stateCounts[p.st] || 0) + 1;
    var ck = p.ct + ", " + p.st;
    cityLocs[ck] = cityLocs[ck] || { ct: p.ct, st: p.st, n: 0 };
    cityLocs[ck].n++;
  });
  var pianoHay = PIANOS.map(function (p) {
    return [p.t, p.y, p.mk, p.md, p.tp, p.ct, p.st, STATE_NAMES[p.st] || "", p.c.join(" ")].join(" ").toLowerCase();
  });

  var sgItems = [], sgActive = -1;

  function hideSuggest() {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    searchEl.setAttribute("aria-expanded", "false");
    document.body.classList.remove("suggest-open");
    sgItems = [];
    sgActive = -1;
  }

  function setActive(idx) {
    if (sgActive >= 0 && sgItems[sgActive]) sgItems[sgActive].classList.remove("active");
    sgActive = idx;
    if (sgActive >= 0 && sgItems[sgActive]) {
      sgItems[sgActive].classList.add("active");
      sgItems[sgActive].scrollIntoView({ block: "nearest" });
    }
  }

  function goToLocation(loc, label) {
    clearTimeout(debounce); // a pending text-filter would override the pick
    searchEl.value = label;
    state.q = "";
    state.loc = loc;
    hideSuggest();
    apply(true); // filters to the region and fits the view to its pins
  }

  function goToPiano(i) {
    clearTimeout(debounce); // a pending text-filter would cancel the fly-to
    var m = markers[i];
    hideSuggest();
    searchEl.value = m._piano.t;
    var ll = m.getLatLng();
    // if current filters hide this piano's pin, relax them so it shows
    if (!matches(m._piano)) {
      state.q = "";
      state.loc = null;
      apply(false);
    }
    map.flyTo(ll, Math.max(map.getZoom(), 8.5), { duration: 1.4 });
    map.once("moveend", function () {
      // exactly the pin-click behavior: glowing route + open card
      drawGlowRoute(ll);
      openCard(ll, cardHTML(m._piano));
    });
  }

  function suggestMatches(q) {
    var ql = q.toLowerCase();
    var locs = [];
    Object.keys(STATE_NAMES).forEach(function (st) {
      if (!stateCounts[st]) return;
      var name = STATE_NAMES[st];
      if (name.toLowerCase().indexOf(ql) === 0 || st.toLowerCase() === ql) {
        locs.push({ loc: { st: st }, label: name, n: stateCounts[st] });
      }
    });
    Object.keys(cityLocs).forEach(function (ck) {
      var c = cityLocs[ck];
      if (c.ct.toLowerCase().indexOf(ql) === 0 || ck.toLowerCase().indexOf(ql) === 0) {
        locs.push({ loc: { st: c.st, ct: c.ct }, label: ck, n: c.n });
      }
    });
    locs.sort(function (a, b) { return b.n - a.n; });

    var terms = ql.split(/\s+/).filter(Boolean);
    var pianos = [];
    if (terms.length) {
      PIANOS.forEach(function (p, i) {
        for (var t = 0; t < terms.length; t++) {
          if (pianoHay[i].indexOf(terms[t]) === -1) return;
        }
        pianos.push(i);
      });
      // heirlooms and photo galleries first — the pianos with stories to tell
      pianos.sort(function (a, b) {
        function rank(i) {
          var p = PIANOS[i];
          return (p.c.indexOf("Family Heirloom") !== -1 ? 2 : 0) + (p.ap ? 1 : 0);
        }
        return rank(b) - rank(a);
      });
    }
    return { locs: locs.slice(0, 5), pianos: pianos.slice(0, 30) };
  }

  function renderSuggest() {
    var q = searchEl.value.trim();
    if (q.length < 2) { hideSuggest(); return; }
    var res = suggestMatches(q);
    if (!res.locs.length && !res.pianos.length) { hideSuggest(); return; }
    var h = "";
    if (res.locs.length) {
      h += "<div class='sg-sect'><div class='sg-head'>Locations</div>";
      res.locs.forEach(function (l) {
        h += "<button type='button' class='sg-item' role='option' data-kind='loc' " +
          "data-st='" + esc(l.loc.st) + "'" + (l.loc.ct ? " data-ct='" + esc(l.loc.ct) + "'" : "") + ">" +
          "<span class='sg-main'>" + esc(l.label) + "</span>" +
          "<span class='sg-sub'>" + l.n + " piano" + (l.n === 1 ? "" : "s") + "</span></button>";
      });
      h += "</div>";
    }
    if (res.pianos.length) {
      h += "<div class='sg-sect'><div class='sg-head'>Pianos</div>";
      res.pianos.forEach(function (i) {
        var p = PIANOS[i];
        h += "<button type='button' class='sg-item' role='option' data-kind='piano' data-i='" + i + "'>" +
          "<span class='sg-main'>" + esc(p.t) + "</span>" +
          "<span class='sg-sub'>" + esc(p.ct + ", " + p.st) + "</span></button>";
      });
      h += "</div>";
    }
    suggestEl.innerHTML = h;
    suggestEl.hidden = false;
    suggestEl.scrollTop = 0;
    searchEl.setAttribute("aria-expanded", "true");
    document.body.classList.add("suggest-open");
    sgItems = Array.prototype.slice.call(suggestEl.querySelectorAll(".sg-item"));
    sgActive = -1;
  }

  suggestEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".sg-item");
    if (!btn) return;
    if (btn.getAttribute("data-kind") === "piano") {
      goToPiano(parseInt(btn.getAttribute("data-i"), 10));
    } else {
      var st = btn.getAttribute("data-st"), ct = btn.getAttribute("data-ct");
      goToLocation(ct ? { st: st, ct: ct } : { st: st },
        ct ? ct + ", " + st : STATE_NAMES[st] || st);
    }
  });

  searchEl.addEventListener("keydown", function (e) {
    if (suggestEl.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(sgActive < sgItems.length - 1 ? sgActive + 1 : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(sgActive > 0 ? sgActive - 1 : sgItems.length - 1);
    } else if (e.key === "Enter") {
      if (sgActive >= 0) {
        e.preventDefault();
        sgItems[sgActive].click();
      } else {
        hideSuggest(); // plain Enter: keep the typed text as the map filter
      }
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  });

  // close when clicking/tapping anywhere outside the search area
  document.addEventListener("pointerdown", function (e) {
    if (!suggestEl.hidden && !(e.target.closest && e.target.closest(".searcharea"))) hideSuggest();
  });

  var debounce;
  searchEl.addEventListener("input", function () {
    state.loc = null; // typing again clears a picked region
    renderSuggest(); // suggestions update instantly…
    clearTimeout(debounce);
    debounce = setTimeout(function () { // …the map filter shortly after
      state.q = searchEl.value.trim();
      apply(true);
    }, 250);
  });

  // reset (optional — the widget build ships without the button; clicking
  // "All Pianos" clears filters and refits the view)
  var resetBtn = document.getElementById("reset");
  if (resetBtn) resetBtn.addEventListener("click", function () {
    state = { chip: "*", make: "", q: "", year: null, loc: null };
    searchEl.value = "";
    hideSuggest();
    makeSelect.value = "";
    var ts = document.getElementById("timeSlider");
    if (ts) {
      ts.value = 2026;
      document.getElementById("tbLabel").textContent = "Every Era of Piano History";
    }
    chipsEl.querySelectorAll(".chip[data-filter]").forEach(function (c) {
      c.classList.toggle("on", c.getAttribute("data-filter") === "*");
    });
    apply(false);
    map.fitBounds(HOME_VIEW);
  });

  apply(false);

  // ---------- stats banner ----------
  // The scale of the story in one line, computed live from the data.
  var statsEl = document.getElementById("mapStats");
  if (statsEl) {
    var statStates = {};
    var statMiles = 0;
    PIANOS.forEach(function (p) {
      statStates[p.st] = 1;
      // heirlooms make the trip to the workshop and back — count both legs
      statMiles += milesFromWorkshop(p.la, p.lo) * (p.c.indexOf("Family Heirloom") !== -1 ? 2 : 1);
    });
    var STATS = [
      [PIANOS.length, " pianos"],
      [Object.keys(statStates).length, " states"],
      [Math.round(statMiles / 1000) * 1000, " miles traveled"]
    ].filter(function (s) { return s[0] > 0; });

    statsEl.innerHTML = STATS.map(function (s, i) {
      return (i ? "<span class='ms-dot'>&#183;</span>" : "") +
        "<span class='ms-num' data-n='" + s[0] + "'>0</span>" + s[1];
    }).join("");

    var numEls = statsEl.querySelectorAll(".ms-num");
    function setStats(t) { // t: 0..1 progress
      numEls.forEach(function (el) {
        var n = Math.round(parseInt(el.getAttribute("data-n"), 10) * t);
        el.textContent = n.toLocaleString("en-US");
      });
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStats(1);
    } else {
      var statT0 = null;
      requestAnimationFrame(function tick(ts) {
        if (!statT0) statT0 = ts;
        var t = Math.min(1, (ts - statT0) / 1400);
        setStats(1 - Math.pow(1 - t, 3)); // ease-out — settles gently
        if (t < 1) requestAnimationFrame(tick);
      });
    }
  }

  // ---------- era timeline slider ----------
  var timeBar = document.getElementById("timeBar");
  if (timeBar) {
    L.DomEvent.disableClickPropagation(timeBar);
    L.DomEvent.disableScrollPropagation(timeBar);
    var timeSlider = document.getElementById("timeSlider");
    var tbLabel = document.getElementById("tbLabel");
    var tDebounce;
    timeSlider.addEventListener("input", function () {
      var v = parseInt(timeSlider.value, 10);
      if (v >= 2026) {
        state.year = null;
        tbLabel.textContent = "Every Era of Piano History";
      } else {
        state.year = v;
        tbLabel.textContent = "The " + v + " Era · pianos built " + (v - 12) + "–" + Math.min(v + 12, 2026);
      }
      clearTimeout(tDebounce);
      tDebounce = setTimeout(function () { apply(false); }, 120);
    });
  }

  // ---------- heirloom lead box: ZIP lookup + free quote ----------
  var leadBox = document.getElementById("leadBox");
  if (leadBox) {
    L.DomEvent.disableClickPropagation(leadBox);
    L.DomEvent.disableScrollPropagation(leadBox);
    var lbReopen = document.getElementById("lbReopen");
    L.DomEvent.disableClickPropagation(lbReopen);
    // phones start with the box collapsed — the pill invites, not insists
    if (window.matchMedia("(max-width: 640px)").matches) {
      document.body.classList.add("lead-closed");
    }
    document.getElementById("lbClose").addEventListener("click", function () {
      document.body.classList.add("lead-closed");
    });
    lbReopen.addEventListener("click", function () {
      document.body.classList.remove("lead-closed");
    });
    var zipForm = document.getElementById("zipForm");
    var zipInput = document.getElementById("zipInput");
    var zipResult = document.getElementById("zipResult");
    zipForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var zip = zipInput.value.trim();
      if (!/^\d{5}$/.test(zip)) {
        zipResult.textContent = "Please enter a 5-digit ZIP code.";
        return;
      }
      zipResult.textContent = "Looking up your neighborhood…";
      fetch("https://api.zippopotam.us/us/" + zip)
        .then(function (r) { if (!r.ok) throw new Error("nozip"); return r.json(); })
        .then(function (j) {
          var place = j.places && j.places[0];
          var lat = parseFloat(place.latitude), lng = parseFloat(place.longitude);
          var nearest = null, best = Infinity;
          PIANOS.forEach(function (p) {
            var d = milesBetween(lat, lng, p.la, p.lo);
            if (d < best) { best = d; nearest = p; }
          });
          if (!nearest) return;
          var mi = Math.max(1, Math.round(best));
          zipResult.textContent = "We delivered a restored piano about " + mi.toLocaleString("en-US") +
            " mile" + (mi === 1 ? "" : "s") + " from you — the " + nearest.t +
            " in " + nearest.ct + ", " + nearest.st + ".";
          map.flyTo(displayLatLng(nearest), 8, { duration: 1.8 });
        })
        .catch(function () {
          zipResult.textContent = "Hmm, we couldn't find that ZIP — try another?";
        });
    });
  }
})();
