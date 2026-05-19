"""
build_embeddings.py — computa embeddings densos para cada paper con un modelo
sentence-transformer y los persiste como Float32Array binario crudo. Por
defecto usa mixedbread-ai/mxbai-embed-large-v1 (1024-d) para retrieval de alta
calidad; el backend FastAPI carga el mismo modelo y embebe queries del usuario
en tiempo real.

Notas sobre mxbai-embed-large-v1:
  - Para passages (abstracts): se codifica el texto crudo, sin prefijo.
  - Para queries (búsqueda del usuario): SE DEBE prefijar con
    "Represent this sentence for searching relevant passages: ".
  - El prefijo de query NO se aplica aquí (estos son passages); se aplica en el
    backend (backend/app.py).

Auto-detección de device en Mac Apple Silicon (M1/M2/M3/M4): si no se pasa
--device, intentamos MPS automáticamente. En CPU mxbai-large hace ~13 sent/s;
en MPS hace ~30-60 sent/s (~2-4× más rápido).

Resume incremental: si --out ya existe Y --resume está activado, intenta
detectar embeddings previos compatibles y reanuda desde donde quedó. Útil
para procesos largos (>1 h) que pueden interrumpirse.

Uso:
    # 10k papers con MiniLM (ligero, para testing)
    python scripts/build_embeddings.py --model sentence-transformers/all-MiniLM-L6-v2

    # Producción: dataset completo con mxbai, en MPS
    python scripts/build_embeddings.py \\
        --papers backend/data/papers_sample.json \\
        --out backend/data/embeddings.bin \\
        --batch 64 --device mps
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Catálogo de modelos soportados (dim correspondiente para validar la salida).
KNOWN_DIMS = {
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    "mixedbread-ai/mxbai-embed-large-v1": 1024,
    "BAAI/bge-large-en-v1.5": 1024,
    "BAAI/bge-base-en-v1.5": 768,
    "nomic-ai/nomic-embed-text-v1.5": 768,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="mixedbread-ai/mxbai-embed-large-v1")
    p.add_argument("--dim", type=int, default=None,
                   help="Dimensión esperada del embedding (si se omite, se infiere del catálogo)")
    p.add_argument("--papers", default=str(DATA_DIR / "papers_sample.json"))
    p.add_argument("--out", default=str(DATA_DIR / "embeddings.bin"))
    p.add_argument("--batch", type=int, default=64,
                   help="Tamaño de batch para el modelo (más grande = más rápido si cabe en RAM/VRAM)")
    p.add_argument("--device", default=None,
                   help="cuda / mps / cpu — si se omite y hay Apple Silicon, intenta MPS")
    p.add_argument("--checkpoint-every", type=int, default=200,
                   help="Cada N batches escribe el progreso a disco (default 200 batches)")
    p.add_argument("--resume", action="store_true",
                   help="Si --out existe y es compatible, reanuda desde donde quedó")
    return p.parse_args()


def auto_device(requested: str | None) -> str:
    """Decide qué device usar. Prioridad: --device explícito > MPS si Apple Silicon > CPU."""
    if requested:
        return requested
    try:
        import torch
        if torch.backends.mps.is_available():
            print("  Detectado MPS (Apple Silicon GPU) — usando mps")
            return "mps"
        if torch.cuda.is_available():
            print("  Detectado CUDA — usando cuda")
            return "cuda"
    except Exception:
        pass
    print("  Usando CPU (lento — para acelerar instala torch con MPS/CUDA y reintenta)")
    return "cpu"


def encode_in_chunks(
    model: SentenceTransformer,
    texts: list[str],
    out_path: Path,
    dim: int,
    batch_size: int,
    chunk_batches: int,
    start_offset: int = 0,
) -> np.ndarray:
    """Codifica `texts[start_offset:]` y va escribiendo `out_path` cada `chunk_batches` batches.

    Mantiene `embs` en memoria pero también persiste a disco para que si algo
    crashea, la próxima corrida con --resume pueda continuar.
    """
    n = len(texts)
    embs = np.zeros((n, dim), dtype=np.float32)

    # Si ya hay algo en disco, cárgalo (para conservar la parte ya hecha)
    if start_offset > 0 and out_path.exists():
        existing = np.fromfile(out_path, dtype=np.float32).reshape(-1, dim)
        if existing.shape[0] >= start_offset:
            embs[:start_offset] = existing[:start_offset]
            print(f"  Resume: cargados {start_offset:,} embeddings previos")
        else:
            print(f"  ⚠ el archivo previo tiene {existing.shape[0]:,} embeddings pero esperaba "
                  f"≥ {start_offset:,}; recomputando desde 0")
            start_offset = 0

    chunk_size = batch_size * chunk_batches
    remaining = n - start_offset
    n_chunks = (remaining + chunk_size - 1) // chunk_size
    print(f"  Procesando {remaining:,} papers en {n_chunks} chunks de {chunk_size:,} "
          f"(batch={batch_size}, checkpoint cada {chunk_batches} batches)")

    t_start = time.time()
    for ci in range(n_chunks):
        a = start_offset + ci * chunk_size
        b = min(a + chunk_size, n)
        sub = texts[a:b]
        chunk_embs = model.encode(
            sub,
            batch_size=batch_size,
            normalize_embeddings=True,
            show_progress_bar=True,
            convert_to_numpy=True,
        ).astype(np.float32)
        embs[a:b] = chunk_embs
        # Checkpoint: escribe TODO lo procesado hasta aquí
        embs[:b].tofile(out_path)
        elapsed = time.time() - t_start
        done = b - start_offset
        rate = done / elapsed if elapsed > 0 else 0
        eta = (remaining - done) / rate / 60 if rate > 0 else 0
        print(f"  ✓ chunk {ci+1}/{n_chunks}: {b:,}/{n:,} papers "
              f"({rate:.1f} sent/s, ETA {eta:.1f} min)")

    return embs


def detect_resume_offset(out_path: Path, dim: int, total_n: int) -> int:
    """Si el archivo de salida ya existe y es compatible en dim, devuelve cuántos
    embeddings tiene ya (cuántos podemos saltar)."""
    if not out_path.exists():
        return 0
    raw = np.fromfile(out_path, dtype=np.float32)
    if raw.size == 0 or raw.size % dim != 0:
        return 0
    n_done = raw.size // dim
    if n_done > total_n:
        print(f"  ⚠ {out_path} tiene {n_done:,} embeddings, más que los {total_n:,} papers actuales; "
              f"se sobreescribirá")
        return 0
    return n_done


def main():
    args = parse_args()
    expected_dim = args.dim or KNOWN_DIMS.get(args.model)
    if expected_dim is None:
        sys.exit(f"No conozco la dim de {args.model}; pásala explícita con --dim")

    papers = json.loads(Path(args.papers).read_text())
    texts = [f"{p['title']}. {p['abstract']}" for p in papers]
    print(f"Encoding {len(texts):,} papers with {args.model} …")
    print(f"  Dim esperada: {expected_dim}")

    device = auto_device(args.device)

    out_path = Path(args.out)
    start_offset = 0
    if args.resume:
        start_offset = detect_resume_offset(out_path, expected_dim, len(texts))
        if start_offset >= len(texts):
            print(f"  Ya está todo hecho ({start_offset:,} ≥ {len(texts):,}). Nada que recomputar.")
            return
        if start_offset:
            print(f"  Resume: saltando los primeros {start_offset:,} papers ya embebidos")

    print(f"  Cargando modelo …")
    model = SentenceTransformer(args.model, device=device)

    embs = encode_in_chunks(
        model, texts, out_path, expected_dim,
        batch_size=args.batch,
        chunk_batches=args.checkpoint_every,
        start_offset=start_offset,
    )

    n, d = embs.shape
    if d != expected_dim:
        raise AssertionError(f"Esperaba dim={expected_dim}, modelo devolvió dim={d}")

    embs.tofile(out_path)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nEscrito {out_path}  shape=({n}, {d})  ({size_mb:.1f} MB)")
    sample_norms = np.linalg.norm(embs[:1000], axis=1)
    print(f"Sanity check (sobre primeras 1000 filas): norma media = {sample_norms.mean():.4f} "
          f"(esperado ≈ 1.0)")


if __name__ == "__main__":
    main()
