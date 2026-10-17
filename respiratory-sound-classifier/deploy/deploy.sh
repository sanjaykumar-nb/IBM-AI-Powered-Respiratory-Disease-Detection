#!/usr/bin/env bash
# Build (or rebuild) and start the whole stack. Safe to re-run for updates.
# Usage: bash deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

[[ -f .env ]] || cp .env.example .env

# IBM Db2 (screening history): give the db2inst1 user a random password, kept in .env only.
if ! grep -qE '^DB2_PASSWORD=.+' .env || grep -q '^DB2_PASSWORD=change-me$' .env; then
    echo "==> Generating a random IBM Db2 password in .env"
    db2_password=$(od -An -tx1 -N12 /dev/urandom | tr -d ' \n')
    sed -i '/^DB2_PASSWORD=/d' .env
    printf '\nDB2_PASSWORD=%s\n' "$db2_password" >> .env
fi

# IBM Z / LinuxONE: build the ML service from Dockerfile.s390x. Stored in .env so manual
# `docker compose ...` commands on this server use the same files.
if [[ "$(uname -m)" == "s390x" ]] && ! grep -q '^COMPOSE_FILE=' .env; then
    echo "==> s390x (IBM Z / LinuxONE) detected - enabling docker-compose.s390x.yml"
    printf '\nCOMPOSE_FILE=docker-compose.yml:docker-compose.s390x.yml\n' >> .env
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "==> Pulling latest code"
    git pull --ff-only || echo "    (git pull skipped/failed - deploying the local copy)"
fi

echo "==> Building images (first build downloads PyTorch and takes a few minutes)"
docker compose build

echo "==> Pulling IBM Db2 Community Edition (first time: a large download)"
docker compose pull db2

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
if [[ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q db2)" 2>/dev/null)" != "healthy" ]]; then
    echo "    IBM Db2 is still starting (the first start takes several minutes). Screening works meanwhile;"
    echo "    the History page fills once Db2 is up. Follow it with: docker compose logs -f db2"
fi
