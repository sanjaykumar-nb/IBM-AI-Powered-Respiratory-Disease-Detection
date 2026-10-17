import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../lib/audio.js';

const ANALYSED_SECONDS = 5;
const PAPER = [245, 243, 238];
const TEAL = [14, 94, 90];
const INK = [16, 32, 31];

function ramp(t) {
  // paper -> teal -> ink, eased so quiet regions stay light
  const x = Math.pow(t, 1.6);
  const [a, b, k] = x < 0.6 ? [PAPER, TEAL, x / 0.6] : [TEAL, INK, (x - 0.6) / 0.4];
  return a.map((v, i) => Math.round(v + (b[i] - v) * k));
}

function useCanvasSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function prepare(canvas, { w, h }) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function Waveform({ samples, scale, duration }) {
  const ref = useRef(null);
  const size = useCanvasSize(ref);
  useEffect(() => {
    if (!size.w) return;
    const ctx = prepare(ref.current, size);
    const { w, h } = size;
    // Shade the centre window the model actually analyses
    if (duration > ANALYSED_SECONDS) {
      const x0 = ((duration - ANALYSED_SECONDS) / 2 / duration) * w;
      ctx.fillStyle = 'rgba(14, 94, 90, 0.07)';
      ctx.fillRect(x0, 0, (ANALYSED_SECONDS / duration) * w, h);
    }
    ctx.strokeStyle = 'rgba(23, 25, 28, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    const half = h / 2 - 2;
    const per = samples.length / w;
    ctx.fillStyle = '#17191c';
    for (let x = 0; x < w; x++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(samples.length, Math.floor((x + 1) * per));
      for (let i = Math.floor(x * per); i < end; i++) {
        if (samples[i] < lo) lo = samples[i];
        if (samples[i] > hi) hi = samples[i];
      }
      const y0 = h / 2 - Math.min(1, hi / scale) * half;
      const y1 = h / 2 - Math.max(-1, lo / scale) * half;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }, [samples, scale, duration, size]);
  return <canvas ref={ref} className="viz__canvas viz__canvas--wave" aria-label="Waveform" role="img" />;
}

function Spectrogram({ spec }) {
  const ref = useRef(null);
  const size = useCanvasSize(ref);
  const image = useMemo(() => {
    const off = document.createElement('canvas');
    off.width = spec.frames;
    off.height = spec.bins;
    const ctx = off.getContext('2d');
    const img = ctx.createImageData(spec.frames, spec.bins);
    for (let f = 0; f < spec.frames; f++) {
      for (let b = 0; b < spec.bins; b++) {
        const [r, g, bl] = ramp(spec.data[f * spec.bins + b]);
        const o = ((spec.bins - 1 - b) * spec.frames + f) * 4; // low frequencies at the bottom
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = bl;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return off;
  }, [spec]);

  useEffect(() => {
    if (!size.w) return;
    const ctx = prepare(ref.current, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, size.w, size.h);
  }, [image, size]);

  return <canvas ref={ref} className="viz__canvas viz__canvas--spec" aria-label="Spectrogram" role="img" />;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export default function RecordingView({ file, recording }) {
  const audioRef = useRef(null);
  const [url, setUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setPlaying(false);
    setTime(0);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = () => {
      setTime(audioRef.current?.currentTime ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  };

  const duration = recording?.duration ?? 0;
  const ready = recording && !recording.error;

  return (
    <div className="recording">
      <dl className="meta">
        <div>
          <dt>File</dt>
          <dd className="meta__file" title={file.name}>{file.name}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd>{ready ? `${duration.toFixed(1)} s` : '—'}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{ready && recording.sampleRate ? `${(recording.sampleRate / 1000).toFixed(1)} kHz` : '—'}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
      </dl>

      {!recording && <div className="viz viz--loading">Decoding audio…</div>}
      {recording?.error && <div className="viz viz--loading">Preview unavailable for this file — it can still be analysed.</div>}

      {ready && (
        <div className="viz">
          <div className="viz__track">
            <span className="viz__label">Waveform</span>
            <Waveform samples={recording.samples} scale={recording.waveformScale} duration={duration} />
            {duration > 0 && <div className="viz__playhead" style={{ left: `${(time / duration) * 100}%` }} />}
          </div>
          <div className="viz__track">
            <span className="viz__label">Spectrogram · 0–{recording.spectrogram.maxFreq / 1000} kHz</span>
            <Spectrogram spec={recording.spectrogram} />
            {duration > 0 && <div className="viz__playhead" style={{ left: `${(time / duration) * 100}%` }} />}
          </div>
          {duration > ANALYSED_SECONDS && (
            <p className="viz__note">
              <span className="viz__swatch" aria-hidden="true" /> Shaded: the centre {ANALYSED_SECONDS} s the model analyses
            </p>
          )}
        </div>
      )}

      <div className="player">
        <button type="button" className="button button--icon" onClick={toggle} aria-label={playing ? 'Pause' : 'Play recording'}>
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" /></svg>
          )}
        </button>
        <span className="player__time">
          {fmtTime(time)} <span className="muted">/ {fmtTime(duration)}</span>
        </span>
        {url && (
          <audio
            ref={audioRef}
            src={url}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setTime(0);
            }}
          />
        )}
      </div>
    </div>
  );
}
