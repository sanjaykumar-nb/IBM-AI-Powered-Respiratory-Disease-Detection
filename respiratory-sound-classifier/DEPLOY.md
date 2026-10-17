# Deploying on a Linux server (Docker Compose)

The app runs as four containers:

| Service    | Image contents                                    | Port                        |
|------------|---------------------------------------------------|-----------------------------|
| `frontend` | React build served by nginx; proxies `/api/*`     | published on `HTTP_PORT` (80) |
| `backend`  | Express API: uploads, WhatsApp webhook            | 5000 (internal only)        |
| `ml`       | Flask + PyTorch Geometric model, run by gunicorn  | 5001 (internal only)        |
| `db2`      | IBM Db2 Community Edition: screening history      | 50000 (internal only)       |

Only nginx is exposed; the browser calls `/api/...` on the same origin, so there is no CORS or
hard-coded host to configure.

## Server requirements

- Linux on **x86_64** or **IBM Z / LinuxONE (s390x)** — Ubuntu 22.04/24.04, Debian 12, RHEL/Rocky/Alma 8/9
- 2 vCPU, **8 GB RAM** recommended (ML container capped at 3 GB, Db2 at 3 GB), ~12 GB free disk
  (the Db2 image is ~3 GB uncompressed)
- Inbound TCP 80 open (and 443 if you add HTTPS)

### IBM Z / LinuxONE (s390x)

`deploy/deploy.sh` detects s390x (`uname -m`) and automatically builds the ML service from
`backend/python_service/Dockerfile.s390x` (via `docker-compose.s390x.yml`, recorded as `COMPOSE_FILE`
in `.env`). That image differs from the x86_64 one because the Python ML stack is not published for s390x
on PyPI:

- numpy, scipy, scikit-learn, soxr, etc. come from Debian 13's s390x packages
- PyTorch is the official `2.8.0+cpu` s390x wheel from download.pytorch.org
- numba (required by librosa) does not support s390x, so `numba_shim/` — a small pure-NumPy stand-in —
  is installed instead. It was verified to produce bit-identical audio features to real numba for this
  model, at the same speed.

Tested under QEMU s390x emulation: 15/15 sample recordings got the same diagnosis as the x86_64 image.
Confidence scores match to ~1e-5 on clear-cut recordings and can differ by a few percent on borderline
ones. That comes from the top spectral-contrast bands (above 2 kHz, where the 4 kHz source recordings
have no real signal), which vary between any two machines/library builds — not from s390x itself.

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

## Screening history (IBM Db2)

Every screening — web upload and WhatsApp — is written by the API gateway to an
`SCREENINGS` table in IBM Db2 Community Edition (free; image `icr.io/db2_community/db2`, published for
x86_64 and s390x). The **History** section of the web app reads it through `GET /api/history`.
**Only results are stored, never audio**: predicted class, confidence, the five class probabilities,
the quality-gate reason and signals for refused recordings, recording length, inference time, channel and
server architecture.

- **Password**: `deploy/deploy.sh` writes a random `DB2_PASSWORD` into `.env` on first run (replacing the
  `change-me` placeholder). It never leaves the server; don't commit `.env`.
- **First start takes several minutes** (on LinuxONE plan for 5–10) while the container creates the
  instance and the `SCREEN` database; later starts take about a minute. Watch it with
  `docker compose logs -f db2` until it prints `Setup has completed`.
- **Screening never depends on Db2.** While Db2 is starting, restarting or down, the app keeps screening
  normally; the gateway logs `IBM Db2 unavailable - screening ... not recorded` and skips the write (it
  retries the connection every 15 s), and the History section says the database is not reachable.
- **Memory**: the `db2` container is capped at 3 GB, and `deploy/db2/limit-memory.sh` limits Db2's
  `INSTANCE_MEMORY` to 2 GB (`DB2_INSTANCE_MEMORY_MB`) — the Db2 image only does this itself under
  Kubernetes. On an 8 GB server, ML (3 GB) + Db2 (3 GB) fit, but **do not run the Jupyter `training`
  profile (5 GB) at the same time**: `docker compose stop db2` before `bash deploy/jupyter.sh`, and
  `docker compose start db2` afterwards. `deploy/jupyter.sh` warns when Db2 is running.
- **Privileged**: the Db2 image must run privileged (it sets kernel IPC parameters). It is not published
  on any host port — only the gateway reaches it, on the compose network.
- **Driver**: the gateway uses IBM's `ibm_db` Node.js driver, which downloads IBM's Db2 CLI driver for the
  build machine's architecture (x86_64 or s390x) during `docker compose build`; that is why the backend
  image is Debian-based rather than Alpine. The s390x CLI driver uses z14-and-newer instructions (vector
  packed decimal), so it runs on any current LinuxONE / IBM Z but **cannot connect under QEMU s390x
  emulation** on a PC (it stops with "Illegal instruction"). Check it on the server after deploying:
  `docker compose logs backend | grep "IBM Db2"` should show `IBM Db2: connected to SCREEN on db2 (DB2 v12.1.5.0, s390x)`
  after the first screening.
- Data lives in the `db2-data` Docker volume and survives `docker compose down` and redeploys
  (`docker compose down -v` deletes it).

Query it with the Db2 command line inside the container:

```bash
docker compose exec db2 su - db2inst1 -c "db2 connect to SCREEN && db2 'SELECT id, created_at, channel, status, predicted_class, DEC(confidence, 5, 3) AS conf, refusal_reason, inference_ms FROM screenings ORDER BY id DESC FETCH FIRST 10 ROWS ONLY'"
docker compose exec db2 su - db2inst1 -c "db2 connect to SCREEN && db2 'SELECT channel, status, COUNT(*) AS n FROM screenings GROUP BY channel, status'"
docker compose exec -it db2 su - db2inst1   # interactive: db2 connect to SCREEN, then any SQL; quit with: db2 terminate; exit
```

`created_at` is stored in UTC. To start the history from scratch:
`... db2 'DELETE FROM screenings'` (or `docker compose down -v` to drop the whole database).

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

## Plain-language explanations with IBM Granite on watsonx.ai (optional)

With a watsonx.ai key, each report gets a 2–3 sentence explanation written by IBM Granite, in
English, Tamil or Hindi, and WhatsApp replies include it too. Only the predicted class and the five
probabilities are sent to IBM Cloud — never the recording or anything about the person. Without a key,
or if watsonx.ai is slow (6 s timeout) or out of quota, the app works exactly as before and the
explanation is simply left out.

1. In IBM Cloud, open **watsonx.ai** and create a project (this also creates or links a
   watsonx.ai Runtime service — the free **Lite** plan is enough for a demo; check IBM's watsonx.ai
   pricing page for its current monthly token allowance. One explanation uses a few hundred tokens).
2. Copy the **project ID** (project > Manage > General) and create an **API key**
   (IBM Cloud > Manage > Access (IAM) > API keys).
3. Note the region of your watsonx.ai service, e.g. Dallas = `https://us-south.ml.cloud.ibm.com`,
   Frankfurt = `https://eu-de.ml.cloud.ibm.com`, London = `https://eu-gb.ml.cloud.ibm.com`,
   Tokyo = `https://jp-tok.ml.cloud.ibm.com`.
4. On the server, put them in `.env` (never commit this file) and redeploy:

   ```bash
   WATSONX_API_KEY=...
   WATSONX_PROJECT_ID=...
   WATSONX_URL=https://us-south.ml.cloud.ibm.com
   ```

   ```bash
   bash deploy/deploy.sh
   docker compose logs backend | grep watsonx   # "watsonx.ai explanations on (ibm/granite-...)"
   ```

The server must be able to reach IBM Cloud over HTTPS. Check from the LinuxONE server:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://iam.cloud.ibm.com/identity/token   # any HTTP code = reachable
```

If a model is withdrawn from your region, the backend log shows the error; pick a current Granite
instruct model from watsonx.ai's model list and set `WATSONX_MODEL_ID` in `.env`.

## Training the model on the server (Jupyter)

`train_on_linuxone.ipynb` (repository root) trains the model on the server's own CPU, using the same
container environment as the inference service. JupyterLab is optional and only starts when asked:

```bash
bash deploy/jupyter.sh          # builds and starts JupyterLab, prints the URL with its token
```

JupyterLab listens on `127.0.0.1:8888` on the server only. From your PC, open an SSH tunnel
(PuTTY: *Connection → SSH → Tunnels*, source port `8888`, destination `localhost:8888`, *Add*, then
connect), open the printed URL, and run all cells of `train_on_linuxone.ipynb`. The notebook:

- splits train / validation / test **by patient**, so the reported test metrics are for unseen patients
- caches the extracted features in `cache/`, so re-runs skip extraction
- saves the model to `saved_models/respiratory_model_<arch>_<timestamp>/` and checks it with the app's
  own `predict.py`; set `DEPLOY = True` in the last cell to copy it into the app, then run `deploy/deploy.sh`

Stop JupyterLab with `bash deploy/jupyter.sh stop`.

### Testing and visualising a model

`evaluate_model.py` (repository root) runs sanity tests, evaluates a model and writes figures plus a
report to `reports/<model>_<time>/`. It runs inference through the app's own `predict.py`. With JupyterLab
running, open *File → New → Terminal* in JupyterLab (or use
`docker compose --profile training exec jupyter bash` on the server) and run:

```bash
python evaluate_model.py                                   # the model the app serves
python evaluate_model.py --model-dir saved_models/<run>    # a model from train_on_linuxone.ipynb
python evaluate_model.py --limit 100                       # quicker, on a stratified sample
python evaluate_model.py --files path/to/recording.wav     # classify and plot specific files
```

For models trained by the notebook it evaluates exactly the held-out test patients listed in their
`metadata.json`; for other models it uses every recording and says so, since those scores include
training data. Output: `report.md`, `summary.json`, `predictions.csv`, `confusion_matrix.png`,
`per_class_metrics.png`, `confidence.png`, `latency.png` and `examples/` (waveform, spectrogram, the frame
graph the GNN sees, and class probabilities for individual recordings).

## Updating the model

Replace the three files in `backend/python_service/model/` (`model.pth`, `metadata.json`,
`label_encoder.pkl`) with a new export from `saved_models/<run>/`, then `bash deploy/deploy.sh`.
If the new model was trained with different NumPy / scikit-learn versions, update
`backend/requirements.txt` to match — the pickled label encoder only loads with compatible versions.

## Local development (without Docker)

```bash
cd backend/python_service && pip install -r ../requirements.txt && python predict.py   # :5001
cd backend && npm install && npm start                                                 # :5000 (history off unless DB2_PASSWORD is set)
cd frontend && npm install && npm run dev  # :3000, proxies /api to :5000
```
