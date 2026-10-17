#!/usr/bin/env python3
"""Test and visualise the respiratory sound GNN.

Runs inference through the web app's own code (respiratory-sound-classifier/backend/python_service/
predict.py), so the results are exactly what the deployed service would return.

  1. Sanity tests     - probabilities, determinism, short / long / resampled audio, silence and noise
                       refused, and every dataset recording passes the input quality gate
  2. Evaluation       - accuracy, balanced accuracy, per-class precision/recall/F1
  3. Figures          - confusion matrix, per-class metrics, confidence, latency
  4. Example panels   - waveform, spectrogram, the frame graph the GNN sees, class probabilities

Which recordings are evaluated:
  * model trained by train_on_linuxone.ipynb -> its held-out test patients (listed in metadata.json)
  * any other model                          -> the whole dataset (includes training data: optimistic)

Usage (from the repository root, e.g. in a JupyterLab terminal):
  python evaluate_model.py                                    # the model the app currently serves
  python evaluate_model.py --model-dir saved_models/<run>     # a specific saved model
  python evaluate_model.py --limit 100                        # quick run on a stratified sample
  python evaluate_model.py --files a.wav b.wav                # just classify and plot these files
"""
import argparse
import csv
import datetime as dt
import json
import os
import platform
import random
import re
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
APP_ML_DIR = REPO / "respiratory-sound-classifier" / "backend" / "python_service"
DEFAULT_MODEL_DIR = APP_ML_DIR / "model"
DATASET = REPO / "Asthma Detection Dataset Version 2"
CLASS_FOLDERS = {"Bronchial": "Bronchial", "asthma": "Asthma", "copd": "COPD", "healthy": "Healthy", "pneumonia": "Pneumonia"}
CLASS_COLORS = {"Healthy": "#2f7d4f", "Asthma": "#b07a1f", "COPD": "#a63a2b", "Pneumonia": "#6b4c8a", "Bronchial": "#2f5d8a"}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR, help="folder with model.pth, metadata.json, label_encoder.pkl")
    p.add_argument("--split", choices=["auto", "test", "all"], default="auto",
                   help="auto: held-out test patients if the model records them, else all recordings")
    p.add_argument("--limit", type=int, default=None, help="evaluate at most N recordings (stratified sample)")
    p.add_argument("--examples", type=int, default=1, help="example panels per class (plus up to 3 misclassified)")
    p.add_argument("--files", nargs="+", type=Path, help="only classify and plot these WAV files")
    p.add_argument("--out", type=Path, default=None, help="output folder (default reports/<model>_<time>)")
    return p.parse_args()


# ------------------------------------------------------------------------------------------ setup
def load_service(model_dir):
    """Import the app's inference module with MODEL_DIR pointing at the model to test."""
    os.environ["MODEL_DIR"] = str(model_dir.resolve())
    sys.path.insert(0, str(APP_ML_DIR))
    import predict as service

    if not service.load_model():
        sys.exit(f"Could not load the model from {model_dir}")
    return service


def label_for(path):
    folder = Path(path).parent.name
    return CLASS_FOLDERS.get(folder)


def dataset_files():
    return [f for folder in CLASS_FOLDERS for f in sorted((DATASET / folder).glob("*.wav"))]


def choose_files(args, metadata):
    test_files = metadata.get("training", {}).get("test_files")
    if args.split == "test" and not test_files:
        sys.exit("This model's metadata.json lists no test files (only models from train_on_linuxone.ipynb do).")
    if args.split in ("auto", "test") and test_files:
        files = [REPO / f for f in test_files]
        note = f"held-out test patients recorded by the training run ({len(files)} recordings)"
    else:
        files = dataset_files()
        note = ("ALL recordings in the dataset - this includes the model's training data, so the scores "
                "overstate how it does on new patients")
    missing = [f for f in files if not f.exists()]
    if missing:
        sys.exit(f"{len(missing)} recordings not found, e.g. {missing[0]}")
    if args.limit and args.limit < len(files):
        rng = random.Random(42)
        by_class = {}
        for f in files:
            by_class.setdefault(label_for(f), []).append(f)
        per_class = max(1, args.limit // len(by_class))
        files = sorted(f for group in by_class.values() for f in rng.sample(group, min(per_class, len(group))))
        note += f"; stratified sample of {len(files)}"
    return files, note


# ------------------------------------------------------------------------------------------ 1. sanity tests
def sanity_tests(service, sample_file):
    import numpy as np
    import soundfile as sf

    results = []

    def check(name, fn):
        try:
            detail = fn()
            results.append((name, True, detail))
        except Exception as e:  # report and keep going
            results.append((name, False, f"{type(e).__name__}: {e}"))

    def write(audio, sr):
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        sf.write(path, audio.astype(np.float32), sr)
        return path

    def classify_synthetic(audio, sr):
        path = write(audio, sr)
        try:
            r = service.classify_file(path)
            return f"→ {r['predicted_class']} ({r['confidence']:.0%})"
        finally:
            os.remove(path)

    def refused(audio, sr, reason):
        path = write(audio, sr)
        try:
            r = service.classify_file(path)
        except service.RecordingQualityError as e:
            assert e.reason == reason, f"refused as '{e.reason}', expected '{reason}'"
            return f"refused ({e.reason}): {e.quality}"
        finally:
            os.remove(path)
        raise AssertionError(f"not refused: classified as {r['predicted_class']} ({r['confidence']:.0%})")

    def probs_valid():
        r = service.classify_file(str(sample_file))
        p = np.array(list(r["all_probabilities"].values()))
        assert len(p) == len(service.label_encoder.classes_), "wrong number of classes"
        assert np.all((p >= 0) & (p <= 1)), "probability outside [0, 1]"
        assert abs(p.sum() - 1) < 1e-4, f"probabilities sum to {p.sum():.6f}"
        assert r["predicted_class"] == max(r["all_probabilities"], key=r["all_probabilities"].get)
        return f"{len(p)} classes, sum = {p.sum():.6f}"

    def deterministic():
        a = service.classify_file(str(sample_file))["all_probabilities"]
        b = service.classify_file(str(sample_file))["all_probabilities"]
        diff = max(abs(a[k] - b[k]) for k in a)
        assert diff == 0, f"repeat run differs by {diff:g}"
        return "identical probabilities on repeat"

    import librosa

    rng = np.random.default_rng(0)
    real, real_sr = librosa.load(str(sample_file), sr=None)  # a real recording at its own sample rate
    check("probabilities are valid", probs_valid)
    check("prediction is deterministic", deterministic)
    # Short / long / resampled variants of a real recording must still be classified...
    check("short recording (1 s) is padded", lambda: classify_synthetic(real[:real_sr], real_sr))
    check("long recording (30 s) is centre-cropped",
          lambda: classify_synthetic(np.tile(real, int(np.ceil(30 * real_sr / len(real))))[:30 * real_sr], real_sr))
    check("44.1 kHz input is resampled",
          lambda: classify_synthetic(librosa.resample(real, orig_sr=real_sr, target_sr=44100), 44100))
    # ...while input that is not a lung recording must be refused instead of getting a confident label
    check("silent recording is refused", lambda: refused(np.zeros(4000 * 6), 4000, "silent"))
    check("near-silent recording is refused", lambda: refused(1e-5 * rng.standard_normal(4000 * 6), 4000, "silent"))
    check("white noise (4 kHz) is refused", lambda: refused(0.1 * rng.standard_normal(4000 * 5), 4000, "noise"))
    check("white noise (44.1 kHz) is refused", lambda: refused(0.1 * rng.standard_normal(44100 * 5), 44100, "noise"))
    check("very short recording (0.1 s) is refused", lambda: refused(real[:real_sr // 10], real_sr, "too_short"))
    check("every dataset recording passes the quality gate", lambda: quality_gate_passes(service))
    return results


def quality_gate_passes(service):
    """All recordings in the dataset (not only the evaluated split) must pass predict.check_quality."""
    files = dataset_files()
    worst = {"rms_dbfs": 0.0, "peak_dbfs": 0.0, "spectral_flatness": 0.0, "recording_seconds": 1e9}
    failed = []
    for f in files:
        audio, sr, target_samples, seconds = service.load_window(str(f))
        q = service.quality_signals(audio, sr, target_samples, seconds)
        try:
            service.check_quality(q)
        except service.RecordingQualityError as e:
            failed.append(f"{f.relative_to(DATASET).as_posix()} ({e.reason})")
        worst = {"rms_dbfs": min(worst["rms_dbfs"], q["rms_dbfs"]), "peak_dbfs": min(worst["peak_dbfs"], q["peak_dbfs"]),
                 "spectral_flatness": max(worst["spectral_flatness"], q["spectral_flatness"]),
                 "recording_seconds": min(worst["recording_seconds"], q["recording_seconds"])}
    assert not failed, f"{len(failed)} of {len(files)} refused, e.g. {', '.join(failed[:3])}"
    return (f"{len(files)} recordings; worst: {worst['recording_seconds']:.2f} s, RMS {worst['rms_dbfs']} dBFS, "
            f"peak {worst['peak_dbfs']} dBFS, flatness {worst['spectral_flatness']:.3f}")


# ------------------------------------------------------------------------------------------ 2. evaluation
def evaluate(service, files):
    rows = []
    t0 = time.perf_counter()
    for i, f in enumerate(files, 1):
        r = service.classify_file(str(f))
        rows.append({
            "file": f.relative_to(REPO).as_posix() if f.is_relative_to(REPO) else str(f),
            "true": label_for(f),
            "predicted": r["predicted_class"],
            "confidence": r["confidence"],
            "inference_ms": r["inference_ms"],
            **{f"p_{k}": v for k, v in r["all_probabilities"].items()},
        })
        if i % 50 == 0 or i == len(files):
            print(f"  {i:4d}/{len(files)} recordings  ({time.perf_counter() - t0:.0f} s)")
    return rows


def metrics(rows, classes):
    from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, f1_score

    y_true = [r["true"] for r in rows]
    y_pred = [r["predicted"] for r in rows]
    report = classification_report(y_true, y_pred, labels=classes, output_dict=True, zero_division=0)
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "balanced_accuracy": balanced_accuracy_score(y_true, y_pred),
        "macro_f1": f1_score(y_true, y_pred, labels=classes, average="macro", zero_division=0),
        "per_class": {c: {k: report[c][k] for k in ("precision", "recall", "f1-score", "support")} for c in classes},
        "text": classification_report(y_true, y_pred, labels=classes, digits=3, zero_division=0),
    }


# ------------------------------------------------------------------------------------------ 3. figures
def plt_setup():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"figure.dpi": 120, "savefig.bbox": "tight", "axes.spines.top": False, "axes.spines.right": False,
                         "font.size": 10})
    return plt


def fig_confusion(plt, rows, classes, out):
    import numpy as np
    from sklearn.metrics import confusion_matrix

    cm = confusion_matrix([r["true"] for r in rows], [r["predicted"] for r in rows], labels=classes)
    norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    for ax, data, title, fmt in [(axes[0], cm, "Counts", "d"), (axes[1], norm, "Share of each true class (recall on diagonal)", ".2f")]:
        im = ax.imshow(data, cmap="Blues", vmin=0)
        ax.set_xticks(range(len(classes)), classes, rotation=30, ha="right")
        ax.set_yticks(range(len(classes)), classes)
        ax.set_xlabel("Predicted")
        ax.set_ylabel("True")
        ax.set_title(title)
        for i in range(len(classes)):
            for j in range(len(classes)):
                v = data[i, j]
                ax.text(j, i, format(v, fmt), ha="center", va="center", color="white" if v > data.max() * 0.6 else "black")
        fig.colorbar(im, ax=ax, fraction=0.046)
    fig.suptitle("Confusion matrix")
    fig.savefig(out / "confusion_matrix.png")
    plt.close(fig)


def fig_per_class(plt, m, classes, out):
    import numpy as np

    x = np.arange(len(classes))
    w = 0.26
    fig, ax = plt.subplots(figsize=(10, 4.5))
    for k, (name, off) in enumerate([("precision", -w), ("recall", 0), ("f1-score", w)]):
        vals = [m["per_class"][c][name] for c in classes]
        bars = ax.bar(x + off, vals, w, label=name, color=["#9aa5ad", "#0e5e5a", "#17191c"][k])
        ax.bar_label(bars, fmt="%.2f", fontsize=8, padding=2)
    ax.set_xticks(x, [f"{c}\n(n={int(m['per_class'][c]['support'])})" for c in classes])
    ax.set_ylim(0, 1.1)
    ax.set_title(f"Per-class metrics — accuracy {m['accuracy']:.3f}, balanced {m['balanced_accuracy']:.3f}, macro F1 {m['macro_f1']:.3f}")
    ax.legend(ncols=3, loc="upper center", bbox_to_anchor=(0.5, -0.18), frameon=False)
    fig.savefig(out / "per_class_metrics.png")
    plt.close(fig)


def fig_confidence(plt, rows, out):
    import numpy as np

    conf = np.array([r["confidence"] for r in rows])
    ok = np.array([r["true"] == r["predicted"] for r in rows])
    bins = np.linspace(0.2, 1.0, 17)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    ax1.hist(conf[ok], bins=bins, alpha=0.8, label=f"correct ({ok.sum()})", color="#0e5e5a")
    ax1.hist(conf[~ok], bins=bins, alpha=0.8, label=f"wrong ({(~ok).sum()})", color="#a63a2b")
    ax1.set_xlabel("confidence of the predicted class")
    ax1.set_ylabel("recordings")
    ax1.set_title("Is the model more confident when it is right?")
    ax1.legend()
    # accuracy within confidence bands = how far the confidence can be trusted
    edges = [0.0, 0.6, 0.85, 1.0001]
    names = ["< 60%", "60–85%", "≥ 85%"]
    acc = [ok[(conf >= lo) & (conf < hi)].mean() if ((conf >= lo) & (conf < hi)).any() else 0 for lo, hi in zip(edges, edges[1:])]
    cnt = [int(((conf >= lo) & (conf < hi)).sum()) for lo, hi in zip(edges, edges[1:])]
    bars = ax2.bar(names, acc, color=["#a63a2b", "#b07a1f", "#2f7d4f"])
    ax2.bar_label(bars, labels=[f"{a:.0%}\n(n={n})" if n else "no\nrecordings" for a, n in zip(acc, cnt)], padding=2)
    ax2.set_ylim(0, 1.15)
    ax2.set_ylabel("accuracy")
    ax2.set_title("Accuracy by confidence band (as shown in the app)")
    fig.savefig(out / "confidence.png")
    plt.close(fig)


def fig_latency(plt, rows, arch, out):
    import numpy as np

    ms = np.array([r["inference_ms"] for r in rows])
    fig, ax = plt.subplots(figsize=(8, 3.6))
    ax.hist(ms, bins=30, color="#17191c")
    for q, ls in [(50, "-"), (95, "--")]:
        v = np.percentile(ms, q)
        ax.axvline(v, color="#a63a2b", ls=ls, lw=1)
        ax.text(v, ax.get_ylim()[1] * 0.92, f" p{q} {v:.0f} ms", color="#a63a2b")
    ax.set_xlabel("end-to-end inference per recording (ms): load, resample, features, graph, GNN")
    ax.set_ylabel("recordings")
    ax.set_title(f"Inference latency on {arch}")
    fig.savefig(out / "latency.png")
    plt.close(fig)


# ------------------------------------------------------------------------------------------ 4. example panels
def load_analysed_audio(path, sr=16000, duration=5.0):
    """Same preprocessing as predict.classify_file, returning the audio the model sees."""
    import librosa
    import numpy as np

    audio, _ = librosa.load(path, sr=sr)
    n = int(sr * duration)
    if len(audio) > n:
        start = (len(audio) - n) // 2
        audio = audio[start:start + n]
    elif len(audio) < n:
        audio = np.pad(audio, (0, n - len(audio)))
    peak = np.max(np.abs(audio))
    return (audio / peak if peak > 0 else audio), sr


def fig_example(plt, service, path, result, true_label, out_file):
    import librosa
    import librosa.display
    import networkx as nx
    import numpy as np

    audio, sr = load_analysed_audio(str(path))
    feats = service.extract_features(audio, sr)
    graph = service.graph_converter.features_to_graph(feats)

    fig = plt.figure(figsize=(14, 7.5))
    gs = fig.add_gridspec(2, 3, width_ratios=[1.6, 1.6, 1], hspace=0.38, wspace=0.28)

    ax = fig.add_subplot(gs[0, :2])
    t = np.arange(len(audio)) / sr
    ax.plot(t, audio, lw=0.4, color="#17191c")
    ax.set_xlim(0, t[-1])
    ax.set_title("Waveform (the 5 s the model analyses)")
    ax.set_xlabel("s")

    ax = fig.add_subplot(gs[1, :2])
    mel = librosa.power_to_db(librosa.feature.melspectrogram(y=audio, sr=sr, n_mels=64, fmax=4000), ref=np.max)
    librosa.display.specshow(mel, sr=sr, x_axis="time", y_axis="mel", fmax=4000, ax=ax, cmap="magma")
    ax.set_title("Mel spectrogram (0–4 kHz)")

    ax = fig.add_subplot(gs[0, 2])
    probs = result["all_probabilities"]
    names = sorted(probs, key=probs.get)
    ax.barh(names, [probs[n] for n in names], color=[CLASS_COLORS.get(n, "#888") for n in names])
    for i, n in enumerate(names):
        inside = probs[n] > 0.75
        ax.text(probs[n] - 0.02 if inside else probs[n] + 0.02, i, f"{probs[n]:.1%}", va="center", fontsize=9,
                ha="right" if inside else "left", color="white" if inside else "black")
    ax.set_xlim(0, 1)
    ax.set_title("Class probabilities")

    ax = fig.add_subplot(gs[1, 2])
    g = nx.Graph()
    g.add_nodes_from(range(graph.num_nodes))
    g.add_edges_from(graph.edge_index.t().tolist())
    pos = nx.spring_layout(g, seed=0)
    nx.draw_networkx_edges(g, pos, ax=ax, width=0.3, alpha=0.4)
    nodes = nx.draw_networkx_nodes(g, pos, ax=ax, node_size=14, node_color=range(graph.num_nodes), cmap="viridis")
    fig.colorbar(nodes, ax=ax, fraction=0.046, label="frame (time →)")
    ax.set_title(f"Frame graph the GNN sees\n{graph.num_nodes} frames, {g.number_of_edges()} links (k = 5)")
    ax.axis("off")

    verdict = "" if true_label is None else ("  ✓ correct" if true_label == result["predicted_class"] else f"  ✗ true class: {true_label}")
    fig.suptitle(f"{Path(path).name} → {result['predicted_class']} ({result['confidence']:.1%}){verdict}", fontsize=13)
    fig.savefig(out_file)
    plt.close(fig)


def pick_examples(rows, per_class):
    chosen = []
    by_class = {}
    for r in rows:
        by_class.setdefault(r["true"], []).append(r)
    for c in sorted(by_class):
        correct = [r for r in by_class[c] if r["predicted"] == c]
        chosen += sorted(correct, key=lambda r: -r["confidence"])[:per_class]
    wrong = sorted((r for r in rows if r["predicted"] != r["true"]), key=lambda r: -r["confidence"])
    return chosen + wrong[:3]  # the most confident mistakes are the most instructive


# ------------------------------------------------------------------------------------------ main
def main():
    args = parse_args()
    model_dir = args.model_dir.resolve()
    metadata = json.loads((model_dir / "metadata.json").read_text())
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = (args.out or REPO / "reports" / f"{model_dir.name}_{stamp}").resolve()
    (out / "examples").mkdir(parents=True, exist_ok=True)

    print("=" * 72)
    print(f"Model      : {model_dir.relative_to(REPO) if model_dir.is_relative_to(REPO) else model_dir}")
    trained_on = metadata.get("training", {}).get("environment", {}).get("architecture")
    if trained_on:
        print(f"Trained on : {trained_on} ({metadata['training']['environment'].get('host')}), "
              f"{metadata['training'].get('finished', '')}")
    print(f"Running on : {platform.machine()} ({platform.node()}), {os.cpu_count()} cores")
    print(f"Output     : {out}")
    print("=" * 72)

    service = load_service(model_dir)
    classes = [str(c) for c in service.label_encoder.classes_]
    plt = plt_setup()

    # Just classify the given files
    if args.files:
        for f in args.files:
            try:
                r = service.classify_file(str(f))
            except service.RecordingQualityError as e:
                print(f"{f.name:32s} → refused: {e}")
                continue
            true_label = label_for(f)
            print(f"{f.name:32s} → {r['predicted_class']:10s} {r['confidence']:.1%}  ({r['inference_ms']:.0f} ms)")
            fig_example(plt, service, f, r, true_label, out / "examples" / f"{f.stem}.png")
        print(f"\nPanels saved to {out / 'examples'}")
        return

    files, note = choose_files(args, metadata)

    print("\n1. Sanity tests")
    tests = sanity_tests(service, files[0])
    for name, passed, detail in tests:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name:48s} {detail}")

    print(f"\n2. Evaluating on {note}")
    rows = evaluate(service, files)
    m = metrics(rows, classes)
    print(f"\n  accuracy           {m['accuracy']:.3f}")
    print(f"  balanced accuracy  {m['balanced_accuracy']:.3f}")
    print(f"  macro F1           {m['macro_f1']:.3f}\n")
    print("  " + m["text"].replace("\n", "\n  "))

    print("3. Figures")
    fig_confusion(plt, rows, classes, out)
    fig_per_class(plt, m, classes, out)
    fig_confidence(plt, rows, out)
    fig_latency(plt, rows, platform.machine(), out)
    print("  confusion_matrix.png, per_class_metrics.png, confidence.png, latency.png")

    print("4. Example panels")
    for r in pick_examples(rows, args.examples):
        res = {"predicted_class": r["predicted"], "confidence": r["confidence"],
               "all_probabilities": {c: r[f"p_{c}"] for c in classes}}
        tag = "ok" if r["true"] == r["predicted"] else "wrong"
        name = f"{r['true']}_{tag}_{Path(r['file']).stem}.png"
        fig_example(plt, service, REPO / r["file"], res, r["true"], out / "examples" / name)
        print(f"  examples/{name}")

    with open(out / "predictions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    ms = sorted(r["inference_ms"] for r in rows)
    summary = {
        "model_dir": str(model_dir),
        "trained_on": trained_on,
        "evaluated_on": {"architecture": platform.machine(), "host": platform.node(), "cpu_cores": os.cpu_count()},
        "recordings": note,
        "sanity_tests": {name: passed for name, passed, _ in tests},
        "accuracy": m["accuracy"], "balanced_accuracy": m["balanced_accuracy"], "macro_f1": m["macro_f1"],
        "per_class": m["per_class"],
        "latency_ms": {"median": ms[len(ms) // 2], "p95": ms[int(len(ms) * 0.95) - 1] if len(ms) > 1 else ms[0]},
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    lines = [
        f"# Model evaluation — {model_dir.name}",
        "",
        f"- Evaluated on **{platform.machine()}** ({platform.node()}), {dt.datetime.now():%Y-%m-%d %H:%M}",
        f"- Recordings: {note}",
        f"- Sanity tests: {sum(p for _, p, _ in tests)}/{len(tests)} passed",
        "",
        "| Metric | Value |", "|---|---|",
        f"| Accuracy | {m['accuracy']:.3f} |",
        f"| Balanced accuracy | {m['balanced_accuracy']:.3f} |",
        f"| Macro F1 | {m['macro_f1']:.3f} |",
        f"| Median latency | {summary['latency_ms']['median']:.0f} ms |",
        "",
        "| Class | Precision | Recall | F1 | Recordings |", "|---|---|---|---|---|",
        *[f"| {c} | {v['precision']:.3f} | {v['recall']:.3f} | {v['f1-score']:.3f} | {int(v['support'])} |" for c, v in m["per_class"].items()],
        "",
        "![Confusion matrix](confusion_matrix.png)", "![Per-class metrics](per_class_metrics.png)",
        "![Confidence](confidence.png)", "![Latency](latency.png)",
    ]
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    failed = [n for n, p, _ in tests if not p]
    print(f"\nDone. Report: {out / 'report.md'}")
    if failed:
        print(f"WARNING: {len(failed)} sanity test(s) failed: {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
