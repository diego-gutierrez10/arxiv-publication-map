"""
slim_papers.py — toma el papers_sample.json completo (177k papers, ~224 MB
con abstracts) y emite una versión "slim" sin abstract (~51 MB).

Tanto el frontend como el backend en producción usan la versión slim:
  - Frontend (GitHub Pages): cabe bajo el límite de 100 MB por archivo.
  - Backend (HF Spaces): ahorra ~170 MB de disco/RAM. La semántica ya está
    horneada en los embeddings (que sí se conservan en embeddings.bin).

El JSON completo con abstracts queda en backend/data/papers_sample.full.json
como referencia/respaldo (por si en el futuro quisieras volver a mostrarlos
en UI).

Uso:
    python scripts/slim_frontend_papers.py
"""
from __future__ import annotations
import argparse, json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
BACKEND_DATA_DIR = REPO_ROOT / "backend" / "data"

KEEP_FIELDS = (
    "id", "title", "year", "category", "categories",
    "institution", "city", "country", "lat", "lon", "cluster_id",
)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--in",  dest="inp",  default=str(BACKEND_DATA_DIR / "papers_sample.json"),
                   help="Papers JSON completo (backend)")
    p.add_argument("--out", default=str(DATA_DIR / "papers_sample.json"),
                   help="Salida slim para el frontend")
    p.add_argument("--clusters-in",  default=str(BACKEND_DATA_DIR / "clusters.json"))
    p.add_argument("--clusters-out", default=str(DATA_DIR / "clusters.json"))
    args = p.parse_args()

    inp = Path(args.inp); out = Path(args.out)
    print(f"Leyendo {inp} …")
    papers = json.loads(inp.read_text())
    size_before_mb = inp.stat().st_size / 1024 / 1024
    print(f"  Total papers: {len(papers):,}")
    print(f"  Tamaño origen: {size_before_mb:.1f} MB")

    slim = [{k: p[k] for k in KEEP_FIELDS if k in p} for p in papers]
    out.parent.mkdir(parents=True, exist_ok=True)
    # JSON compacto (sin indent) para que pese lo mínimo posible
    out.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")))

    size_after_mb = out.stat().st_size / 1024 / 1024
    print(f"\nEscrito {out}")
    print(f"  Tamaño slim:  {size_after_mb:.1f} MB ({size_after_mb/size_before_mb*100:.0f}% del original)")
    print(f"  Ahorro:        {size_before_mb - size_after_mb:.1f} MB")

    # Copia clusters tal cual (es pequeño)
    ci = Path(args.clusters_in); co = Path(args.clusters_out)
    if ci.exists():
        co.write_text(ci.read_text())
        print(f"\nCopiado {ci.name} → {co}  ({co.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
