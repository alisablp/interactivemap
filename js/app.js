/* Pianos Across America — Brigham Larson Pianos
   Zoomable/pannable map (Leaflet) with gold pins, search, and filters. */

(function () {
  "use strict";

  var WORKSHOP = { lat: 40.2969, lng: -111.6946, label: "Brigham Larson Pianos — Orem, Utah" };

  // ---------- map ----------
  var map = L.map("map", {
    center: [39.5, -98.35],
    zoom: 4,
    minZoom: 3,
    maxZoom: 18,
    scrollWheelZoom: true,
    worldCopyJump: true
  });

  // CARTO Voyager: clean, Google-style basemap (no API key required)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  map.zoomControl.setPosition("topright");

  // ---------- gold pin ----------
  function pinSVG(w, h) {
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="gp" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fdeaa0"/><stop offset=".35" stop-color="#e7c256"/>' +
      '<stop offset=".7" stop-color="#b18a1f"/><stop offset="1" stop-color="#7c5c0e"/></linearGradient></defs>' +
      '<path d="M60 6C31 6 10 28 10 56c0 36 41 96 50 104 9-8 50-68 50-104C110 28 89 6 60 6Z" fill="url(#gp)" stroke="#6e5210" stroke-width="4"/>' +
      '<circle cx="60" cy="55" r="21" fill="#f9f7ee" stroke="#8a6a14" stroke-width="3"/></svg>';
  }

  var goldIcon = L.divIcon({
    className: "gold-pin",
    html: pinSVG(26, 37),
    iconSize: [26, 37],
    iconAnchor: [13, 37],
    popupAnchor: [0, -34]
  });

  // workshop star
  L.marker([WORKSHOP.lat, WORKSHOP.lng], {
    icon: L.divIcon({ className: "home-star", html: "<span>&#9733;</span>", iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
    title: WORKSHOP.label
  }).addTo(map).bindPopup("<div class='pcard'><div class='strip'></div><div class='pad'><h3>The Workshop</h3><div class='meta'>" + WORKSHOP.label + "</div><a class='btn' href='https://www.brighamlarsonpianos.com' target='_blank' rel='noopener'>Visit Us</a></div></div>");

  // ---------- clusters ----------
  var cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 44,
    iconCreateFunction: function (c) {
      var n = c.getChildCount();
      var size = n < 10 ? 34 : n < 50 ? 42 : 50;
      return L.divIcon({
        html: "<div class='piano-cluster' style='width:" + size + "px;height:" + size + "px'>" + n + "</div>",
        className: "",
        iconSize: [size, size]
      });
    }
  });
  map.addLayer(cluster);

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

  // ---------- markers (deterministic jitter so same-city pins spread) ----------
  var markers = PIANOS.map(function (p, i) {
    var dLat = ((i * 137) % 21 - 10) * 0.0016;
    var dLng = ((i * 149) % 21 - 10) * 0.0021;
    var m = L.marker([p.la + dLat, p.lo + dLng], { icon: goldIcon, title: p.t });
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
    cluster.clearLayers();
    cluster.addLayers(visible);
    countEl.textContent = "Showing " + visible.length + " of " + PIANOS.length + " pianos";
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
    map.setView([39.5, -98.35], 4);
  });

  apply(false);
})();
