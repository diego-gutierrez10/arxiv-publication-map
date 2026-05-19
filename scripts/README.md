# Data pipeline

Two-step pipeline to feed the frontend. Both scripts are idempotent and write to `../data/`.

## 1. Install deps

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt
```

## 2. Build dataset (subsample + arXiv API + DBSCAN)

```bash
python scripts/build_dataset.py --n 10000
```

Reads `data/arxiv_locations_geocoded.csv` (the 333 MB geocoded file from the original Data Mining project), deduplicates by `arxiv_id`, subsamples N papers, fetches their abstracts from the arXiv API (rate-limited at ~1 req / 3 s), runs DBSCAN over (lat, lon), and writes:

- `data/papers_sample.json` — array of `{id, title, abstract, year, category, institution, city, country, lat, lon, cluster_id}`
- `data/clusters.json` — array of `{cluster_id, centroid, n_papers, top_city, top_country, top_institution}`

Expected runtime for n=10 000: ~10 minutes (mostly arXiv rate-limit).

## 3. Build embeddings (sentence-transformers)

```bash
python scripts/build_embeddings.py
```

Loads `data/papers_sample.json`, encodes `title + ". " + abstract` with `sentence-transformers/all-MiniLM-L6-v2` (384-d, L2-normalized), and writes:

- `data/embeddings.bin` — raw `Float32Array(N, 384)` (≈ 15 MB for N=10 000)

The browser side (`js/search.js`) loads this buffer via `fetch().arrayBuffer()`, then uses **Transformers.js with the same model** (`Xenova/all-MiniLM-L6-v2`, quantized) to embed the user's query in-browser. Cosine similarity = dot product (both sides are normalized).

## Scaling to 1.1M papers (future)

- 1.1M × 384 × 4 bytes = ~1.7 GB; GitHub Pages caps single files at 100 MB.
- Strategy: int8 quantization (→ ~420 MB) + sharding by region or arXiv category into <90 MB chunks, downloaded on demand from the viewport.
- Or host the embeddings on Hugging Face Hub / Cloudflare R2 and serve via CORS.
