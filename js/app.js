/* ============================================================================
   ArXiv Publication Map — Main app
   Adapted from the redesign prototype to load real data via fetch() and to
   present cluster-centric semantic search results (hotspots).
   ============================================================================ */
(function () {
  // Lightweight arXiv category map (group + label) used for the domain panel.
  // Original prototype loaded this from data.js; here we inline a compact set
  // and gracefully degrade for unknown codes.
  const ARXIV_CATEGORIES = {
    "cs.AI": { group: "Computer Science", label: "Artificial Intelligence" },
    "cs.CL": { group: "Computer Science", label: "Computation and Language" },
    "cs.CV": { group: "Computer Science", label: "Computer Vision" },
    "cs.LG": { group: "Computer Science", label: "Machine Learning" },
    "cs.NE": { group: "Computer Science", label: "Neural and Evolutionary" },
    "cs.IR": { group: "Computer Science", label: "Information Retrieval" },
    "cs.CR": { group: "Computer Science", label: "Cryptography & Security" },
    "cs.NI": { group: "Computer Science", label: "Networking" },
    "cs.DC": { group: "Computer Science", label: "Distributed Computing" },
    "cs.RO": { group: "Computer Science", label: "Robotics" },
    "cs.HC": { group: "Computer Science", label: "Human-Computer Interaction" },
    "stat.ML": { group: "Statistics", label: "Machine Learning" },
    "math.PR": { group: "Mathematics", label: "Probability" },
    "math.ST": { group: "Mathematics", label: "Statistics Theory" },
    "math.OC": { group: "Mathematics", label: "Optimization & Control" },
    "math.NA": { group: "Mathematics", label: "Numerical Analysis" },
    "math.CO": { group: "Mathematics", label: "Combinatorics" },
    "physics.bio-ph": { group: "Physics", label: "Biological Physics" },
    "physics.med-ph": { group: "Physics", label: "Medical Physics" },
    "astro-ph": { group: "Physics", label: "Astrophysics" },
    "cond-mat": { group: "Physics", label: "Condensed Matter" },
    "hep-ph": { group: "Physics", label: "High Energy Physics" },
    "hep-th": { group: "Physics", label: "High Energy Theory" },
    "quant-ph": { group: "Physics", label: "Quantum Physics" },
    "q-bio": { group: "Biology", label: "Quantitative Biology" },
    "q-bio.NC": { group: "Biology", label: "Neurons and Cognition" },
    "q-bio.PE": { group: "Biology", label: "Populations & Evolution" },
    "q-fin": { group: "Finance", label: "Quantitative Finance" },
    "eess.AS": { group: "Engineering", label: "Audio & Speech" },
    "eess.IV": { group: "Engineering", label: "Image & Video" },
    "eess.SP": { group: "Engineering", label: "Signal Processing" },
    "econ.EM": { group: "Economics", label: "Econometrics" }
  };

  // ───── Theme state ─────
  const state = {
    direction: "observatory",
    mode: "dark",
    ramp: "auto",
    radius: 28,
    blur: 22,
    tiles: "auto",
    yearMin: 2018,
    yearMax: 2025,
    yearMode: "range",
    yearSingle: 2024,
    domains: new Set(),
    statsTab: "country",
    search: "",
    playing: false,
    playTimer: null,
    selectedClusterIdx: -1,
  };

  let data = [];
  let clusters = [];
  let years = [];
  let yearMinAll = 2018;
  let yearMaxAll = 2025;

  const TILES = {
    "dark-matter": {
      url: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
      attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19
    },
    "positron": {
      url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
      attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19
    },
    "voyager": {
      url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
      attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19
    },
    "toner": {
      url: "https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png",
      attribution: "© Stadia, © Stamen, © OpenStreetMap", subdomains: "abcd", maxZoom: 19
    }
  };

  const RAMPS = {
    magma:   { 0.0: "#000004", 0.2: "#3b0f70", 0.45: "#8c2981", 0.65: "#de4968", 0.85: "#fe9f6d", 1.0: "#fcfdbf" },
    inferno: { 0.0: "#000004", 0.2: "#420a68", 0.45: "#932667", 0.65: "#dd513a", 0.85: "#fca50a", 1.0: "#fcffa4" },
    viridis: { 0.0: "#440154", 0.25: "#3b528b", 0.5: "#21918c", 0.75: "#5ec962", 1.0: "#fde725" },
    hot:     { 0.0: "rgba(0,0,0,0)", 0.2: "#3a1010", 0.45: "#a51c00", 0.65: "#ff6b00", 0.85: "#ffd400", 1.0: "#ffffff" },
    blues:   { 0.0: "rgba(8,48,107,0.15)", 0.25: "#9ecae1", 0.5: "#4292c6", 0.75: "#2171b5", 1.0: "#08306b" },
    rdbu:    { 0.0: "#2166ac", 0.3: "#67a9cf", 0.5: "#f7f7f7", 0.7: "#ef8a62", 1.0: "#b2182b" },
  };

  function cssRampStops(name) {
    const r = RAMPS[name];
    return Object.entries(r).map(([k, v]) => `${v} ${(+k * 100).toFixed(0)}%`).join(", ");
  }
  function resolveTiles() {
    if (state.tiles !== "auto") return state.tiles;
    return "dark-matter";
  }
  function resolveRamp() {
    if (state.ramp !== "auto") return state.ramp;
    return "magma";
  }

  // ───── Init map ─────
  const map = L.map("map", {
    center: [25, 10],
    zoom: 2.5,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: false,
    worldCopyJump: true,
    preferCanvas: true,
    attributionControl: true
  });
  window.__arxivMap = map;

  let tileLayer = null;
  function setTiles() {
    const conf = TILES[resolveTiles()];
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(conf.url, {
      subdomains: conf.subdomains, maxZoom: conf.maxZoom,
      attribution: conf.attribution, detectRetina: true
    }).addTo(map);
  }

  let heatLayer = null;
  function setHeat(filtered) {
    if (heatLayer) map.removeLayer(heatLayer);
    const ramp = RAMPS[resolveRamp()];
    const points = filtered.map(d => [d.lat, d.lon, 1]);
    heatLayer = L.heatLayer(points, {
      radius: state.radius, blur: state.blur,
      maxZoom: 8, minOpacity: 0.25, gradient: ramp
    }).addTo(map);
  }

  let markerLayer = L.layerGroup().addTo(map);
  let highlightedClusterMarker = null;

  function buildClusters(filtered) {
    markerLayer.clearLayers();
    const zoom = map.getZoom();
    const cellSize = zoom < 3 ? 12 : zoom < 5 ? 6 : zoom < 7 ? 2.5 : 1.0;
    const cells = new Map();
    for (const d of filtered) {
      const cx = Math.round(d.lon / cellSize);
      const cy = Math.round(d.lat / cellSize);
      const key = cx + "," + cy;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(d);
    }
    const top = Array.from(cells.values())
      .filter(arr => arr.length >= 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, 30);
    for (const arr of top) {
      const lat = arr.reduce((s, d) => s + d.lat, 0) / arr.length;
      const lon = arr.reduce((s, d) => s + d.lon, 0) / arr.length;
      const n = arr.length;
      const size = Math.min(38, 20 + Math.log2(n) * 4);
      const icon = L.divIcon({ className: "cluster-marker", html: String(n), iconSize: [size, size] });
      const marker = L.marker([lat, lon], { icon, riseOnHover: true });
      marker.on("click", () => openPopupForGroup(arr, [lat, lon]));
      markerLayer.addLayer(marker);
    }
  }

  function openPopupForGroup(papers, latlon) {
    const institutions = new Map();
    const catCounts = new Map();
    for (const d of papers) {
      institutions.set(d.institution, (institutions.get(d.institution) || 0) + 1);
      catCounts.set(d.category, (catCounts.get(d.category) || 0) + 1);
    }
    const topInst = [...institutions].sort((a,b) => b[1] - a[1]).slice(0, 3);
    const topCats = [...catCounts].sort((a,b) => b[1] - a[1]).slice(0, 3);
    const sample  = papers.slice().sort((a,b) => b.year - a.year).slice(0, 3);
    const region  = papers[0].city || "Region";
    const country = papers[0].country || "";
    const html = `
      <div class="popup-title">${escape(region)}${country ? ", " + escape(country) : ""}</div>
      <div class="popup-meta">${papers.length} publications · ${[...new Set(papers.map(p=>p.year))].sort().join(", ")}</div>
      <div class="popup-section">
        <div class="h">Top institutions</div>
        ${topInst.map(([n, c]) => `<div style="font-size:12px;display:flex;justify-content:space-between;gap:8px;color:var(--fg);"><span>${escape(n)}</span><span style="color:var(--fg-dim);font-family:var(--font-mono);font-size:10px;">${c}</span></div>`).join("")}
      </div>
      <div class="popup-section">
        <div class="h">Categories</div>
        ${topCats.map(([k, c]) => `<div style="font-size:11px;display:flex;justify-content:space-between;font-family:var(--font-mono);color:var(--fg-mute);"><span style="color:var(--accent)">${escape(k)}</span><span>${c}</span></div>`).join("")}
      </div>
      <div class="popup-section">
        <div class="h">Recent papers</div>
        ${sample.map(p => `<div class="popup-paper"><a href="https://arxiv.org/abs/${escape(p.id)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="y">${p.year}</span><span class="c">${escape(p.category)}</span> ${escape(p.title)}</a></div>`).join("")}
      </div>
    `;
    L.popup({ className: "pub-popup", maxWidth: 320, closeButton: true })
      .setLatLng(latlon).setContent(html).openOn(map);
  }

  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function filteredData() {
    return data.filter(d => {
      if (state.yearMode === "single") {
        if (d.year !== state.yearSingle) return false;
      } else {
        if (d.year < state.yearMin || d.year > state.yearMax) return false;
      }
      if (state.domains.size > 0 && !state.domains.has(d.category)) return false;
      return true;
    });
  }

  function applyTheme() {
    const root = document.documentElement;
    root.setAttribute("data-direction", state.direction);
    root.setAttribute("data-mode", state.mode);
    root.style.setProperty("--ramp-stops", cssRampStops(resolveRamp()));
  }

  function render() {
    applyTheme();
    const filtered = filteredData();
    setHeat(filtered);
    buildClusters(filtered);
    renderStats(filtered);
    renderDomains();
    renderTimeline();
    renderYearDisplay();
    renderTweaks();
  }

  const elYearNow = document.getElementById("year-now");
  const elYearAxisL = document.getElementById("year-axis-l");
  const elYearAxisR = document.getElementById("year-axis-r");
  const elRangeMin = document.getElementById("year-min");
  const elRangeMax = document.getElementById("year-max");
  const elRangeSingle = document.getElementById("year-single");
  const elBars = document.getElementById("year-bars");

  function renderYearDisplay() {
    if (state.yearMode === "single") {
      elYearNow.textContent = state.yearSingle;
    } else {
      elYearNow.textContent = state.yearMin === state.yearMax
        ? state.yearMin
        : `${state.yearMin}–${state.yearMax}`;
    }
    elYearAxisL.textContent = yearMinAll;
    elYearAxisR.textContent = yearMaxAll;
  }

  function renderTimeline() {
    const yearCounts = {};
    for (let y = yearMinAll; y <= yearMaxAll; y++) yearCounts[y] = 0;
    for (const d of data) {
      if (state.domains.size > 0 && !state.domains.has(d.category)) continue;
      yearCounts[d.year] = (yearCounts[d.year] || 0) + 1;
    }
    const max = Math.max(...Object.values(yearCounts), 1);
    elBars.innerHTML = "";
    for (let y = yearMinAll; y <= yearMaxAll; y++) {
      const inRange = state.yearMode === "single"
        ? y === state.yearSingle
        : (y >= state.yearMin && y <= state.yearMax);
      const isCurrent = state.yearMode === "single" && y === state.yearSingle;
      const bar = document.createElement("div");
      bar.className = "timeline-bar" + (inRange ? " in-range" : "") + (isCurrent ? " current" : "");
      const h = Math.max(2, (yearCounts[y] / max) * 24);
      bar.style.height = h + "px";
      bar.title = `${y}: ${yearCounts[y]} papers`;
      elBars.appendChild(bar);
    }
    document.getElementById("range-slider").style.display = state.yearMode === "range" ? "block" : "none";
    document.getElementById("single-slider").style.display = state.yearMode === "single" ? "block" : "none";
    document.querySelectorAll(".range-mode button").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === state.yearMode);
    });
  }

  const elDomainList = document.getElementById("domain-list");
  const elDomainCount = document.getElementById("domain-count");
  function renderDomains() {
    const yearFilteredData = data.filter(d => {
      if (state.yearMode === "single") return d.year === state.yearSingle;
      return d.year >= state.yearMin && d.year <= state.yearMax;
    });
    const counts = new Map();
    for (const d of yearFilteredData) counts.set(d.category, (counts.get(d.category) || 0) + 1);
    const presentCats = [...counts.keys()].sort();
    const grouped = new Map();
    for (const cat of presentCats) {
      const g = (ARXIV_CATEGORIES[cat]?.group) || (cat.includes(".") ? cat.split(".")[0].toUpperCase() : "Other");
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g).push(cat);
    }
    elDomainList.innerHTML = "";

    const allItem = el("div", "domain-item" + (state.domains.size === 0 ? " active" : ""));
    allItem.innerHTML = `
      <div class="swatch" style="background:var(--accent)"></div>
      <div class="code">ALL</div>
      <div class="lbl">All domains</div>
      <div class="n">${yearFilteredData.length}</div>
    `;
    allItem.onclick = () => { state.domains.clear(); render(); };
    elDomainList.appendChild(allItem);

    for (const [g, list] of grouped) {
      const lbl = el("div", "domain-group-label");
      lbl.textContent = g;
      elDomainList.appendChild(lbl);
      for (const cat of list) {
        const item = el("div", "domain-item" + (state.domains.has(cat) ? " active" : ""));
        item.innerHTML = `
          <div class="swatch"></div>
          <div class="code">${escape(cat)}</div>
          <div class="lbl">${escape(ARXIV_CATEGORIES[cat]?.label || cat)}</div>
          <div class="n">${counts.get(cat) || 0}</div>
        `;
        item.onclick = () => {
          if (state.domains.has(cat)) state.domains.delete(cat);
          else state.domains.add(cat);
          render();
        };
        elDomainList.appendChild(item);
      }
    }
    elDomainCount.textContent = state.domains.size === 0 ? `${presentCats.length} avail` : `${state.domains.size} of ${presentCats.length}`;
  }

  const elStatsTotal = document.getElementById("stats-total");
  const elStatsUnit = document.getElementById("stats-unit");
  const elStatsTabs = document.getElementById("stats-tabs");
  const elStatsList = document.getElementById("stats-list");

  function renderStats(filtered) {
    elStatsTotal.textContent = filtered.length.toLocaleString();
    elStatsUnit.textContent = "papers (n)";
    const field = state.statsTab;
    const counts = new Map();
    for (const d of filtered) counts.set(d[field], (counts.get(d[field]) || 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = top[0]?.[1] || 1;
    elStatsList.innerHTML = "";
    top.forEach(([name, n], i) => {
      const li = el("li");
      li.innerHTML = `
        <div class="rank">${String(i + 1).padStart(2, "0")}</div>
        <div class="lbl" title="${escape(name)}">${escape(name)}</div>
        <div class="bar"><span style="width:${(n / max) * 100}%"></span></div>
        <div class="n">${n}</div>
      `;
      elStatsList.appendChild(li);
    });
    if (top.length === 0) {
      elStatsList.innerHTML = `<li style="color:var(--fg-dim);font-size:11px;font-family:var(--font-mono);">No matches</li>`;
    }
    elStatsTabs.querySelectorAll(".stats-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === state.statsTab);
    });
  }

  function renderTweaks() {
    document.querySelectorAll("[data-tweak]").forEach(el => {
      const k = el.dataset.tweak;
      const v = el.dataset.value;
      el.classList.toggle("active", String(state[k]) === String(v));
    });
    const sR = document.getElementById("tweak-radius");
    if (sR && document.activeElement !== sR) sR.value = state.radius;
    const sB = document.getElementById("tweak-blur");
    if (sB && document.activeElement !== sB) sB.value = state.blur;
    document.getElementById("tweak-radius-v").textContent = state.radius;
    document.getElementById("tweak-blur-v").textContent = state.blur;
    document.querySelectorAll(".ramp-chip").forEach(c => {
      const name = c.dataset.ramp;
      c.style.background = `linear-gradient(90deg, ${cssRampStops(name)})`;
      c.classList.toggle("active", resolveRamp() === name);
    });
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // ───── Cluster-centric semantic search UI ─────
  const elSearchInput = document.getElementById("search-input");
  const elSearchPanel = document.getElementById("search-panel");
  const elSearchResults = document.getElementById("search-results");
  const elSearchHint = document.getElementById("search-hint");

  let activeSearchClusters = [];
  let searchPending = false;
  let pendingQuery = null;

  async function runSearch(q) {
    if (!q) {
      elSearchPanel.classList.remove("has-results");
      elSearchResults.innerHTML = "";
      activeSearchClusters = [];
      return;
    }
    if (searchPending) { pendingQuery = q; return; }
    searchPending = true;
    elSearchHint.textContent = "…";
    try {
      activeSearchClusters = await window.PubSearch.search(q, { topClusters: 6, papersPerCluster: 5 });
      renderSearchResults(q);
    } catch (err) {
      console.error("Search failed:", err);
      elSearchPanel.classList.add("has-results");
      elSearchResults.innerHTML = `<div class="search-empty">Search error: ${escape(err.message)}</div>`;
    } finally {
      searchPending = false;
      elSearchHint.textContent = "⏎";
      if (pendingQuery && pendingQuery !== q) {
        const nxt = pendingQuery; pendingQuery = null;
        runSearch(nxt);
      } else {
        pendingQuery = null;
      }
    }
  }

  function renderSearchResults(query) {
    elSearchResults.innerHTML = "";
    if (activeSearchClusters.length === 0) {
      elSearchPanel.classList.add("has-results");
      const empty = el("div", "search-empty");
      empty.textContent = "No matching hotspots.";
      elSearchResults.appendChild(empty);
      return;
    }
    elSearchPanel.classList.add("has-results");

    activeSearchClusters.forEach((r, i) => {
      const c = r.cluster;
      const item = el("div", "search-result cluster-result" + (i === state.selectedClusterIdx ? " active" : ""));
      const label = [c.top_city, c.top_country].filter(Boolean).join(", ") || `Cluster ${c.cluster_id}`;
      item.innerHTML = `
        <div class="title cluster-head">
          <span class="chev">▸</span>
          <span class="rank">${String(i + 1).padStart(2, "0")}</span>
          <span class="lbl">${escape(label)}</span>
          <span class="meta-right">
            <span class="n">${r.nPapersInCluster} papers</span>
            <span class="score" title="Cumulative cosine similarity (top ${r.topPapers.length})">σ = ${r.score.toFixed(2)}</span>
          </span>
        </div>
        <div class="cluster-body">
          ${r.topPapers.map(p => `
            <a class="paper-row" href="https://arxiv.org/abs/${escape(p.doc.id)}" target="_blank" rel="noopener">
              <div class="paper-title">${window.PubSearch.highlight(p.doc.title, query)}</div>
              <div class="paper-meta">
                <span class="cat">${escape(p.doc.category)}</span>
                <span>${p.doc.year}</span>
                <span class="inst">${escape(p.doc.institution || "")}</span>
                <span class="sim">cos = ${p.sim.toFixed(3)}</span>
              </div>
            </a>
          `).join("")}
        </div>
      `;
      const head = item.querySelector(".cluster-head");
      head.addEventListener("click", () => {
        item.classList.toggle("open");
        if (item.classList.contains("open") && c.centroid) {
          map.flyTo(c.centroid, Math.max(map.getZoom(), 5), { duration: 0.8 });
        }
      });
      head.addEventListener("mouseenter", () => {
        if (c.centroid) showClusterHighlight(c.centroid);
        state.selectedClusterIdx = i;
      });
      head.addEventListener("mouseleave", clearClusterHighlight);
      elSearchResults.appendChild(item);
    });

    // Auto-open the top result
    const first = elSearchResults.querySelector(".cluster-result");
    if (first) first.classList.add("open");
  }

  function showClusterHighlight(latlon) {
    clearClusterHighlight();
    highlightedClusterMarker = L.circleMarker(latlon, {
      radius: 18, color: "var(--accent)", weight: 2, fillOpacity: 0.15,
      interactive: false, className: "cluster-highlight"
    }).addTo(map);
  }
  function clearClusterHighlight() {
    if (highlightedClusterMarker) { map.removeLayer(highlightedClusterMarker); highlightedClusterMarker = null; }
  }

  function wireEvents() {
    elRangeMin.min = elRangeMax.min = elRangeSingle.min = yearMinAll;
    elRangeMin.max = elRangeMax.max = elRangeSingle.max = yearMaxAll;
    elRangeMin.value = state.yearMin;
    elRangeMax.value = state.yearMax;
    elRangeSingle.value = state.yearSingle;

    function clampRange() {
      let a = +elRangeMin.value, b = +elRangeMax.value;
      if (a > b) { [a, b] = [b, a]; }
      state.yearMin = a; state.yearMax = b;
      elRangeMin.value = a; elRangeMax.value = b;
      render();
    }
    elRangeMin.addEventListener("input", clampRange);
    elRangeMax.addEventListener("input", clampRange);
    elRangeSingle.addEventListener("input", () => {
      state.yearSingle = +elRangeSingle.value;
      renderYearDisplay();
      render();
    });
    document.querySelectorAll(".range-mode button").forEach(b => {
      b.addEventListener("click", () => { state.yearMode = b.dataset.mode; render(); });
    });
    elStatsTabs.querySelectorAll(".stats-tab").forEach(b => {
      b.addEventListener("click", () => { state.statsTab = b.dataset.tab; render(); });
    });

    let searchDebounce = null;
    elSearchInput.addEventListener("input", () => {
      state.search = elSearchInput.value.trim();
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => runSearch(state.search), 350);
    });
    elSearchInput.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        elSearchInput.value = ""; state.search = ""; runSearch("");
      } else if (e.key === "Enter") {
        if (searchDebounce) clearTimeout(searchDebounce);
        runSearch(state.search);
      }
    });

    document.getElementById("play-btn").addEventListener("click", togglePlay);
    document.getElementById("tweaks-toggle").addEventListener("click", () => {
      document.getElementById("tweaks-panel").classList.toggle("open");
    });
    document.getElementById("tweaks-close").addEventListener("click", () => {
      document.getElementById("tweaks-panel").classList.remove("open");
    });

    document.querySelectorAll("[data-tweak]").forEach(b => {
      if (b.dataset.value == null) return;
      b.addEventListener("click", () => {
        const k = b.dataset.tweak; const v = b.dataset.value;
        state[k] = isNaN(+v) ? v : (+v);
        if (k === "tiles") setTiles();
        render();
      });
    });
    document.getElementById("tweak-radius").addEventListener("input", e => {
      state.radius = +e.target.value;
      document.getElementById("tweak-radius-v").textContent = state.radius;
      setHeat(filteredData());
    });
    document.getElementById("tweak-blur").addEventListener("input", e => {
      state.blur = +e.target.value;
      document.getElementById("tweak-blur-v").textContent = state.blur;
      setHeat(filteredData());
    });
    document.querySelectorAll(".ramp-chip").forEach(c => {
      c.addEventListener("click", () => {
        state.ramp = c.dataset.ramp;
        render(); setHeat(filteredData());
      });
    });

    map.on("zoomend", () => buildClusters(filteredData()));
    map.on("click", e => {
      const here = e.latlng;
      const filtered = filteredData();
      const near = filtered.filter(d => {
        const dx = d.lon - here.lng, dy = d.lat - here.lat;
        return Math.hypot(dx, dy) < 6;
      }).sort((a, b) => Math.hypot(a.lon - here.lng, a.lat - here.lat) - Math.hypot(b.lon - here.lng, b.lat - here.lat));
      if (near.length === 0) return;
      openPopupForGroup(near.slice(0, 12), [here.lat, here.lng]);
    });
  }

  function togglePlay() {
    state.playing = !state.playing;
    document.getElementById("play-btn").innerHTML = state.playing
      ? `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="0.5"/><rect x="9.5" y="2" width="3.5" height="12" rx="0.5"/></svg>`
      : `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2 L13 8 L3 14 Z"/></svg>`;
    if (state.playing) {
      state.yearMode = "single";
      if (state.yearSingle < yearMinAll || state.yearSingle > yearMaxAll) state.yearSingle = yearMinAll;
      state.playTimer = setInterval(() => {
        state.yearSingle = state.yearSingle >= yearMaxAll ? yearMinAll : state.yearSingle + 1;
        elRangeSingle.value = state.yearSingle;
        render();
      }, 900);
    } else {
      clearInterval(state.playTimer);
    }
    render();
  }

  function setLoadingMessage(msg) {
    const el = document.querySelector("#loading .msg");
    if (el) el.textContent = msg;
  }

  async function boot() {
    setTiles();
    applyTheme();
    try {
      setLoadingMessage("Fetching dataset…");
      const [papersResp, clustersResp] = await Promise.all([
        fetch("data/papers_sample.json"),
        fetch("data/clusters.json")
      ]);
      if (!papersResp.ok) throw new Error(`papers_sample.json: ${papersResp.status}`);
      if (!clustersResp.ok) throw new Error(`clusters.json: ${clustersResp.status}`);
      data = await papersResp.json();
      clusters = await clustersResp.json();
    } catch (err) {
      console.error(err);
      setLoadingMessage("Run scripts/build_dataset.py to generate data files.");
      return;
    }

    // Normalize: ensure each paper has a primary `category` field for filtering.
    for (const d of data) {
      if (!d.category && d.categories) {
        d.category = Array.isArray(d.categories) ? d.categories[0] : String(d.categories).split(/\s+/)[0];
      }
    }
    years = [...new Set(data.map(d => d.year))].sort((a,b) => a-b);
    yearMinAll = years[0] ?? 2018;
    yearMaxAll = years[years.length - 1] ?? 2025;
    state.yearMin = yearMinAll;
    state.yearMax = yearMaxAll;
    state.yearSingle = yearMaxAll;

    wireEvents();
    render();
    document.getElementById("loading").classList.add("hidden");

    setLoadingMessage("Loading semantic model…");
    try {
      await window.PubSearch.init({ papers: data, clusters });
      elSearchInput.disabled = false;
      elSearchHint.textContent = "⏎";
      elSearchInput.placeholder = "Search abstracts semantically…";
    } catch (err) {
      console.error("PubSearch init failed:", err);
      elSearchHint.textContent = "⚠";
      elSearchInput.placeholder = "Semantic search unavailable (see console)";
    }
  }

  boot();
})();
