#!/usr/bin/env bash
# Start / stop JupyterLab for train_on_linuxone.ipynb (same ML environment as the inference service).
# Usage: bash deploy/jupyter.sh          start (builds the image the first time)
#        bash deploy/jupyter.sh stop     stop it again
set -euo pipefail

cd "$(dirname "$0")/.."

[[ -f .env ]] || cp .env.example .env
if [[ "$(uname -m)" == "s390x" ]] && ! grep -q '^COMPOSE_FILE=' .env; then
    printf '\nCOMPOSE_FILE=docker-compose.yml:docker-compose.s390x.yml\n' >> .env
fi

if [[ "${1:-start}" == "stop" ]]; then
    docker compose --profile training stop jupyter
    docker compose --profile training rm -f jupyter
    exit 0
fi

# Run as your own user so files the notebook writes (models, cache) belong to you
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
port=$(grep -E '^JUPYTER_PORT=' .env | cut -d= -f2 || true)
port=${port:-8888}

echo "==> Building and starting JupyterLab (first build takes a few minutes)"
docker compose --profile training up -d --build jupyter

echo "==> Waiting for JupyterLab to start"
url=""
for _ in $(seq 1 60); do
    url=$(docker compose --profile training logs jupyter 2>/dev/null | grep -oE 'http://127\.0\.0\.1:8888/lab\?token=[0-9a-f]+' | tail -1 || true)
    [[ -n "$url" ]] && break
    sleep 3
done
[[ -n "$url" ]] || { echo "JupyterLab did not start - check: docker compose --profile training logs jupyter"; exit 1; }
url=${url/:8888/:$port}

cat <<EOF

JupyterLab is running on this server (listening on 127.0.0.1 only).

1. On your PC, open an SSH tunnel to the server:
     PuTTY:  Connection > SSH > Tunnels: Source port $port, Destination localhost:$port, Add, then connect
     or:     ssh -L $port:localhost:$port $(whoami)@<server-ip>
2. In your browser open:
     $url
3. Open train_on_linuxone.ipynb and choose Run > Run All Cells.

Stop it afterwards with: bash deploy/jupyter.sh stop
EOF
