#!/usr/bin/env bash
# Build (or rebuild) and start the whole stack. Safe to re-run for updates.
# Usage: bash deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[[ -f .env ]] || cp .env.example .env

if [[ -d .git ]]; then
    echo "==> Pulling latest code"
    git pull --ff-only || echo "    (git pull skipped/failed - deploying the local copy)"
fi

echo "==> Building images (first build downloads PyTorch and takes a few minutes)"
docker compose build

echo "==> Starting containers"
docker compose up -d --remove-orphans

echo "==> Waiting for services to become healthy"
for _ in $(seq 1 60); do
    if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q frontend)" 2>/dev/null)" == "healthy" ]]; then
        break
    fi
    sleep 5
done
docker compose ps

docker image prune -f >/dev/null

port=$(grep -E '^HTTP_PORT=' .env | cut -d= -f2)
echo "==> App:          http://$(hostname -I | awk '{print $1}'):${port:-80}"
echo "    Health check: curl http://localhost:${port:-80}/api/health"
echo "    Logs:         docker compose logs -f"
