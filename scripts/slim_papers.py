"""
slim_papers.py — produce una versión "slim" de papers_sample.json eliminando
los campos pesados que el backend no necesita en producción.

Por qué:
  - El campo `abstract` (≈800-1500 chars/paper) representa ~80% del tamaño y
    NO se usa para retrieval — la información ya está horneada en el embedding
    de 1024-d. Solo se devolvía como filler en PaperHit.abstract, que ahora es
    opcional con default "".
  - El campo `categories` (lista completa de categorías arXiv) es redundante
    con `category` (primaria), que es lo único que el endpoint /search devuelve.

Ahorro típico: 224 MB → ~35-45 MB en el dataset completo (177k papers).
Beneficios concretos:
  - Boot del backend más rápido (json.loads sobre archivo más chico).
  - Menos RAM ocupada por papers parseados (~600 MB → ~80 MB).
  - Push a Git LFS / HF Spaces 5-6× más rápido.

Uso:
    python scripts/slim_papers.py
    python scripts/slim_papers.py \\
        --in backend/data/papers_sample.json \\
        --out backend/data/papers_sample_slim.json
    python scripts/slim_papers.py --in-place    # sobreescribe (con backup automático)
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DATA = REPO_ROOT / "backend" / "data"

# Campos que el backend necesita (todos los demás se descartan)
KEEP_FIELDS = {
    "id",          # arxiv_id — clave del paper
    "title",       # mostrado en respuesta de search
    "year",        # mostrado + filtros temporales
    "category",    # categoría arXiv primaria
    "institution", # mostrado en respuesta
    "city",        # mostrado + agrupaciones top-city
    "country",     # mostrado + agrupaciones top-country
    "lat",         # coordenada geográfica
    "lon",         # coordenada geográfica
    "cluster_id",  # asignación DBSCAN, usada para agregación
}


def slim_papers(papers: list[dict]) -> list[dict]:
    return [{k: p[k] for k in KEEP_FIELDS if k in p} for p in papers]


def fmt_size(path: Path) -> str:
    b = path.stat().st_size
    if b < 1024:
        return f"{b} B"
    if b < 1024 * 1024:
        return f"{b/1024:.1f} KB"
    return f"{b/1024/1024:.1f} MB"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", default=str(BACKEND_DATA / "papers_sample.json"),
                   help="Archivo de entrada (default: backend/data/papers_sample.json)")
    p.add_argument("--out", default=str(BACKEND_DATA / "papers_sample_slim.json"),
                   help="Archivo de salida (default: backend/data/papers_sample_slim.json)")
    p.add_argument("--in-place", action="store_true",
                   help="Sobreescribe el archivo de entrada (deja backup .full.json)")
    args = p.parse_args()

    src = Path(args.inp)
    if not src.exists():
        sys.exit(f"❌ No existe {src}")

    print(f"Leyendo {src} ({fmt_size(src)}) …")
    papers = json.loads(src.read_text())
    print(f"  papers totales: {len(papers):,}")
    sample_keys = sorted(papers[0].keys())
    print(f"  campos por paper (antes): {sample_keys}")

    slim = slim_papers(papers)
    kept = sorted(slim[0].keys()) if slim else []
    dropped = sorted(set(sample_keys) - set(kept))
    print(f"  campos por paper (después): {kept}")
    print(f"  campos descartados: {dropped}")

    if args.in_place:
        backup = src.with_suffix(".full.json")
        if not backup.exists():
            print(f"  Backup → {backup}")
            shutil.copy2(src, backup)
        out_path = src
    else:
        out_path = Path(args.out)

    out_path.write_text(json.dumps(slim, ensure_ascii=False))
    print(f"Escrito {out_path} ({fmt_size(out_path)})")

    ratio = src.stat().st_size / out_path.stat().st_size if out_path != src else 1
    if out_path != src:
        print(f"Reducción: {fmt_size(src)} → {fmt_size(out_path)}  ({ratio:.1f}× más chico)")


if __name__ == "__main__":
    main()
