# Python ML inference service (Flask + PyTorch Geometric), served by gunicorn.
# Build context is ./backend (so requirements.txt is reachable).
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NUMBA_CACHE_DIR=/tmp/numba_cache \
    MODEL_DIR=/app/model

# libsndfile is needed by soundfile (librosa's WAV reader)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY python_service/predict.py .
COPY python_service/model ./model

RUN useradd --system --uid 10001 appuser
USER appuser

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5001/health').status == 200 else 1)"

# One worker keeps a single copy of the model in memory; threads handle concurrent requests.
# Long timeout: the first request JIT-compiles librosa's numba kernels.
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "1", "--threads", "4", "--timeout", "180", "predict:create_app()"]

# ---------------------------------------------------------------- training notebook (optional)
# JupyterLab on top of the exact runtime above, for train_on_linuxone.ipynb.
# Started on demand with deploy/jupyter.sh (compose profile "training"); not part of the web app.
FROM runtime AS jupyter
USER root
RUN pip install jupyterlab==4.2.5 matplotlib==3.9.2
ENV HOME=/tmp
WORKDIR /workspace
EXPOSE 8888
HEALTHCHECK NONE
CMD ["python", "-m", "jupyterlab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--ServerApp.root_dir=/workspace"]
