/* ============================================================================
   Scientific extras — loaded after app.js on scientific.html
   • Leaflet scale bar (km)
   • Cursor coordinate readout
   • Methods disclosure toggle
   • Lazy adjustment of a few visible strings
   ============================================================================ */
(function () {
  function init() {
    const map = window.__arxivMap;
    if (!map) { setTimeout(init, 40); return; }

    // ─── Scale bar (km only, no imperial) ───
    L.control.scale({
      position: "bottomleft",
      metric: true,
      imperial: false,
      maxWidth: 140,
      updateWhenIdle: true
    }).addTo(map);

    // ─── Coordinate readout ───
    const coord = document.getElementById("coord-readout");
    if (coord) {
      const elLat = coord.querySelector("[data-k=lat]");
      const elLon = coord.querySelector("[data-k=lon]");
      const elZoom = coord.querySelector("[data-k=zoom]");
      map.on("mousemove", e => {
        coord.classList.add("show");
        elLat.textContent = e.latlng.lat.toFixed(2) + "°";
        elLon.textContent = e.latlng.lng.toFixed(2) + "°";
        elZoom.textContent = "z=" + map.getZoom().toFixed(1);
      });
      map.on("mouseout", () => coord.classList.remove("show"));
      map.on("zoomend", () => { elZoom.textContent = "z=" + map.getZoom().toFixed(1); });
    }

    // ─── Methods disclosure ───
    const toggle = document.getElementById("methods-toggle");
    const body = document.getElementById("methods-body");
    if (toggle && body) {
      toggle.addEventListener("click", () => {
        const open = body.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
    }

    // ─── Loading text → scientific phrasing ───
    const loadMsg = document.querySelector("#loading .msg");
    if (loadMsg) loadMsg.textContent = "Loading dataset · n = 130";

    // ─── Re-label Tweaks → Parameters in the toggle + panel header ───
    const tweaksBtn = document.getElementById("tweaks-toggle");
    if (tweaksBtn) {
      const lbl = tweaksBtn.querySelector("span:last-child");
      if (lbl) lbl.textContent = "Parameters";
    }
    const tweakHead = document.querySelector("#tweaks-panel .tweaks-head .t");
    if (tweakHead) tweakHead.textContent = "Display parameters";

    // ─── Stats panel: rename "Current view" → "Selection summary" ───
    const statsHead = document.querySelector("#sidebar .card h3 > span");
    if (statsHead && statsHead.textContent.trim() === "Current view") statsHead.textContent = "Selection summary";

    // ─── Stats unit → tabular suffix ───
    const unit = document.getElementById("stats-unit");
    if (unit) unit.textContent = "papers (n)";

    // ─── Legend: add unit annotation ───
    const legend = document.getElementById("legend");
    if (legend && !legend.querySelector(".units")) {
      const u = document.createElement("div");
      u.className = "units";
      u.textContent = "Kernel density · arbitrary units · log scale";
      legend.appendChild(u);
    }
  }
  init();
})();
