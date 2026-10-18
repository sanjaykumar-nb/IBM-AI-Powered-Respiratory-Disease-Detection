import os
import sys
import numpy as np
import librosa
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, global_mean_pool
from torch_geometric.data import Data, Batch
from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import json
import tempfile
import time
import platform
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

# --- Model Architecture ---
class FeatureToGraphConverter:
    def __init__(self, k_neighbors=5):
        self.k_neighbors = k_neighbors

    def features_to_graph(self, features, label=None):
        features = features.T
        edge_index = self._create_knn_graph(features)
        x = torch.FloatTensor(features)
        edge_index = torch.LongTensor(edge_index)
        if label is not None:
            data = Data(x=x, edge_index=edge_index, y=torch.LongTensor([label]))
        else:
            data = Data(x=x, edge_index=edge_index)
        return data

    def _create_knn_graph(self, features):
        n_nodes = features.shape[0]
        if n_nodes <= 1:
            return np.array([[0], [0]])
        distances = np.linalg.norm(features[:, np.newaxis] - features[np.newaxis, :], axis=2)
        edges = []
        for i in range(n_nodes):
            k_actual = min(self.k_neighbors, n_nodes - 1)
            neighbors = np.argsort(distances[i])[1:k_actual + 1]
            for neighbor in neighbors:
                edges.append([i, neighbor])
                edges.append([neighbor, i])
        if edges:
            edges = list(set([tuple(edge) for edge in edges]))
            edges = np.array(edges).T
        else:
            edges = np.array([[0], [0]])
        return edges

class MultiClassRespiratoryGNN(nn.Module):
    def __init__(self, input_dim=76, hidden_dim=128, num_classes=5, dropout=0.5):
        super().__init__()
        self.conv1 = GCNConv(input_dim, hidden_dim)
        self.conv2 = GCNConv(hidden_dim, hidden_dim)
        self.conv3 = GCNConv(hidden_dim, hidden_dim)
        self.conv4 = GCNConv(hidden_dim, hidden_dim // 2)
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.bn2 = nn.BatchNorm1d(hidden_dim)
        self.bn3 = nn.BatchNorm1d(hidden_dim)
        self.bn4 = nn.BatchNorm1d(hidden_dim // 2)
        self.dropout = nn.Dropout(dropout)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim // 2, 64),
            nn.ReLU(),
            nn.BatchNorm1d(64),
            nn.Dropout(dropout * 0.7),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.BatchNorm1d(32),
            nn.Dropout(dropout * 0.5),
            nn.Linear(32, num_classes)
        )

    def forward(self, x, edge_index, batch):
        x1 = F.relu(self.bn1(self.conv1(x, edge_index)))
        x1 = self.dropout(x1)
        x2 = F.relu(self.bn2(self.conv2(x1, edge_index)))
        x2 = self.dropout(x2) + x1
        x3 = F.relu(self.bn3(self.conv3(x2, edge_index)))
        x3 = self.dropout(x3) + x2
        x4 = F.relu(self.bn4(self.conv4(x3, edge_index)))
        x = global_mean_pool(x4, batch)
        x = self.classifier(x)
        return F.log_softmax(x, dim=1)

# --- Global State ---
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = None
label_encoder = None
graph_converter = None

def load_model():
    global model, label_encoder, graph_converter
    
    try:
        model_folder = Path(os.environ.get('MODEL_DIR', Path(__file__).resolve().parent / 'model'))
        
        if not model_folder.exists():
            print(f"❌ Model folder not found at: {model_folder}")
            return False
            
        # Load metadata
        metadata_path = model_folder / 'metadata.json'
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
            
        # Load label encoder
        label_path = model_folder / 'label_encoder.pkl'
        with open(label_path, 'rb') as f:
            label_encoder = pickle.load(f)
            
        # Initialize converter
        graph_converter = FeatureToGraphConverter()
        
        # Initialize model
        model_config = metadata['model_config']
        model = MultiClassRespiratoryGNN(**model_config)
        
        # Load weights
        model_path_file = model_folder / 'model.pth'
        checkpoint = torch.load(model_path_file, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.to(device)
        model.eval()
        
        print(f"✅ Model loaded successfully")
        print(f"📊 Classes: {label_encoder.classes_}")
        print(f"🖥️  Device: {device}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error loading model: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def extract_features(audio, sr):
    try:
        mfcc = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=13)
        mfcc_delta = librosa.feature.delta(mfcc)
        mfcc_delta2 = librosa.feature.delta(mfcc, order=2)
        spectral_centroid = librosa.feature.spectral_centroid(y=audio, sr=sr)
        spectral_rolloff = librosa.feature.spectral_rolloff(y=audio, sr=sr)
        spectral_contrast = librosa.feature.spectral_contrast(y=audio, sr=sr)
        spectral_bandwidth = librosa.feature.spectral_bandwidth(y=audio, sr=sr)
        zero_crossing_rate = librosa.feature.zero_crossing_rate(audio)
        rms = librosa.feature.rms(y=audio)
        chroma = librosa.feature.chroma_stft(y=audio, sr=sr)
        mel_spec = librosa.feature.melspectrogram(y=audio, sr=sr, n_mels=13)
        mel_spec = librosa.power_to_db(mel_spec, ref=np.max)
        
        features = np.vstack([
            mfcc,
            mfcc_delta,
            mfcc_delta2,
            spectral_centroid,
            spectral_rolloff,
            spectral_contrast,
            spectral_bandwidth,
            zero_crossing_rate,
            chroma,
            mel_spec,
            rms
        ])
        
        if features.shape[0] != 76:
            print(f"Warning: Expected 76 features, got {features.shape[0]}")
            
        return features
    except Exception as e:
        print(f"Error extracting features: {e}")
        return None

# --- IBM Z hardware report (shown in the web app) ---
# Machine types are shared by an IBM Z model and the LinuxONE model of the same generation.
IBM_Z_MACHINES = {
    '2964': 'IBM z13 / LinuxONE Emperor', '2965': 'IBM z13s / LinuxONE Rockhopper',
    '3906': 'IBM z14 / LinuxONE Emperor II', '3907': 'IBM z14 ZR1 / LinuxONE Rockhopper II',
    '8561': 'IBM z15 T01 / LinuxONE III LT1', '8562': 'IBM z15 T02 / LinuxONE III LT2',
    '3931': 'IBM z16 A01 / LinuxONE Emperor 4', '3932': 'IBM z16 A02 / LinuxONE Rockhopper 4',
    '9175': 'IBM z17 ME1 / LinuxONE Emperor 5',
}
# /proc/cpuinfo flags for the on-chip facilities the web app reports
IBM_Z_FEATURES = ('vx', 'vxe', 'vxe2', 'nnpa', 'msa', 'dflt', 'sort')


def _read(path):
    try:
        return Path(path).read_text(errors='replace')
    except OSError:
        return ''


def ibm_z_info():
    """What the IBM Z / LinuxONE machine provides, read from /proc. None on other architectures.

    /proc/cpuinfo and /proc/sysinfo describe the host, so this works inside the container too.
    """
    if platform.machine() != 's390x':
        return None
    cpuinfo, sysinfo = _read('/proc/cpuinfo'), _read('/proc/sysinfo')
    features, machine_type, mhz = [], None, None
    for line in cpuinfo.splitlines():
        key, _, value = line.partition(':')
        if key.strip() == 'features':
            features = [f for f in value.split() if f in IBM_Z_FEATURES]
        elif key.startswith('processor') and 'machine =' in value and machine_type is None:
            machine_type = value.split('machine =')[1].strip()
        elif key.strip() == 'cpu MHz static':
            mhz = int(value.strip() or 0) or None
    hypervisor = 'LPAR'
    for line in sysinfo.splitlines():
        key, _, value = line.partition(':')
        if key.strip() == 'Type' and not machine_type:
            machine_type = value.strip()
        elif key.strip().endswith('Control Program'):  # innermost hypervisor, e.g. "z/VM 7.3.0", "KVM/Linux"
            hypervisor = ' '.join(value.split())
    if not sysinfo:
        hypervisor = None  # unknown (e.g. under emulation)
    try:  # numpy's SIMD kernels in use: VX / VXE / VXE2 = IBM Z vector facility generations
        from numpy._core._multiarray_umath import __cpu_features__
    except ImportError:
        from numpy.core._multiarray_umath import __cpu_features__
    return {
        'machine_type': machine_type,
        'machine_name': IBM_Z_MACHINES.get(machine_type or ''),
        'hypervisor': hypervisor,
        'cpu_mhz': mhz,
        'cpus': os.cpu_count(),
        'features': features,
        'numpy_simd': [k for k in ('VX', 'VXE', 'VXE2', 'VXE3') if __cpu_features__.get(k)],
    }


IBM_Z = ibm_z_info()


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'device': str(device),
        'arch': platform.machine(),
        'ibm_z': IBM_Z,
    })

# --- Input quality gate ---
# The GNN always picks one of its 5 classes: without this gate, pure silence and white noise came back as
# "Bronchial" with 99-100% confidence. Recordings that fail a check are refused (HTTP 422) instead.
#
# Thresholds come from running quality_signals() over all 1,211 recordings in "Asthma Detection Dataset
# Version 2" (504 at 4 kHz, 707 at 44.1 kHz), then leaving a margin so that no real recording is refused:
#
#   signal (centre 5 s, before peak normalisation)   dataset min / median / max    refused when
#   recording length                                 0.48 s / 6.0 s / 6.0 s        < 0.25 s
#   RMS level                                        -40.4 / -16.4 / -2.9 dBFS     < -60 dBFS
#   peak level                                       -25.2 / -1.6 / +3.1 dBFS      < -45 dBFS
#   spectral flatness, 50 Hz - 2 kHz (median frame)  0.000 / 0.001 / 0.199         > 0.30
#
# For comparison: digital silence has no level at all, white noise at 4-44.1 kHz has flatness 0.40-0.57 and
# pink noise 0.38. Breath sounds are far from flat because their energy sits in a few low bands.
# The length limit is loose on purpose: the dataset itself contains recordings under 1 s.
MIN_RECORDING_SECONDS = 0.25
MIN_RMS_DBFS = -60.0
MIN_PEAK_DBFS = -45.0
MAX_SPECTRAL_FLATNESS = 0.30


class RecordingQualityError(ValueError):
    """The recording is not usable lung-sound audio; `reason` is a short code, `quality` the measured signals."""

    def __init__(self, message, reason, quality):
        super().__init__(message)
        self.reason = reason
        self.quality = quality


def _dbfs(value):
    return round(20 * float(np.log10(max(float(value), 1e-6))), 1)


def _spectral_flatness(audio, sr, fmin=50.0, fmax=2000.0):
    """Median per-frame spectral flatness (geometric / arithmetic mean of power) in the lung-sound band.

    The band stops at 2 kHz because the 4 kHz dataset recordings contain nothing above it, so a full-band
    measure would depend on the original sample rate. Frames of digital silence are skipped.
    """
    if len(audio) == 0:
        return 0.0
    power = np.abs(librosa.stft(audio, n_fft=2048, hop_length=512)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = power[(freqs >= fmin) & (freqs <= fmax)]
    energy = band.sum(axis=0)
    active = energy > energy.max() * 1e-6
    if not active.any():
        return 0.0
    band = np.maximum(band[:, active], 1e-12)
    flatness = np.exp(np.mean(np.log(band), axis=0)) / np.mean(band, axis=0)
    return round(float(np.median(flatness)), 4)


def quality_signals(audio, sr, target_samples, recording_seconds):
    """Signals for the quality gate, measured on the analysed window before padding and normalisation."""
    return {
        'recording_seconds': round(recording_seconds, 2),
        'padded_fraction': round(max(0.0, 1 - len(audio) / target_samples), 3),
        'rms_dbfs': _dbfs(np.sqrt(np.mean(audio ** 2))) if len(audio) else _dbfs(0),
        'peak_dbfs': _dbfs(np.max(np.abs(audio))) if len(audio) else _dbfs(0),
        'spectral_flatness': _spectral_flatness(audio, sr),
    }


def check_quality(quality):
    """Raise RecordingQualityError if the signals show the recording is not usable."""
    if quality['recording_seconds'] < MIN_RECORDING_SECONDS:
        raise RecordingQualityError(
            f"This recording is too short ({quality['recording_seconds']:.1f} s) — record at least "
            "5 seconds of breathing with the stethoscope on the chest.", 'too_short', quality)
    if quality['rms_dbfs'] < MIN_RMS_DBFS or quality['peak_dbfs'] < MIN_PEAK_DBFS:
        raise RecordingQualityError(
            "This recording is almost silent — record again with the stethoscope on the chest.",
            'silent', quality)
    if quality['spectral_flatness'] > MAX_SPECTRAL_FLATNESS:
        raise RecordingQualityError(
            "This recording sounds like static or background noise, not breath sounds — check the "
            "stethoscope connection and record again in a quiet room.", 'noise', quality)


def load_window(path, target_sr=16000, duration=5.0):
    """Load at target_sr and take the centre `duration` seconds (not yet padded or normalised)."""
    audio, sr = librosa.load(path, sr=target_sr)
    target_samples = int(duration * target_sr)
    recording_seconds = len(audio) / sr
    if len(audio) > target_samples:
        start = (len(audio) - target_samples) // 2
        audio = audio[start:start + target_samples]
    return audio, sr, target_samples, recording_seconds


def analysed_features(path):
    """Load, quality-check and preprocess a recording; returns (76 x 157 features, recording_seconds).

    Raises RecordingQualityError if the recording fails the quality gate.
    """
    audio, sr, target_samples, recording_seconds = load_window(path)

    check_quality(quality_signals(audio, sr, target_samples, recording_seconds))

    if len(audio) < target_samples:
        padding = target_samples - len(audio)
        audio = np.pad(audio, (0, padding), mode='constant')

    if np.max(np.abs(audio)) > 0:
        audio = audio / np.max(np.abs(audio))

    features = extract_features(audio, sr)
    if features is None:
        raise ValueError('Feature extraction failed')
    return features, recording_seconds


def _log_probabilities(feature_sets):
    """Model log-probabilities for one or more 76 x T feature matrices, in a single batched pass."""
    batch = Batch.from_data_list([graph_converter.features_to_graph(f) for f in feature_sets]).to(device)
    with torch.no_grad():
        return model(batch.x, batch.edge_index, batch.batch)


def classify_file(path, explain=False):
    """Run the full inference pipeline on an audio file and return the result dict.

    With explain=True the result also has an 'explanation' (see explain_prediction).
    Raises RecordingQualityError if the recording fails the quality gate.
    """
    started = time.perf_counter()
    features, recording_seconds = analysed_features(path)

    output = _log_probabilities([features])
    probabilities = torch.exp(output[0])
    predicted_idx = output.argmax(dim=1).item()
    confidence = probabilities.max().item()
    predicted_class = label_encoder.inverse_transform([predicted_idx])[0]

    result = {
        'predicted_class': str(predicted_class),
        'confidence': float(confidence),
        'all_probabilities': {
            str(cls): float(probabilities[i])
            for i, cls in enumerate(label_encoder.classes_)
        },
        'recording_seconds': round(recording_seconds, 2),
        'inference_ms': round((time.perf_counter() - started) * 1000, 1),
        'arch': platform.machine(),
    }
    if explain:
        result['explanation'] = explain_prediction(features, predicted_idx, output[0], recording_seconds)
    return result


# --- Explainable AI: occlusion analysis ---
# "What did the model rely on?" Each kind of acoustic information (rows of the 76-feature matrix), and each
# half-second of the 5 s window (columns), is in turn replaced by the values of a typical recording - the
# average over all 1,211 dataset recordings, stored in model/feature_baseline.json - and the model is run
# again. The bigger the drop in the predicted class, the more that part of the input supported the result;
# a rise means it argued against it. This measures this model's behaviour, not medical signs.
# Drops are measured in log-odds so they stay informative when the probability is close to 100%.
FEATURE_GROUPS = [  # (key, label, rows in extract_features' stacking order)
    ('mfcc', 'Timbre (MFCC)', range(0, 13)),
    ('mfcc_delta', 'Change in timbre (ΔMFCC)', range(13, 26)),
    ('mfcc_delta2', 'Rate of timbre change (Δ²MFCC)', range(26, 39)),
    ('spectral_shape', 'Spectral shape (centroid, roll-off, bandwidth)', [39, 40, 48]),
    ('spectral_contrast', 'Spectral contrast (peaks vs. valleys)', range(41, 48)),
    ('zcr', 'Noisiness (zero-crossing rate)', [49]),
    ('chroma', 'Tonal content (chroma)', range(50, 62)),
    ('mel', 'Band energies (mel)', range(62, 75)),
    ('rms', 'Loudness (RMS)', [75]),
]
TIME_SEGMENTS = 10  # 0.5 s each
_feature_baseline = None


def _baseline():
    global _feature_baseline
    if _feature_baseline is None:
        path = Path(os.environ.get('MODEL_DIR', Path(__file__).resolve().parent / 'model')) / 'feature_baseline.json'
        _feature_baseline = np.asarray(json.loads(path.read_text())['mean'], dtype=np.float32)[:, None]
    return _feature_baseline


def _log_odds(log_probs, idx):
    """log(p / (1 - p)) of class idx, computed stably from log-probabilities (rows = variants)."""
    others = torch.cat([log_probs[:, :idx], log_probs[:, idx + 1:]], dim=1)
    return log_probs[:, idx] - torch.logsumexp(others, dim=1)


def explain_prediction(features, predicted_idx, log_probs, recording_seconds):
    started = time.perf_counter()
    baseline = _baseline()
    frames = features.shape[1]
    seconds_per_frame = 5.0 / frames

    variants = []
    for _, _, rows in FEATURE_GROUPS:
        f = features.copy()
        f[list(rows), :] = baseline[list(rows), :]
        variants.append(f)
    bounds = np.linspace(0, frames, TIME_SEGMENTS + 1).round().astype(int).tolist()  # plain ints for JSON
    for a, b in zip(bounds[:-1], bounds[1:]):
        f = features.copy()
        f[:, a:b] = baseline
        variants.append(f)

    occluded = _log_probabilities(variants)
    original = float(_log_odds(log_probs[None, :], predicted_idx)[0])
    drops = (original - _log_odds(occluded, predicted_idx)).tolist()
    probs = torch.exp(occluded[:, predicted_idx]).tolist()

    groups = [
        {'key': key, 'label': label, 'log_odds_drop': round(d, 3), 'probability_without': round(p, 4)}
        for (key, label, _), d, p in zip(FEATURE_GROUPS, drops, probs)
    ]
    analysed = min(recording_seconds, 5.0)
    segments = [
        {
            'start': round(a * seconds_per_frame, 2),
            'end': round(b * seconds_per_frame, 2),
            'log_odds_drop': round(d, 3),
            'probability_without': round(p, 4),
            'padding': bool(a * seconds_per_frame >= analysed),  # beyond the end of a short recording
        }
        for a, b, d, p in zip(bounds[:-1], bounds[1:], drops[len(FEATURE_GROUPS):], probs[len(FEATURE_GROUPS):])
    ]
    return {
        'method': 'occlusion',
        'target': str(label_encoder.classes_[predicted_idx]),
        'feature_groups': groups,
        'time_segments': segments,
        'explain_ms': round((time.perf_counter() - started) * 1000, 1),
    }


def warm_up():
    """Run one prediction on synthetic audio so the first real request is fast.

    The first call through librosa compiles its numba kernels (~15 s on x86_64) and initialises
    lazy imports; doing it at startup moves that cost out of the user's request.
    """
    import soundfile as sf
    started = time.perf_counter()
    rng = np.random.default_rng(0)
    sr = 4000  # same rate as the training recordings, so resampling is exercised too
    t = np.arange(int(sr * 5.0)) / sr
    audio = (0.3 * np.sin(2 * np.pi * 220 * t) + 0.05 * rng.standard_normal(t.size)).astype(np.float32)
    fd, path = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        sf.write(path, audio, sr)
        classify_file(path, explain=True)
    finally:
        os.remove(path)
    print(f"🔥 Warm-up finished in {time.perf_counter() - started:.1f}s")

@app.route('/predict', methods=['POST'])
def predict():
    try:
        if model is None:
            return jsonify({'error': 'Model not loaded'}), 500

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400

        # Save to a unique temp file (never trust the client-supplied filename as a path)
        suffix = Path(file.filename).suffix.lower() or '.wav'
        fd, temp_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        file.save(temp_path)

        try:
            return jsonify(classify_file(temp_path, explain=True))
        except RecordingQualityError as e:
            print(f"Recording refused ({e.reason}): {e.quality}")
            return jsonify({'error': str(e), 'reason': e.reason, 'quality': e.quality}), 422
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    except Exception as e:
        print(f"Prediction error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

def create_app():
    """Entry point for production WSGI servers (e.g. `gunicorn 'predict:create_app()'`)."""
    if not load_model():
        raise RuntimeError("Model could not be loaded - check MODEL_DIR")
    warm_up()
    return app

if __name__ == '__main__':
    print("="*60)
    print("🚀 Starting Python ML Service")
    print("="*60)

    if load_model():
        warm_up()
        app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5001)), debug=False)
    else:
        print("❌ Failed to start service - model not loaded")
        sys.exit(1)
