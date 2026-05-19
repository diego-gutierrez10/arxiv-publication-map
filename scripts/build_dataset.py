"""
build_dataset.py — submuestrea el CSV geocodificado, descarga abstracts desde
la arXiv API, corre DBSCAN sobre (lat, lon) y emite:
    data/papers_sample.json   — un objeto por paper con todos los metadatos
    data/clusters.json        — un objeto por cluster geográfico (centroide,
                                ciudad/país/institución dominante, n_papers)

Uso:
    python scripts/build_dataset.py --n 10000 --csv data/arxiv_locations_geocoded.csv

El CSV original tiene una fila por (paper × autor). Aquí lo deduplicamos por
arxiv_id manteniendo la primera institución listada (suficiente para el demo).
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests
from sklearn.cluster import DBSCAN
from tqdm import tqdm

ARXIV_API = "https://export.arxiv.org/api/query"
ARXIV_HOST = "export.arxiv.org"
USER_AGENT = "arxiv-publication-map/0.1 (https://github.com/diego-gutierrez10/arxiv-publication-map; mailto:dgutierrez116@uabc.edu.mx)"
NS = {"atom": "http://www.w3.org/2005/Atom"}


def patch_dns_for_arxiv() -> None:
    """Workaround para un bug de Python en macOS donde socket.getaddrinfo no
    puede resolver export.arxiv.org (CNAME a Fastly), aunque curl/nslookup sí.
    Resolvemos vía `dscacheutil` (el resolver del sistema) y pineamos la IP en
    socket.getaddrinfo para que requests la use. SNI y Host header siguen
    apuntando a export.arxiv.org, así que el cert TLS valida correctamente."""
    try:
        ip = socket.gethostbyname(ARXIV_HOST)
        return  # resolver normal funcionó, nada que parchear
    except socket.gaierror:
        pass

    try:
        out = subprocess.check_output(
            ["dscacheutil", "-q", "host", "-a", "name", ARXIV_HOST],
            text=True, timeout=5,
        )
    except Exception as exc:
        raise RuntimeError(f"No se pudo resolver {ARXIV_HOST} ni con dscacheutil: {exc}")

    ips = [ln.split()[-1] for ln in out.splitlines() if ln.startswith("ip_address:")]
    if not ips:
        raise RuntimeError(f"dscacheutil no devolvió IP para {ARXIV_HOST}:\n{out}")
    pinned_ip = ips[0]
    print(f"      DNS workaround: {ARXIV_HOST} → {pinned_ip} (pineado en socket)")

    _orig_getaddrinfo = socket.getaddrinfo

    def _patched(host, *args, **kwargs):
        if host == ARXIV_HOST:
            return _orig_getaddrinfo(pinned_ip, *args, **kwargs)
        return _orig_getaddrinfo(host, *args, **kwargs)

    socket.getaddrinfo = _patched

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default=str(DATA_DIR / "arxiv_locations_geocoded.csv"))
    p.add_argument("--n", type=int, default=10_000,
                   help="Tamaño del submuestreo. Usa 0 (o un número mayor al total) para procesar TODO el dataset.")
    p.add_argument("--eps", type=float, default=0.7, help="DBSCAN eps en grados (~75 km)")
    p.add_argument("--min-samples", type=int, default=2)
    p.add_argument("--batch", type=int, default=100, help="Papers por petición arXiv")
    p.add_argument("--sleep", type=float, default=3.1, help="Segundos entre peticiones (rate-limit arXiv = 1 req/3 s)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--cache", default=str(DATA_DIR / "abstracts_cache.json"),
                   help="Ruta al caché incremental de abstracts (permite reanudar tras un crash)")
    p.add_argument("--checkpoint-every", type=int, default=25,
                   help="Cada N batches guarda el caché a disco (default 25 batches ≈ ~75 s)")
    p.add_argument("--papers-out", default=str(DATA_DIR / "papers_sample.json"),
                   help="Archivo de salida con los papers + abstracts")
    p.add_argument("--clusters-out", default=str(DATA_DIR / "clusters.json"),
                   help="Archivo de salida con los clusters geográficos")
    return p.parse_args()


_ARXIV_NEW_RE = re.compile(r"^(\d{1,4})\.(\d{1,5})$")


def normalize_arxiv_id(raw: str) -> str | None:
    """Repara IDs estropeados por una conversión float → str previa.
    Casos típicos en el CSV:
      '705.4166'    → '0705.4166'    (zero del año perdido)
      '2012.0761'   → '2012.07610'   (zero del sufijo perdido)
      '903.251'     → '0903.2510'    (ambos perdidos)
      'cs/0001001'  → 'cs/0001001'   (formato viejo, sin cambio)
      '1502.03016v2'→ '1502.03016'   (sufijo de versión removido)

    arXiv ID format:
      abril 2007 – diciembre 2014  → YYMM.NNNN  (4 dígitos sufijo)
      enero 2015 – presente         → YYMM.NNNNN (5 dígitos sufijo)
    """
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if "/" in s:
        return s  # formato viejo (cs/0001001), pasa sin cambios
    s = re.sub(r"v\d+$", "", s)  # quita sufijo de versión si existe
    m = _ARXIV_NEW_RE.match(s)
    if not m:
        return None
    prefix, suffix = m.group(1), m.group(2)
    prefix = prefix.zfill(4)
    if len(prefix) != 4:
        return None
    try:
        yy = int(prefix[:2])
        mm = int(prefix[2:])
    except ValueError:
        return None
    if mm < 1 or mm > 12:
        return None
    target_len = 5 if yy >= 15 else 4
    if len(suffix) > target_len:
        return None  # más largo de lo permitido; ID inválido
    suffix = suffix.ljust(target_len, "0")  # pad con ceros a la derecha
    return f"{prefix}.{suffix}"


def load_and_dedupe(csv_path: str, n: int, seed: int) -> pd.DataFrame:
    print(f"[1/5] Leyendo {csv_path} …")
    df = pd.read_csv(
        csv_path,
        usecols=[
            "arxiv_id", "title", "publication_year", "arxiv_categories",
            "institution_name", "country", "city", "latitude", "longitude",
        ],
        dtype={"arxiv_id": str},
    )
    df = df.dropna(subset=["arxiv_id", "latitude", "longitude", "publication_year"])

    before = len(df)
    df["arxiv_id"] = df["arxiv_id"].map(normalize_arxiv_id)
    df = df.dropna(subset=["arxiv_id"]).reset_index(drop=True)
    dropped = before - len(df)
    if dropped:
        print(f"      IDs descartados por formato inválido: {dropped:,}")

    df = df.drop_duplicates(subset=["arxiv_id"], keep="first").reset_index(drop=True)
    print(f"      papers únicos en el CSV: {len(df):,}")

    df["publication_year"] = df["publication_year"].astype(int)
    df["primary_category"] = df["arxiv_categories"].fillna("").map(lambda s: s.split()[0] if s else "")

    if n <= 0 or n >= len(df):
        print(f"[2/5] Sin submuestreo — procesando los {len(df):,} papers completos")
        # Igualmente baraja para mejor distribución de errores en caso de aborto
        rng = pd.Series(range(len(df))).sample(frac=1, random_state=seed).index
        df = df.loc[rng].reset_index(drop=True)
    else:
        print(f"[2/5] Submuestreo aleatorio a n = {n:,} …")
        rng = pd.Series(range(len(df))).sample(frac=1, random_state=seed).index
        df = df.loc[rng].reset_index(drop=True)
        df = df.head(n).reset_index(drop=True)
    return df


def chunks(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _load_cache(cache_path: Path) -> dict[str, str]:
    if not cache_path.exists():
        return {}
    try:
        data = json.loads(cache_path.read_text())
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except Exception as exc:
        print(f"  ! caché ilegible ({exc}); empezando de cero")
    return {}


def _save_cache(cache_path: Path, cache: dict[str, str]) -> None:
    tmp = cache_path.with_suffix(cache_path.suffix + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False))
    tmp.replace(cache_path)  # write atómico: evita corromper el cache si crasheamos a mitad


def fetch_abstracts(
    arxiv_ids: list[str],
    batch_size: int,
    sleep_s: float,
    cache_path: Path,
    checkpoint_every: int = 25,
) -> dict[str, str]:
    """Descarga abstracts con caché incremental en disco para reanudar tras crashes.

    Estrategia:
      1. Lee el caché existente; los IDs ya cubiertos se saltan.
      2. Cada `checkpoint_every` batches escribe el caché con write atómico.
      3. Al terminar (o vía Ctrl+C / excepción) hace un flush final.
    """
    patch_dns_for_arxiv()
    cache_path = Path(cache_path)
    cache_path.parent.mkdir(exist_ok=True, parents=True)
    out = _load_cache(cache_path)

    cached_hits = sum(1 for i in arxiv_ids if i in out)
    pending = [i for i in arxiv_ids if i not in out]

    print(f"[3/5] Descargando abstracts ({len(arxiv_ids):,} papers en lotes de {batch_size}) …")
    if cached_hits:
        print(f"      caché previa: {cached_hits:,} abstracts reusados de {cache_path.name}")
    print(f"      a descargar:  {len(pending):,} pendientes")
    if not pending:
        return out

    eta_min = (len(pending) / batch_size) * sleep_s / 60
    print(f"      ETA aproximada: {eta_min:.1f} min (rate-limit arXiv = {sleep_s:.1f}s/batch)")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/atom+xml"})
    consecutive_failures = 0
    batches = list(chunks(pending, batch_size))

    try:
        for batch_idx, batch in enumerate(tqdm(batches, desc="batches"), start=1):
            params = {"id_list": ",".join(batch), "max_results": str(batch_size)}
            try:
                r = session.get(ARXIV_API, params=params, timeout=30)
                r.raise_for_status()
                consecutive_failures = 0
            except Exception as exc:
                consecutive_failures += 1
                print(f"  ! batch fallido ({exc}); reintentando tras 10 s "
                      f"(fallo {consecutive_failures}/10)")
                time.sleep(10)
                if consecutive_failures >= 10:
                    print(f"  ! 10 fallos consecutivos; guardando caché parcial y abortando.")
                    _save_cache(cache_path, out)
                    raise RuntimeError(f"arXiv API inalcanzable. Último error: {exc}")
                continue
            try:
                root = ET.fromstring(r.text)
                got_in_batch = 0
                for entry in root.findall("atom:entry", NS):
                    id_el = entry.find("atom:id", NS)
                    sm_el = entry.find("atom:summary", NS)
                    if id_el is None or sm_el is None:
                        continue
                    aid = id_el.text.strip().rsplit("/abs/", 1)[-1]
                    aid = re.sub(r"v\d+$", "", aid)
                    abstract = re.sub(r"\s+", " ", (sm_el.text or "").strip())
                    out[aid] = abstract
                    got_in_batch += 1
            except ET.ParseError:
                pass

            if batch_idx % checkpoint_every == 0:
                _save_cache(cache_path, out)

            time.sleep(sleep_s)
    except KeyboardInterrupt:
        print("\n  ! interrumpido por usuario; guardando caché parcial …")
        _save_cache(cache_path, out)
        raise

    _save_cache(cache_path, out)
    n_hit = sum(1 for i in arxiv_ids if i in out)
    print(f"      abstracts recuperados: {n_hit:,}/{len(arxiv_ids):,} "
          f"({n_hit/len(arxiv_ids)*100:.1f}%)")
    return out


def cluster_geo(df: pd.DataFrame, eps: float, min_samples: int) -> pd.DataFrame:
    print(f"[4/5] DBSCAN (eps={eps}°, min_samples={min_samples}) …")
    coords = df[["latitude", "longitude"]].to_numpy()
    labels = DBSCAN(eps=eps, min_samples=min_samples, metric="euclidean").fit_predict(coords)
    df = df.copy()
    df["cluster_id"] = labels.astype(int)
    print(f"      clusters: {len(set(labels)) - (1 if -1 in labels else 0)}, ruido: {(labels == -1).sum()}")
    return df


def summarize_clusters(df: pd.DataFrame) -> list[dict]:
    print("[5/5] Resumen por cluster …")
    out = []
    for cid, group in df[df.cluster_id >= 0].groupby("cluster_id"):
        lat = float(group.latitude.mean())
        lon = float(group.longitude.mean())
        top_city = group.city.dropna().mode()
        top_country = group.country.dropna().mode()
        top_inst = group.institution_name.dropna().mode()
        out.append({
            "cluster_id": int(cid),
            "centroid": [lat, lon],
            "n_papers": int(len(group)),
            "top_city": str(top_city.iloc[0]) if len(top_city) else "",
            "top_country": str(top_country.iloc[0]) if len(top_country) else "",
            "top_institution": str(top_inst.iloc[0]) if len(top_inst) else "",
            "years": sorted(set(int(y) for y in group.publication_year)),
        })
    out.sort(key=lambda c: c["n_papers"], reverse=True)
    return out


def main():
    args = parse_args()
    DATA_DIR.mkdir(exist_ok=True)

    df = load_and_dedupe(args.csv, args.n, args.seed)
    abstracts = fetch_abstracts(
        df["arxiv_id"].tolist(),
        batch_size=args.batch,
        sleep_s=args.sleep,
        cache_path=Path(args.cache),
        checkpoint_every=args.checkpoint_every,
    )
    df["abstract"] = df["arxiv_id"].map(abstracts).fillna("")
    df = df[df["abstract"].str.len() > 0].reset_index(drop=True)
    print(f"      papers con abstract no vacío: {len(df):,}")

    df = cluster_geo(df, args.eps, args.min_samples)

    papers = [{
        "id": row.arxiv_id,
        "title": (row.title or "").strip(),
        "abstract": row.abstract,
        "year": int(row.publication_year),
        "category": row.primary_category,
        "categories": row.arxiv_categories or "",
        "institution": row.institution_name or "",
        "city": row.city or "",
        "country": row.country or "",
        "lat": float(row.latitude),
        "lon": float(row.longitude),
        "cluster_id": int(row.cluster_id),
    } for row in df.itertuples(index=False)]

    clusters = summarize_clusters(df)

    papers_path = Path(args.papers_out)
    clusters_path = Path(args.clusters_out)
    papers_path.write_text(json.dumps(papers, ensure_ascii=False))
    clusters_path.write_text(json.dumps(clusters, ensure_ascii=False, indent=2))
    print(f"\nEscritos:\n  {papers_path}  ({papers_path.stat().st_size/1024/1024:.1f} MB)")
    print(f"  {clusters_path}  ({clusters_path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
