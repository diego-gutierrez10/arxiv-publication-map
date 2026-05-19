# Dockerfile para Hugging Face Spaces (SDK: docker, port: 7860).
# Imagen ligera de Python 3.11. Instala deps, copia código y datos,
# precarga el modelo en build (para evitar descarga en cold start).

FROM python:3.11-slim

# Variables de entorno: HF cache dentro del container, no buffering en logs
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/app/.cache/huggingface

WORKDIR /app

# Dependencias del sistema mínimas (torch/numpy ya son binarios)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Instalar deps primero (caché de Docker layer)
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Precarga del modelo en build-time: evita descargar 1.4 GB en el primer request
ARG MODEL_NAME=mixedbread-ai/mxbai-embed-large-v1
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('${MODEL_NAME}')"

# Código y datos (papers_sample.json, clusters.json, embeddings.bin)
COPY app.py .
COPY data ./data

EXPOSE 7860

# HF Spaces espera el puerto 7860 por convención
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
