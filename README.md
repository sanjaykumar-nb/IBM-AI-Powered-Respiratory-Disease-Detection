# IBM-AI-Powered-Respiratory-Disease-Detection

Graph Neural Network that classifies respiratory sounds into **Asthma, Bronchial, COPD, Healthy and
Pneumonia** (95.47% test accuracy), plus a web app to run it.

## Repository layout

| Path | What it is |
|------|------------|
| [`respiratory-sound-classifier/`](respiratory-sound-classifier/) | Web app: React frontend, Express backend, Flask ML service — Dockerised. See its [README](respiratory-sound-classifier/README.md) and [DEPLOY.md](respiratory-sound-classifier/DEPLOY.md). |
| [`model_trained.ipynb`](model_trained.ipynb) | **Training notebook for the deployed model** (feature extraction → kNN graphs → GCN training → export). |
| `Asthma Detection Dataset Version 2/` | Training audio: 1,211 WAV files in `asthma/`, `Bronchial/`, `copd/`, `healthy/`, `pneumonia/`. |
| `saved_models/respiratory_model_20250904_002134/` | Model exported by `model_trained.ipynb`; the same files ship in `respiratory-sound-classifier/backend/python_service/model/`. |
| `best_respiratory_model.pth` | Best training checkpoint (includes optimizer state). |
| `wav_to_mff.ipynb` | Earlier experiment: builds the `graph_data/` and `graph_dataset.pt` caches. Not used by the deployed model. |
| `other_dataset_training.ipynb` | Experiment on the ICBHI dataset (not included). Not used by the deployed model. |
| `*.mdj`, `*.docx`, `*.png` | UML diagrams (StarUML), dataset description, training plots. |

## Run the app

```bash
cd respiratory-sound-classifier
docker compose up -d --build     # then open http://localhost/
```

For a Linux server: `sudo bash deploy/setup-server.sh` once, then `bash deploy/deploy.sh`
(both inside `respiratory-sound-classifier/`).

## Retrain the model

Open `model_trained.ipynb` from the repository root (it reads `Asthma Detection Dataset Version 2/`
relative to the working directory) and run all cells. Copy the new `saved_models/<run>/` files into
`respiratory-sound-classifier/backend/python_service/model/` to deploy them.

> ⚠️ Research project only — not a medical device and not for clinical diagnosis.
