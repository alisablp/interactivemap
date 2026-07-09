/* Pianos Across America — Brigham Larson Pianos
   Zoomable/pannable map (Leaflet) with gold pins, search, and filters. */

(function () {
  "use strict";

  var WORKSHOP = { lat: 40.2969, lng: -111.6946, label: "Brigham Larson Pianos — Orem, Utah" };

  // ---------- map ----------
  // USA only: panning is locked to the United States
  var US_BOUNDS = L.latLngBounds([22.5, -128.5], [51.5, -64.5]);

  var map = L.map("map", {
    center: [39.5, -98.35],
    zoom: 4,
    minZoom: 4,
    maxZoom: 18,
    zoomSnap: 0.25,
    scrollWheelZoom: true,
    maxBounds: US_BOUNDS,
    maxBoundsViscosity: 1.0
  });

  // CARTO Voyager: clean, Google-style basemap (no API key required).
  // Terrain and labels are separate layers: the US mask sits between them,
  // so city names near borders and coasts never get sliced off.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  map.createPane("labels");
  map.getPane("labels").style.zIndex = 450;      // above the mask (400)…
  map.getPane("labels").style.pointerEvents = "none"; // …but never blocks clicks

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    pane: "labels"
  }).addTo(map);

  map.zoomControl.setPosition("topright");

  // open with the lower 48 filling the view
  var LOWER48 = L.latLngBounds([24.5, -124.8], [49.4, -66.9]);
  map.fitBounds(LOWER48);

  // Mask out everything beyond the US border (Canada, Mexico, oceans)
  // with the site's cream, leaving a fine gold outline around the country.
  var WORLD_RING = [[-89.9, -179.9], [-89.9, 179.9], [89.9, 179.9], [89.9, -179.9]];
  var MASK_STYLE = {
    stroke: true, color: "#c9a227", weight: 1.2,
    fill: true, fillColor: "#f2ecdd", fillOpacity: 1, interactive: false
  };

  function ringCentroid(ring) {
    var la = 0, lo = 0;
    ring.forEach(function (ll) { la += ll[0]; lo += ll[1]; });
    return { lat: la / ring.length, lng: lo / ring.length };
  }

  // Alaska & Hawaii live in framed insets at the bottom left, like a
  // classic classroom map. Their pianos render as gold dots inside the
  // frame; clicking one opens the piano's page.
  var insetMarkers = [];

  function addInsetPins(mini, stCode) {
    PIANOS.forEach(function (p) {
      if (p.st !== stCode) return;
      var m = L.marker([p.la, p.lo], {
        icon: L.divIcon({
          className: "gold-pin",
          html: dotSVG(13),
          iconSize: [13, 13],
          iconAnchor: [6.5, 6.5]
        }),
        title: p.t + " — " + p.ct + ", " + p.st
      });
      if (p.u) {
        m.on("click", function () { window.open(p.u, "_blank", "noopener"); });
      }
      m.addTo(mini);
      insetMarkers.push({ m: m, p: p, mini: mini });
    });
  }

  function buildInset(label, rings, bounds, w, h) {
    var el = L.DomUtil.create("div", "map-inset", map.getContainer());
    el.style.width = w + "px";
    el.style.height = h + "px";
    var tag = L.DomUtil.create("span", "map-inset-label", el);
    tag.textContent = label;
    var mini = L.map(el, {
      zoomControl: false, attributionControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      keyboard: false, touchZoom: false, zoomSnap: 0.1
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19
    }).addTo(mini);
    mini.fitBounds(bounds);
    L.polygon([WORLD_RING].concat(rings), MASK_STYLE).addTo(mini);
    return { el: el, mini: mini };
  }

  fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/nation-10m.json")
    .then(function (r) { return r.json(); })
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

      // main map: only the lower 48 shows through the cream
      L.polygon([WORLD_RING].concat(lower48), MASK_STYLE).addTo(map);

      // hide the Great Lakes' open water under the same cream
      fetch("https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_lakes.geojson")
        .then(function (r) { return r.json(); })
        .then(function (lakes) {
          var GREAT = ["Lake Superior", "Lake Michigan", "Lake Huron", "Lake Erie", "Lake Ontario"];
          L.geoJSON(lakes, {
            filter: function (f) { return GREAT.indexOf(f.properties.name) !== -1; },
            style: { stroke: true, color: "#c9a227", weight: 1, fill: true, fillColor: "#f2ecdd", fillOpacity: 1 },
            interactive: false
          }).addTo(map);
        })
        .catch(function () { /* cosmetic */ });

      // insets (hidden once the visitor zooms in past country level)
      var ak = buildInset("Alaska", alaska, [[52, -170], [71.5, -129.5]], 180, 120);
      var hi = buildInset("Hawaii", hawaii, [[18.6, -160.4], [22.4, -154.6]], 130, 88);
      hi.el.style.left = "202px";
      addInsetPins(ak.mini, "AK");
      addInsetPins(hi.mini, "HI");
      apply(false); // sync inset pins with any active filters
      function toggleInsets() {
        var show = map.getZoom() < 6;
        ak.el.style.display = show ? "" : "none";
        hi.el.style.display = show ? "" : "none";
      }
      toggleInsets();
      map.on("zoomend", toggleInsets);

      // Clip the label layer to the US border so only American city names
      // render — foreign labels never float over the cream surround.
      var labelsPane = map.getPane("labels");
      function updateLabelClip() {
        var d = lower48.map(function (ring) {
          return "M" + ring.map(function (ll) {
            var pt = map.latLngToLayerPoint(ll);
            return Math.round(pt.x) + " " + Math.round(pt.y);
          }).join(" L ") + " Z";
        }).join(" ");
        labelsPane.style.clipPath = 'path("' + d + '")';
      }
      updateLabelClip();
      map.on("zoomend viewreset", updateLabelClip);
    })
    .catch(function () { /* mask is cosmetic — map still works without it */ });

  // ---------- gold markers ----------
  // Far out: every piano is a 3D gold dot. Zooming in, dots become gold pins.
  function pinSVG(w, h) {
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fdeaa0"/><stop offset=".35" stop-color="#e7c256"/>' +
      '<stop offset=".7" stop-color="#b18a1f"/><stop offset="1" stop-color="#7c5c0e"/></linearGradient></defs>' +
      '<path d="M60 6C31 6 10 28 10 56c0 36 41 96 50 104 9-8 50-68 50-104C110 28 89 6 60 6Z" fill="url(#gp)" stroke="#6e5210" stroke-width="4"/>' +
      '<circle cx="60" cy="55" r="21" fill="#f9f7ee" stroke="#8a6a14" stroke-width="3"/></svg>';
  }

  function dotSVG(d) {
    return '<svg width="' + d + '" height="' + d + '" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><radialGradient id="gd" cx=".35" cy=".28" r=".85">' +
      '<stop offset="0" stop-color="#fff6cf"/><stop offset=".3" stop-color="#f2d270"/>' +
      '<stop offset=".62" stop-color="#c9a227"/><stop offset="1" stop-color="#6e5210"/></radialGradient></defs>' +
      '<circle cx="12" cy="12" r="10.4" fill="url(#gd)" stroke="#6e5210" stroke-width="1"/>' +
      '<ellipse cx="8.6" cy="7.6" rx="3.2" ry="1.9" fill="#ffffff" opacity=".8" transform="rotate(-24 8.6 7.6)"/></svg>';
  }

  var iconCache = {};
  function iconForZoom(z) {
    var key, ic;
    if (z < 7) {
      var d = z <= 5 ? 11 : 15;
      key = "dot" + d;
      ic = iconCache[key] || (iconCache[key] = L.divIcon({
        className: "gold-pin",
        html: dotSVG(d),
        iconSize: [d, d],
        iconAnchor: [d / 2, d / 2],
        popupAnchor: [0, -d / 2 - 2]
      }));
    } else {
      var h = z < 9 ? 28 : 37;
      var w = Math.round(h * 120 / 170);
      key = "pin" + h;
      ic = iconCache[key] || (iconCache[key] = L.divIcon({
        className: "gold-pin",
        html: pinSVG(w, h),
        iconSize: [w, h],
        iconAnchor: [w / 2, h],
        popupAnchor: [0, -h + 3]
      }));
    }
    return ic;
  }

  // workshop star
  L.marker([WORKSHOP.lat, WORKSHOP.lng], {
    icon: L.divIcon({ className: "home-star", html: "<span>&#9733;</span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
    title: WORKSHOP.label
  }).addTo(map).bindPopup("<div class='pcard'><div class='strip'></div><div class='pad'><h3>The Workshop</h3><div class='meta'>" + WORKSHOP.label + "</div><a class='btn' href='https://www.brighamlarsonpianos.com' target='_blank' rel='noopener'>Visit Us</a></div></div>");

  // ---------- marker layer (no clustering — every piano stays visible) ----------
  var pianoLayer = L.layerGroup().addTo(map);

  map.on("zoomend", function () {
    var ic = iconForZoom(map.getZoom());
    markers.forEach(function (m) { m.setIcon(ic); });
  });

  // ---------- popup card ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  var CARD_TAGS = ["Restoration", "Family Heirloom", "Player", "Vintage Player", "Antique", "Premier", "Art Case", "Concert Grand"];

  function cardHTML(p) {
    var meta = [p.y, p.mk, p.tp].filter(Boolean).join(" · ");
    var place = p.ct + ", " + p.st;
    var tags = p.c.filter(function (c) { return CARD_TAGS.indexOf(c) !== -1; }).slice(0, 4);
    var h = "<div class='pcard'><div class='strip'></div><div class='pad'>";
    h += "<h3>" + esc(p.t) + "</h3>";
    h += "<div class='meta'>" + esc(meta ? meta + " · " + place : place) + "</div>";
    if (tags.length) {
      h += "<div class='tags'>" + tags.map(function (t) { return "<span class='tag'>" + esc(t) + "</span>"; }).join("") + "</div>";
    }
    h += p.u
      ? "<a class='btn' href='" + esc(p.u) + "' target='_blank' rel='noopener'>View This Piano</a>"
      : "<span class='nolink'>Story page coming soon</span>";
    h += "</div></div>";
    return h;
  }

  // ---------- markers ----------
  // Same-city pianos fan out in a golden-angle spiral around the city center,
  // so every piano stays individually visible and clickable.
  // Alaska & Hawaii pianos live in the insets instead of the main map.
  var cityCounts = {};
  var markers = PIANOS.filter(function (p) {
    return p.st !== "AK" && p.st !== "HI";
  }).map(function (p, i) {
    var key = p.ct + "|" + p.st;
    var k = cityCounts[key] = (cityCounts[key] || 0) + 1;
    var ang = k * 2.39996, r = 0.006 * Math.sqrt(k);
    var dLat = r * Math.sin(ang);
    var dLng = r * Math.cos(ang) * 1.3;
    var m = L.marker([p.la + dLat, p.lo + dLng], { icon: iconForZoom(4), title: p.t });
    m.bindPopup(cardHTML(p));
    m._piano = p;
    return m;
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

  var state = { chip: "*", make: "", q: "" };
  var countEl = document.getElementById("count");

  function matches(p) {
    if (state.chip !== "*") {
      var kv = state.chip.split(":");
      if (kv[0] === "type" && p.tp !== kv[1]) return false;
      if (kv[0] === "cat" && p.c.indexOf(kv[1]) === -1) return false;
    }
    if (state.make && p.mk.toLowerCase().indexOf(state.make.toLowerCase()) === -1) return false;
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
    var ic = iconForZoom(map.getZoom());
    pianoLayer.clearLayers();
    visible.forEach(function (m) { m.setIcon(ic); pianoLayer.addLayer(m); });
    var insetVisible = 0;
    insetMarkers.forEach(function (im) {
      if (matches(im.p)) {
        insetVisible++;
        if (!im.mini.hasLayer(im.m)) im.m.addTo(im.mini);
      } else {
        im.mini.removeLayer(im.m);
      }
    });
    countEl.textContent = "Showing " + (visible.length + insetVisible) + " of " + PIANOS.length + " pianos";
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

  // search
  var searchEl = document.getElementById("search");
  var debounce;
  searchEl.addEventListener("input", function () {
    clearTimeout(debounce);
    debounce = setTimeout(function () {
      state.q = searchEl.value.trim();
      apply(true);
    }, 250);
  });

  // reset
  document.getElementById("reset").addEventListener("click", function () {
    state = { chip: "*", make: "", q: "" };
    searchEl.value = "";
    makeSelect.value = "";
    chipsEl.querySelectorAll(".chip[data-filter]").forEach(function (c) {
      c.classList.toggle("on", c.getAttribute("data-filter") === "*");
    });
    apply(false);
    map.fitBounds(LOWER48);
  });

  apply(false);
})();
