# Deploying on a Linux server (Docker Compose)

The app runs as three containers:

| Service    | Image contents                                    | Port                        |
|------------|---------------------------------------------------|-----------------------------|
| `frontend` | React build served by nginx; proxies `/api/*`     | published on `HTTP_PORT` (80) |
| `backend`  | Express API: uploads, WhatsApp webhook            | 5000 (internal only)        |
| `ml`       | Flask + PyTorch Geometric model, run by gunicorn  | 5001 (internal only)        |

Only nginx is exposed; the browser calls `/api/...` on the same origin, so there is no CORS or
hard-coded host to configure.

## Server requirements

- x86_64 Linux (Ubuntu 22.04/24.04, Debian 12, RHEL/Rocky/Alma 8/9 tested by the setup script)
- 2 vCPU, **4 GB RAM** minimum (the ML container is capped at 3 GB), ~6 GB free disk
- Inbound TCP 80 open (and 443 if you add HTTPS)

## 1. Get the code onto the server

```bash
git clone https://github.com/Gurumurthys1/AI-Powered-Respiratory-Disease-Detection.git respiratory-sound-classifier
cd respiratory-sound-classifier
```

Or copy this folder from your PC (the `backend/python_service/model/` directory must come along):

```bash
scp -r respiratory-sound-classifier user@SERVER_IP:~/
```

## 2. One-time server setup (installs Docker + Compose, opens the firewall)

```bash
sudo bash deploy/setup-server.sh
```

Log out and back in so your user can run `docker` without `sudo`.

## 3. Deploy

```bash
bash deploy/deploy.sh
```

Then open `http://SERVER_IP/`. The first build downloads PyTorch (CPU build) and takes a few
minutes; later builds are cached. Re-run the same command to deploy updates.

To use a port other than 80, edit `HTTP_PORT` in `.env` (created from `.env.example`).

## Operating it

```bash
docker compose ps                 # status + health
docker compose logs -f ml         # follow logs of one service
docker compose restart backend    # restart a service
docker compose down               # stop everything
curl http://localhost/api/health  # backend health through nginx
```

Containers restart automatically after crashes and after a server reboot (`restart: unless-stopped`,
and Docker is enabled at boot by the setup script).

## HTTPS (recommended for anything public)

Point a domain at the server, then put a TLS terminator in front of port 80. The simplest option is
Caddy on the host:

```bash
# set HTTP_PORT=8080 in .env and re-run deploy/deploy.sh, then:
sudo apt install -y caddy
echo 'your.domain.com { reverse_proxy localhost:8080 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Twilio requires a public HTTPS URL for the WhatsApp webhook: `https://your.domain.com/api/whatsapp`.

## Updating the model

Replace the three files in `backend/python_service/model/` (`model.pth`, `metadata.json`,
`label_encoder.pkl`) with a new export from `saved_models/<run>/`, then `bash deploy/deploy.sh`.
If the new model was trained with different NumPy / scikit-learn versions, update
`backend/requirements.txt` to match — the pickled label encoder only loads with compatible versions.

## Local development (without Docker)

```bash
cd backend/python_service && pip install -r ../requirements.txt && python predict.py   # :5001
cd backend && npm install && npm start                                                 # :5000
cd frontend && npm install && npm start    # :3000, proxies /api to :5000
```
