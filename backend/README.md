---
title: ArXiv Publication Map API
emoji: 🗺️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# ArXiv Publication Map — Semantic Search API

Microservicio FastAPI que sirve búsqueda semántica clúster-céntrica sobre 10 000 papers de arXiv geocodificados. Es el backend del proyecto [arxiv-publication-map](https://github.com/diego-gutierrez10/arxiv-publication-map) (frontend estático en GitHub Pages).

## Arquitectura

```
GitHub Pages (frontend estático)  →  POST /search  →  HF Spaces (este servicio)
                                  ←  {clusters: …}  ←
```

- **Modelo**: `mixedbread-ai/mxbai-embed-large-v1` (335M params, 1024-d, top MTEB 2024)
- **Embeddings**: pre-computados offline con `scripts/build_embeddings.py`, persistidos como `Float32Array(N, 1024)` en `data/embeddings.bin` (~40 MB para N=10 000)
- **Búsqueda**: cosine similarity (= dot product, todo L2-normalizado), agregado por `cluster_id` (DBSCAN sobre lat/lon en preprocesamiento)

## Endpoints

### `GET /`
Healthcheck + metadata.

```json
{
  "service": "arxiv-publication-map-api",
  "status": "ok",
  "model": "mixedbread-ai/mxbai-embed-large-v1",
  "embedding_dim": 1024,
  "n_papers": 10000,
  "n_clusters": 470
}
```

### `POST /search`

```json
// request
{ "query": "fruit detection computer vision", "top_clusters": 5, "papers_per_cluster": 5 }

// response
{
  "query": "...",
  "took_ms": 152,
  "model": "mixedbread-ai/mxbai-embed-large-v1",
  "clusters": [
    {
      "cluster_id": 12,
      "centroid": [40.71, -74.0],
      "n_papers": 23,
      "top_city": "New York", "top_country": "United States",
      "top_institution": "Cornell University",
      "score": 4.82,
      "top_papers": [ { "id": "2110.12162", "title": "...", "similarity": 0.487, ... } ]
    }
  ]
}
```

## Setup local

```bash
pip install -r requirements.txt
# Asegúrate de que data/papers_sample.json, data/clusters.json y data/embeddings.bin existan
python app.py            # uvicorn en :7860
# o
uvicorn app:app --reload
```

## Deploy a Hugging Face Spaces

1. Crear un Space con SDK = Docker en https://huggingface.co/new-space
2. Clonar el repo del Space y copiar los archivos de este folder (`app.py`, `Dockerfile`, `requirements.txt`, `README.md`, `data/`)
3. `git push` — HF compila el Docker en ~5 min y lo deja vivo en `https://USUARIO-NOMBRE.hf.space`

## Variables de entorno

| Var | Default | Descripción |
|---|---|---|
| `MODEL_NAME` | `mixedbread-ai/mxbai-embed-large-v1` | Modelo de sentence-transformers |
| `EMBEDDING_DIM` | `1024` | Dim esperada del embedding |
| `QUERY_PREFIX` | `"Represent this sentence for searching relevant passages: "` | Prefijo de query (vacío para MiniLM) |
| `DATA_DIR` | `./data` | Ruta a los assets |
| `ALLOWED_ORIGINS` | `https://diego-gutierrez10.github.io,http://localhost:8000,http://127.0.0.1:8000` | CORS origins permitidos |
