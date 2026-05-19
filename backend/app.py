"""
ArXiv Publication Map — Semantic Search API

FastAPI microservicio que sirve búsqueda semántica sobre los abstracts pre-
embebidos. Pensado para correr en Hugging Face Spaces (Docker SDK) y ser
consumido desde el frontend estático en GitHub Pages.

Arquitectura:
  - Carga UNA VEZ al boot: modelo (mxbai-embed-large-v1), embeddings.bin
    (Float32Array N×D, L2-normalizado), y papers_sample.json + clusters.json
    (metadatos).
  - Por cada query: prefija con el prompt de retrieval de mxbai, embebe,
    calcula similitudes coseno (= producto punto, todo está L2-normalizado),
    agrupa por cluster_id, suma scores, devuelve top-K clusters con sus
    top-N papers más similares.

Endpoints:
  - GET  /           — healthcheck + metadata
  - POST /search     — búsqueda semántica clúster-céntrica

Variables de entorno relevantes:
  - MODEL_NAME       — override del modelo (default: mxbai-embed-large-v1)
  - EMBEDDING_DIM    — dimensión esperada (default: 1024)
  - DATA_DIR         — ruta a los assets (default: ./data)
  - ALLOWED_ORIGINS  — comma-separated, p.ej. "https://diego-gutierrez10.github.io,http://localhost:8000"
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("arxiv-api")

# ──────────────────── Config ────────────────────
MODEL_NAME = os.getenv("MODEL_NAME", "mixedbread-ai/mxbai-embed-large-v1")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1024"))
DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).resolve().parent / "data")))
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://diego-gutierrez10.github.io,http://localhost:8000,http://127.0.0.1:8000"
    ).split(",") if o.strip()
]

# Prefijo de query para mxbai-embed-large-v1. Si cambias de modelo, ajusta o vacía:
#   - mxbai/bge:     "Represent this sentence for searching relevant passages: "
#   - nomic-embed:   "search_query: " (passages: "search_document: ")
#   - MiniLM/E5-base sin prefijo:  ""
QUERY_PREFIX = os.getenv(
    "QUERY_PREFIX",
    "Represent this sentence for searching relevant passages: ",
)

# ──────────────────── Estado global (cargado al boot) ────────────────────
class State:
    model: SentenceTransformer | None = None
    papers: list[dict[str, Any]] = []
    clusters_by_id: dict[int, dict[str, Any]] = {}
    embeddings: np.ndarray | None = None  # shape (N, D), float32, L2-normalizado
    cluster_id_per_paper: np.ndarray | None = None  # shape (N,), int


state = State()


def load_assets() -> None:
    """Carga modelo + embeddings + metadatos. Idempotente."""
    if state.model is not None:
        return

    t0 = time.time()
    papers_path = DATA_DIR / "papers_sample.json"
    clusters_path = DATA_DIR / "clusters.json"
    embeddings_path = DATA_DIR / "embeddings.bin"

    for p in (papers_path, clusters_path, embeddings_path):
        if not p.exists():
            raise FileNotFoundError(f"Asset faltante: {p}")

    log.info("Cargando papers + clusters …")
    papers = json.loads(papers_path.read_text())
    clusters = json.loads(clusters_path.read_text())
    state.papers = papers
    state.clusters_by_id = {c["cluster_id"]: c for c in clusters}
    state.cluster_id_per_paper = np.array([p["cluster_id"] for p in papers], dtype=np.int32)

    log.info("Cargando embeddings (%s) …", embeddings_path)
    raw = np.fromfile(embeddings_path, dtype=np.float32)
    n_expected = len(papers)
    if raw.size != n_expected * EMBEDDING_DIM:
        raise ValueError(
            f"Tamaño inesperado de embeddings.bin: {raw.size} floats; "
            f"esperaba {n_expected} × {EMBEDDING_DIM} = {n_expected * EMBEDDING_DIM}"
        )
    state.embeddings = raw.reshape(n_expected, EMBEDDING_DIM)
    norms = np.linalg.norm(state.embeddings, axis=1)
    log.info("  shape=%s  norma media=%.4f  (esperado ≈ 1.0)", state.embeddings.shape, norms.mean())

    log.info("Cargando modelo: %s …", MODEL_NAME)
    state.model = SentenceTransformer(MODEL_NAME)
    log.info("Modelo listo (boot total: %.1fs)", time.time() - t0)


# ──────────────────── App + CORS ────────────────────
app = FastAPI(
    title="ArXiv Publication Map — Semantic Search API",
    description="Búsqueda semántica clúster-céntrica sobre 10k+ papers de arXiv geocodificados.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS else ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    load_assets()


# ──────────────────── Schemas ────────────────────
class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=512, description="Texto libre a buscar")
    top_clusters: int = Field(5, ge=1, le=30)
    papers_per_cluster: int = Field(5, ge=1, le=20)


class PaperHit(BaseModel):
    id: str
    title: str
    abstract: str = ""   # opcional — los abstracts ya están horneados en los embeddings;
                         # el JSON de papers en producción no los lleva para ahorrar disco/RAM
    year: int
    category: str
    institution: str
    city: str
    country: str
    lat: float
    lon: float
    similarity: float


class ClusterHit(BaseModel):
    cluster_id: int
    centroid: list[float]
    n_papers: int
    top_city: str
    top_country: str
    top_institution: str
    score: float
    top_papers: list[PaperHit]


class SearchResponse(BaseModel):
    query: str
    took_ms: int
    model: str
    n_total_papers: int
    n_clusters_considered: int
    clusters: list[ClusterHit]


# ──────────────────── Endpoints ────────────────────
@app.get("/")
def root():
    return {
        "service": "arxiv-publication-map-api",
        "status": "ok" if state.model is not None else "loading",
        "model": MODEL_NAME,
        "embedding_dim": EMBEDDING_DIM,
        "n_papers": len(state.papers),
        "n_clusters": len(state.clusters_by_id),
        "endpoints": {"POST /search": "semantic search (cluster-centric)"},
    }


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest):
    if state.model is None or state.embeddings is None:
        raise HTTPException(status_code=503, detail="Modelo aún cargando, intenta en unos segundos")

    t0 = time.time()
    prefixed_query = f"{QUERY_PREFIX}{req.query}"
    q_emb = state.model.encode(
        [prefixed_query],
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    ).astype(np.float32)[0]

    # Producto punto entre query y todos los embeddings (cos sim por norma unitaria)
    sims = state.embeddings @ q_emb  # shape (N,)

    # Agregar por cluster: top-K papers por cluster, score = suma de sims
    cluster_ids = state.cluster_id_per_paper
    by_cluster: dict[int, list[int]] = {}
    for i, cid in enumerate(cluster_ids):
        if cid < 0:  # ignorar ruido
            continue
        by_cluster.setdefault(int(cid), []).append(i)

    ranked: list[tuple[int, float, list[int]]] = []
    for cid, idxs in by_cluster.items():
        # Tomar los top-N papers más similares de este cluster
        local_sims = sims[idxs]
        # argpartition para top-N rápido, luego sort
        k = min(req.papers_per_cluster, len(idxs))
        top_local_pos = np.argpartition(-local_sims, k - 1)[:k] if k > 0 else np.array([], dtype=int)
        # ordenar por sim descendente
        top_local_pos = top_local_pos[np.argsort(-local_sims[top_local_pos])]
        top_idxs = [idxs[p] for p in top_local_pos]
        score = float(local_sims[top_local_pos].sum())
        ranked.append((cid, score, top_idxs))

    ranked.sort(key=lambda r: r[1], reverse=True)
    ranked = ranked[: req.top_clusters]

    hits: list[ClusterHit] = []
    for cid, score, top_idxs in ranked:
        meta = state.clusters_by_id.get(cid)
        if meta is None:
            continue
        top_papers = [
            PaperHit(
                id=state.papers[i]["id"],
                title=state.papers[i]["title"],
                abstract=state.papers[i].get("abstract", ""),
                year=int(state.papers[i]["year"]),
                category=state.papers[i].get("category", ""),
                institution=state.papers[i].get("institution", ""),
                city=state.papers[i].get("city", ""),
                country=state.papers[i].get("country", ""),
                lat=float(state.papers[i]["lat"]),
                lon=float(state.papers[i]["lon"]),
                similarity=float(sims[i]),
            )
            for i in top_idxs
        ]
        hits.append(ClusterHit(
            cluster_id=cid,
            centroid=meta["centroid"],
            n_papers=meta["n_papers"],
            top_city=meta.get("top_city", ""),
            top_country=meta.get("top_country", ""),
            top_institution=meta.get("top_institution", ""),
            score=round(score, 4),
            top_papers=top_papers,
        ))

    took_ms = int((time.time() - t0) * 1000)
    log.info("query=%r → %d clusters, %d ms", req.query, len(hits), took_ms)
    return SearchResponse(
        query=req.query,
        took_ms=took_ms,
        model=MODEL_NAME,
        n_total_papers=len(state.papers),
        n_clusters_considered=len(by_cluster),
        clusters=hits,
    )


if __name__ == "__main__":
    import uvicorn
    load_assets()
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7860")))
