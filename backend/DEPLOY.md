# Deploy a Hugging Face Spaces

Esta guía te lleva paso a paso desde cero hasta tener el backend vivo en `https://<usuario>-arxiv-publication-map-api.hf.space`.

## Prerrequisitos

- Cuenta de Hugging Face (gratis): https://huggingface.co/join
- `git` + un access token de HF con permisos write: https://huggingface.co/settings/tokens
- Los assets `papers_sample.json`, `clusters.json` y `embeddings.bin` ya generados en `backend/data/`

## 1. Crear el Space

1. https://huggingface.co/new-space
2. **Owner**: tu usuario (p.ej. `diego-gutierrez10`)
3. **Space name**: `arxiv-publication-map-api`
4. **License**: MIT
5. **SDK**: **Docker** (no Gradio ni Streamlit — usamos Docker porque hace falta FastAPI puro)
6. **Hardware**: CPU basic (gratis, 16 GB RAM, suficiente)
7. **Public**: sí
8. Click "Create Space"

## 2. Clonar el repo del Space

```bash
git lfs install   # solo la primera vez en tu sistema
git clone https://huggingface.co/spaces/<usuario>/arxiv-publication-map-api
cd arxiv-publication-map-api
```

(Si pide credenciales: usuario = tu usuario HF, contraseña = tu access token.)

## 3. Copiar los archivos del backend

Desde la raíz del proyecto local:

```bash
# Asumiendo que clonaste el Space al lado del proyecto principal:
cp backend/app.py            ../arxiv-publication-map-api/
cp backend/Dockerfile        ../arxiv-publication-map-api/
cp backend/requirements.txt  ../arxiv-publication-map-api/
cp backend/README.md         ../arxiv-publication-map-api/
cp backend/.dockerignore     ../arxiv-publication-map-api/

# Los assets:
mkdir -p ../arxiv-publication-map-api/data
cp backend/data/papers_sample.json ../arxiv-publication-map-api/data/
cp backend/data/clusters.json      ../arxiv-publication-map-api/data/
cp backend/data/embeddings.bin     ../arxiv-publication-map-api/data/
```

## 4. Configurar Git LFS para los archivos grandes (obligatorio en HF Spaces para >10 MB)

```bash
cd ../arxiv-publication-map-api
git lfs install                          # solo la primera vez en tu sistema
git lfs track "data/embeddings.bin"
git lfs track "data/papers_sample.json"  # >10 MB en el dataset completo (177k)
git add .gitattributes
```

**Tamaños esperados según escala:**

| Escala | papers_sample.json | embeddings.bin | tiempo de push (LFS) |
|---|---|---|---|
| 10k papers | 13 MB (no LFS) | 40 MB | 1-2 min |
| 177k papers (completo) | 230 MB (LFS) | 727 MB (LFS) | 10-15 min |

HF Spaces tier gratis: 50 GB de bandwidth LFS/mes, suficiente para varios deploys.

## 5. Push

```bash
git add .
git commit -m "Initial deploy: FastAPI + mxbai-embed-large-v1 + 10k papers"
git push
```

HF empieza a buildear el Docker. Puedes ver el progreso en `https://huggingface.co/spaces/<usuario>/arxiv-publication-map-api/logs`.

El build tarda **~5-8 min** la primera vez (descarga PyTorch + sentence-transformers + el modelo mxbai-large de 1.4 GB y lo precarga en la imagen para que el cold-start sea rápido).

## 6. Verificar

Una vez que el Space muestre **"Running"**:

```bash
curl https://<usuario>-arxiv-publication-map-api.hf.space/
# → {"service":"arxiv-publication-map-api","status":"ok",...}

curl -X POST https://<usuario>-arxiv-publication-map-api.hf.space/search \
  -H "Content-Type: application/json" \
  -d '{"query":"fruit detection computer vision","top_clusters":3}'
```

## 7. Actualizar el frontend

En `index.html`, cambia la URL del backend a tu Space real (ya está parametrizada por hostname, solo asegura que coincida):

```html
<script>
  window.PUBSEARCH_API_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:7860'
    : 'https://TU-USUARIO-arxiv-publication-map-api.hf.space';
</script>
```

Commit + push del frontend a GitHub Pages y listo: el sitio ya consume el backend.

## Mantenimiento

- **Cold starts**: si nadie pega el endpoint en 48 h, el Space se "duerme". El primer request siguiente tarda ~30 s en despertarlo. Puedes evitarlo con un cron externo que pegue `GET /` cada 24 h (uptimerobot, cron-job.org, etc.).
- **Re-deploy con datos nuevos**: actualiza los archivos en `data/` del Space y haz `git push`. HF rebuildea automáticamente.
- **Logs**: visibles en la pestaña "Logs" del Space.
- **Métricas**: HF Spaces no expone métricas detalladas en el tier gratis. Si te importa, agrega logging estructurado en `app.py` y consúmelo desde los logs.
