// Client-side decoding and visualisation data for an uploaded recording.

const VIEW_RATE = 8000; // decode at 8 kHz: shows 0–4 kHz, where lung sounds live
const FFT_SIZE = 256;
const HOP = 64;

/** Read sample rate / channels / bit depth straight from a PCM WAV header. */
function readWavHeader(buffer) {
  const v = new DataView(buffer);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      return {
        channels: v.getUint16(offset + 10, true),
        sampleRate: v.getUint32(offset + 12, true),
        bitDepth: v.getUint16(offset + 22, true),
      };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

function percentile(values, q) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Amplitude used to scale the waveform: robust to isolated clicks. */
function waveformScale(samples) {
  const abs = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) abs[i] = Math.abs(samples[i]);
  return Math.max(percentile(abs, 0.998), 1e-6);
}

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Log-magnitude spectrogram, normalised to 0..1 (frames x bins, row-major by frame). */
function spectrogram(samples, maxFreq) {
  // Only show bins the source recording can actually contain (a 4 kHz file has nothing above 2 kHz)
  const bins = Math.max(8, Math.round((maxFreq / (VIEW_RATE / 2)) * (FFT_SIZE / 2)));
  const frames = Math.max(1, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const out = new Float32Array(frames * bins);
  const window = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[f * HOP + i] || 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const db = 10 * Math.log10(re[b] * re[b] + im[b] * im[b] + 1e-12);
      out[f * bins + b] = db;
    }
  }
  // Scale to the 99.5th percentile so a single click or bump doesn't wash out the breath sounds
  const top = percentile(out, 0.995);
  const range = 60;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] - (top - range)) / range));
  return { data: out, frames, bins, maxFreq };
}

/** Decode a File into everything the recording view needs. */
export async function inspectRecording(file) {
  const buffer = await file.arrayBuffer();
  const header = readWavHeader(buffer);
  const ctx = new OfflineAudioContext(1, 1, VIEW_RATE);
  const decoded = await ctx.decodeAudioData(buffer.slice(0));
  const samples = decoded.getChannelData(0);
  const sourceRate = header?.sampleRate ?? VIEW_RATE;
  return {
    name: file.name,
    sizeBytes: file.size,
    duration: decoded.duration,
    sampleRate: header?.sampleRate ?? null,
    channels: header?.channels ?? decoded.numberOfChannels,
    bitDepth: header?.bitDepth ?? null,
    samples,
    waveformScale: waveformScale(samples),
    spectrogram: spectrogram(samples, Math.min(VIEW_RATE, sourceRate) / 2),
  };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
