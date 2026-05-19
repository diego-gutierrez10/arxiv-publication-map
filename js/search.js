/* ============================================================================
   Semantic meta-search — backend-powered (FastAPI on Hugging Face Spaces).

   La inferencia ya NO sucede en el navegador: ni el modelo ni los embeddings
   se descargan al cliente. Esta capa es un cliente HTTP que envía la query al
   backend y formatea la respuesta para que app.js no se entere de la
   diferencia (API pública idéntica a la versión in-browser).

   Configuración: definir window.PUBSEARCH_API_URL antes de cargar este script
   (ver index.html). Por defecto apunta a http://localhost:7860 para dev local.

   Public API on window.PubSearch:
     await init({ papers, clusters })  — solo guarda metadata; no descarga nada
     await search(query, { topClusters = 5, papersPerCluster = 5 })
     ready()  → bool
     highlight(text, query) → HTML con <mark>
   ============================================================================ */
(function () {
  const API_URL = (window.PUBSEARCH_API_URL || 'http://localhost:7860').replace(/\/$/, '');
  const SEARCH_ENDPOINT = `${API_URL}/search`;
  const HEALTH_ENDPOINT = `${API_URL}/`;
  const REQUEST_TIMEOUT_MS = 30_000;  // primer request cold-start puede tardar

  let docs = null;            // papers crudos para que app.js los siga usando si quiere
  let clustersById = null;    // Map<cluster_id, cluster meta>
  let ready = false;
  let initPromise = null;

  async function init({ papers, clusters }) {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      docs = papers;
      clustersById = new Map(clusters.map(c => [c.cluster_id, c]));
      // Healthcheck no-bloqueante: si falla, search() reporta el error.
      try {
        const r = await fetchWithTimeout(HEALTH_ENDPOINT, { method: 'GET' }, 5_000);
        if (r.ok) {
          const meta = await r.json();
          console.info('[PubSearch] backend ready', meta);
        } else {
          console.warn('[PubSearch] backend healthcheck non-OK', r.status);
        }
      } catch (e) {
        console.warn('[PubSearch] backend unreachable on init (may be cold-starting):', e.message);
      }
      ready = true;
    })();
    return initPromise;
  }

  async function search(query, { topClusters = 5, papersPerCluster = 5 } = {}) {
    if (!ready) throw new Error('PubSearch not initialized');
    const body = JSON.stringify({
      query,
      top_clusters: topClusters,
      papers_per_cluster: papersPerCluster,
    });

    let res;
    try {
      res = await fetchWithTimeout(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }, REQUEST_TIMEOUT_MS);
    } catch (e) {
      throw new Error(`Backend unreachable: ${e.message}`);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail || ''; } catch (_) {}
      throw new Error(`Search failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
    }
    const payload = await res.json();

    // Mapear shape backend → shape esperado por app.js:
    //   ranked = [{ cluster, topPapers, score, nPapersInCluster }]
    // Backend devuelve cluster ya con n_papers absoluto del cluster; usamos eso
    // como nPapersInCluster (en la versión in-browser era el conteo agregado).
    return payload.clusters.map(c => ({
      cluster: clustersById.get(c.cluster_id) || {
        cluster_id: c.cluster_id,
        centroid: c.centroid,
        n_papers: c.n_papers,
        top_city: c.top_city,
        top_country: c.top_country,
        top_institution: c.top_institution,
      },
      topPapers: c.top_papers.map(p => ({
        doc: {
          id: p.id,
          title: p.title,
          abstract: p.abstract,
          year: p.year,
          category: p.category,
          institution: p.institution,
          city: p.city,
          country: p.country,
          lat: p.lat,
          lon: p.lon,
        },
        sim: p.similarity,
      })),
      score: c.score,
      nPapersInCluster: c.n_papers,
    }));
  }

  // ───────── helpers ─────────
  function fetchWithTimeout(url, opts = {}, timeoutMs = 10_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  function highlight(text, query) {
    if (!text || !query) return escapeHtml(text || '');
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9À-ɏ\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3);
    if (tokens.length === 0) return escapeHtml(text);
    let out = escapeHtml(text);
    for (const t of new Set(tokens)) {
      const re = new RegExp(`(${escapeRe(t)})`, 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  window.PubSearch = {
    init,
    search,
    highlight,
    ready: () => ready,
    apiUrl: () => API_URL,
  };
})();
