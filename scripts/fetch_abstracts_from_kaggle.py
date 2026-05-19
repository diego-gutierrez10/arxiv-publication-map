"""
fetch_abstracts_from_kaggle.py — extrae abstracts del dataset bulk de Cornell
University en Kaggle (`Cornell-University/arxiv`), sin tocar la arXiv API.

Por qué: la arXiv API tiene rate-limit estricto (1 req / 3 s) y a veces
bloquea sesiones largas con HTTP 429. Para fetches grandes (>50k papers) es
mucho más confiable usar el dump oficial de Cornell que está hospedado en
Kaggle como un JSONL de ~4 GB con TODOS los abstracts (2.3M+ papers, hasta
~2024).

Flujo:
  1. (Una vez) Descargar el dataset de Kaggle:
       https://www.kaggle.com/datasets/Cornell-University/arxiv
     O vía CLI:
       pip install kaggle
       # configurar ~/.kaggle/kaggle.json con tu API token
       kaggle datasets download -d Cornell-University/arxiv -p ~/Downloads
       unzip ~/Downloads/arxiv.zip
     → te deja arxiv-metadata-oai-snapshot.json (~4 GB)

  2. Correr este script:
       python scripts/fetch_abstracts_from_kaggle.py \\
           --jsonl ~/Downloads/arxiv-metadata-oai-snapshot.json
     Lee el JSONL en streaming (línea por línea, no carga todo a RAM),
     filtra solo los IDs que nos interesan (los del CSV geocodificado),
     y los añade al cache `data/abstracts_cache.json`.

  3. Correr build_dataset.py normal — leerá el cache lleno y NO tocará la
     arXiv API.

Tamaños y tiempos:
  - Descarga del JSONL en Kaggle: ~10 min (depende de red)
  - Este script en streaming: ~2-3 min (procesa 2.3M líneas)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd
from tqdm import tqdm

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Reusamos el normalizador del pipeline principal
sys.path.insert(0, str(REPO_ROOT / "scripts"))
from build_dataset import normalize_arxiv_id  # noqa: E402


def load_target_ids(csv_path: Path) -> set[str]:
    """Lee el CSV geocodificado, normaliza los IDs, devuelve el set único."""
    print(f"[1/3] Leyendo IDs del CSV: {csv_path}")
    df = pd.read_csv(csv_path, usecols=["arxiv_id"], dtype={"arxiv_id": str})
    df = df.dropna(subset=["arxiv_id"])
    ids = set()
    for raw in df["arxiv_id"]:
        norm = normalize_arxiv_id(str(raw))
        if norm:
            ids.add(norm)
    print(f"      IDs únicos normalizados: {len(ids):,}")
    return ids


def stream_kaggle_jsonl(
    jsonl_path: Path,
    target_ids: set[str],
    cache_path: Path,
    flush_every: int = 100_000,
) -> dict[str, str]:
    """Recorre el JSONL línea por línea, extrae abstracts para los target IDs.

    El JSONL de Kaggle tiene ~2.3M líneas. Procesamos en streaming para no
    cargar 4 GB a RAM. Solo guardamos las abstracts que matcheen contra
    target_ids.
    """
    print(f"[2/3] Streaming JSONL: {jsonl_path}")
    if not jsonl_path.exists():
        sys.exit(f"❌ No existe {jsonl_path}. Descarga el dataset primero.")

    # Carga cache previo si existe (idempotente: no re-procesa lo que ya está)
    cache: dict[str, str] = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())
        print(f"      Cache previo: {len(cache):,} entradas (se conservarán)")
    before = len(cache)

    # IDs aún faltantes (los que no están en cache)
    pending = target_ids - set(cache.keys())
    print(f"      Pendientes de extraer: {len(pending):,}")
    if not pending:
        print("      ✓ Ya tienes todo cacheado, nada que hacer.")
        return cache

    found = 0
    lines_seen = 0

    # Estima total de líneas para tqdm (lectura rápida en streaming)
    print("      Contando líneas del JSONL (rápido, no carga contenido) …")
    total_lines = 0
    with open(jsonl_path, "rb") as f:
        for _ in f:
            total_lines += 1
    print(f"      Total: {total_lines:,} líneas a recorrer")

    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in tqdm(f, total=total_lines, desc="líneas", unit="line"):
            lines_seen += 1
            try:
                # Parse rápido: si la línea no tiene "id" y "abstract", skip.
                # json.loads es razonablemente rápido en CPython.
                obj = json.loads(line)
            except Exception:
                continue
            aid = obj.get("id", "")
            if not aid:
                continue
            # El Kaggle dataset trae IDs ya en formato canonical (sin floats rotos)
            # pero por si acaso lo normalizamos
            aid_norm = normalize_arxiv_id(aid) or aid
            if aid_norm not in pending:
                continue
            abstract = obj.get("abstract", "").strip()
            if not abstract:
                continue
            # Limpia whitespace múltiple
            abstract = re.sub(r"\s+", " ", abstract)
            cache[aid_norm] = abstract
            found += 1
            if found % flush_every == 0:
                tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
                tmp.write_text(json.dumps(cache, ensure_ascii=False))
                tmp.replace(cache_path)

    # Flush final
    tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False))
    tmp.replace(cache_path)

    covered = sum(1 for i in target_ids if i in cache)
    missing = len(target_ids) - covered
    print(f"\n[3/3] Resultados:")
    print(f"      Cache previo:        {before:,}")
    print(f"      Nuevos extraídos:    {found:,}")
    print(f"      Total ahora:         {len(cache):,}")
    print(f"      Coverage del target: {covered:,}/{len(target_ids):,} "
          f"({100*covered/len(target_ids):.1f}%)")
    if missing:
        print(f"      ⚠  IDs no encontrados en el JSONL: {missing:,}")
        print(f"          (probablemente withdrawn de arXiv o de antes del snapshot)")
    return cache


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--jsonl", required=True,
                   help="Ruta al arxiv-metadata-oai-snapshot.json descargado de Kaggle")
    p.add_argument("--csv", default=str(DATA_DIR / "arxiv_locations_geocoded.csv"),
                   help="CSV geocodificado del proyecto (para saber qué IDs queremos)")
    p.add_argument("--cache", default=str(DATA_DIR / "abstracts_cache.json"))
    args = p.parse_args()

    target = load_target_ids(Path(args.csv))
    stream_kaggle_jsonl(Path(args.jsonl), target, Path(args.cache))


if __name__ == "__main__":
    main()
