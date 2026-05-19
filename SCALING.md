# Escalamiento a 177k papers (dataset completo)

Esta guía te lleva del prototipo de 10k papers al corpus completo geocodificado (177,598 papers únicos), listo para el backend en Hugging Face Spaces.

## TL;DR

```bash
cd "/Users/diego/Desktop/arxiv-publication-map/arxiv-publication-map"

# 1. Fetch de los 177k abstracts → backend/data/ (~90 min, con checkpoint cada ~75 s)
python3 scripts/build_dataset.py \
    --n 0 \
    --papers-out backend/data/papers_sample.json \
    --clusters-out backend/data/clusters.json

# 2. Embeddings con mxbai en MPS → backend/data/ (~1-2 h en Apple Silicon)
python3 scripts/build_embeddings.py \
    --papers backend/data/papers_sample.json \
    --out backend/data/embeddings.bin \
    --batch 64 --resume

# 3. Test local con el nuevo corpus
cd backend && python3 app.py
# (en otra terminal: curl o el frontend en :8000)
```

Luego sigue `backend/DEPLOY.md` para subirlo a HF Spaces.

---

## Tamaños y tiempos esperados

| Recurso | 10k papers (actual) | 177k papers (full) |
|---|---|---|
| Abstracts fetch (arXiv API) | ~6 min | **~90 min** (rate-limit 3 s/batch × 1776 batches) |
| Embeddings en CPU | ~13 min | **~3-4 h** |
| Embeddings en MPS (Apple Silicon) | ~5 min | **~1-2 h** |
| `papers_sample.json` | 13 MB | **~230 MB** |
| `clusters.json` | 150 KB | **~3 MB** (≈3 000 clusters tras DBSCAN) |
| `embeddings.bin` | 40 MB | **~727 MB** (177k × 1024 × 4 B) |
| RAM del backend al boot | ~2 GB | **~3 GB** (modelo 1.4 GB + embeddings 727 MB + papers 230 MB parsed) |

**HF Spaces tier gratis** tiene 16 GB RAM → cabe sobrado.

## Resiliencia

Los dos scripts soportan **resume tras crash**:

- **`build_dataset.py`**: guarda los abstracts incrementales en `data/abstracts_cache.json` cada 25 batches (~75 s). Si crashea (red, OOM, Ctrl+C), simplemente vuelve a correr el mismo comando: detecta el cache y solo descarga los IDs faltantes.
- **`build_embeddings.py`**: con `--resume`, detecta cuántos embeddings ya hay en `--out` y continúa desde ahí. Escribe a disco cada `--checkpoint-every` batches (default 200, ≈ cada 5-10 min en MPS).

## Pasos detallados

### Paso 1 — Descarga de abstracts (los 177k)

```bash
python3 scripts/build_dataset.py \
    --n 0 \
    --papers-out backend/data/papers_sample.json \
    --clusters-out backend/data/clusters.json
```

Lo que hace:
1. Lee `data/arxiv_locations_geocoded.csv` (333 MB)
2. Normaliza arxiv_ids (repara los IDs con ceros perdidos)
3. Deduplica → 177,598 papers únicos
4. Lee el cache `data/abstracts_cache.json` (si existe, reusa lo descargado)
5. Descarga los abstracts faltantes vía arXiv API (rate-limit 3.1 s/batch)
6. Corre DBSCAN sobre (lat, lon)
7. Escribe `backend/data/papers_sample.json` + `backend/data/clusters.json`

**Importante**: si ya corriste el 10k antes, hay 10k abstracts en `abstracts_cache.json` ya — esos no se vuelven a descargar. Solo faltan ~167k. ETA real: ~85 min.

Al terminar verás algo como:
```
[3/5] Descargando abstracts (177,598 papers en lotes de 100) …
      caché previa: 10,000 abstracts reusados de abstracts_cache.json
      a descargar:  167,598 pendientes
      ETA aproximada: 86.7 min (rate-limit arXiv = 3.1s/batch)
batches: 100%|████████| 1676/1676 [86:23<00:00, ...]
      abstracts recuperados: 175,xxx/177,598 (98.7%)
[4/5] DBSCAN …
      clusters: ~3000, ruido: ~5000
```

### Paso 2 — Embeddings (con MPS si tienes Apple Silicon)

```bash
python3 scripts/build_embeddings.py \
    --papers backend/data/papers_sample.json \
    --out backend/data/embeddings.bin \
    --batch 64 --resume
```

El script auto-detecta MPS en Apple Silicon. Si no, usa CPU. Para forzar:
```bash
--device mps    # M1/M2/M3/M4 GPU
--device cpu    # forzar CPU
```

Verás:
```
Encoding 175,xxx papers with mixedbread-ai/mxbai-embed-large-v1 …
  Dim esperada: 1024
  Detectado MPS (Apple Silicon GPU) — usando mps
  Procesando 175,xxx papers en 14 chunks de 12,800 (batch=64, checkpoint cada 200 batches)
Batches: 100%|██████████| 200/200 [04:23<00:00,  ...]
  ✓ chunk 1/14: 12,800/175,xxx papers (48.6 sent/s, ETA 55.7 min)
…
```

Si algo falla y reanudas con `--resume`, el script detectará el progreso y continuará desde el último chunk.

### Paso 3 — Test local

Asegúrate de tener el viejo backend apagado (Ctrl+C en su terminal). Luego:

```bash
cd backend
python3 app.py
```

Ahora carga 177k papers en RAM. Boot toma ~30-40 s. Cuando veas "Uvicorn running":

```bash
# en otra terminal
curl -s http://localhost:7860/ | python3 -m json.tool
# Esperado: "n_papers": 177xxx, "n_clusters": ~3000

curl -s -X POST http://localhost:7860/search \
    -H "Content-Type: application/json" \
    -d '{"query":"fruit detection computer vision","top_clusters":3}' | python3 -m json.tool
```

Con 177k papers, deberías ver resultados mucho mejores que con 10k: ahora hay mayor chance de tener papers específicos de cualquier nicho.

### Paso 4 — Frontend: decisión arquitectónica

El frontend (GitHub Pages) **NO necesita** los 230 MB de papers_sample.json — solo el backend los usa para search. Pero el frontend SÍ carga su propio `data/papers_sample.json` para renderizar el mapa (heatmap, cluster markers).

Tienes dos opciones:

**Opción A — Frontend queda con 10k (más simple)**

No tocas `data/papers_sample.json` ni `data/clusters.json` del frontend. El mapa sigue mostrando 10k papers; el search llama al backend con 177k. La inconsistencia es aceptable: el mapa es "la muestra que mostramos" y el search es "lo que buscamos en todo el corpus".

Cuando el backend devuelva un cluster que no existe en `data/clusters.json` del frontend, `search.js` usa los metadatos que vienen en el response del backend (centroid, top_city, etc.). Funciona.

**Opción B — Frontend también escala (más coherente, pero pesado)**

Para que mapa y search compartan corpus:
```bash
cp backend/data/papers_sample.json data/papers_sample.json
cp backend/data/clusters.json      data/clusters.json
```

Caveat: `data/papers_sample.json` pasa de 13 MB a ~230 MB. GitHub Pages NO acepta archivos > 100 MB. Tendrías que:
- Pre-comprimir con `gzip -9 data/papers_sample.json` (queda ~70-80 MB)
- O reducir el JSON a solo los campos visualmente necesarios (`id`, `lat`, `lon`, `year`, `category`, `cluster_id`, `institution`) → baja a ~40 MB sin compresión
- O hostear los assets en HF Datasets / Cloudflare R2

Recomendación: **empieza con Opción A**. Si después decides que quieres todo coherente, escalas el frontend en una iteración separada.

## Deploy a HF Spaces

Una vez que el backend local funcione con 177k:

```bash
# Ver detalles en backend/DEPLOY.md
git clone https://huggingface.co/spaces/<usuario>/arxiv-publication-map-api
cd arxiv-publication-map-api
git lfs install
git lfs track "data/embeddings.bin"
git lfs track "data/papers_sample.json"   # ahora también es grande (>10 MB)
git add .gitattributes

# copia los archivos del backend
cp ../arxiv-publication-map/backend/{app.py,Dockerfile,requirements.txt,README.md,.dockerignore} .
mkdir -p data
cp ../arxiv-publication-map/backend/data/{papers_sample.json,clusters.json,embeddings.bin} data/

git add .
git commit -m "Deploy backend with full 177k corpus"
git push
```

El push toma ~10-15 min (727 MB de embeddings + 230 MB JSON vía LFS). Luego HF tarda otros ~8 min en buildear el Docker (descarga PyTorch + sentence-transformers + el modelo).

Una vez vivo: actualiza `index.html` con la URL correcta del Space si tu user es distinto a `diego-gutierrez10`.

## Diagnóstico de problemas comunes

| Síntoma | Causa probable | Fix |
|---|---|---|
| `HTTP 429 Too Many Requests` de arXiv | bajaste `--sleep` por debajo de 3 s | Vuelve a `--sleep 3.1` o más |
| `Network is unreachable` | red sin IPv4 ruteado (Telmex IPv6-only) | Cambia de red / hotspot móvil |
| MPS muy lento o crashea con OOM | batch muy grande para tu RAM | Baja `--batch 32` o `--batch 16` |
| `embeddings.bin` queda con N erróneo | te quedaste sin disco a mitad | Borra el archivo y vuelve a correr (con `--resume` no funciona si fue truncated) |
| HF Spaces queda en "building" >20 min | descarga del modelo lenta | Espera; el primer build siempre es el más lento |
