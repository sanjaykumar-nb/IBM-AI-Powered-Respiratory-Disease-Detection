import { useEffect, useRef } from 'react';
import { prepare, useCanvasSize } from './RecordingView.jsx';
import { WINDOW_SECONDS } from '../lib/live.js';
import { UPDATE_EVERY_MS } from '../lib/useLiveScreening.js';

const FLOOR_DB = -80;

/** Rolling view of the last 5 s of live audio, redrawn ~20 times a second outside React. */
export default function LiveView({ live, onStop }) {
  const canvasRef = useRef(null);
  const meterRef = useRef(null);
  const levelRef = useRef(null);
  const timeRef = useRef(null);
  const size = useCanvasSize(canvasRef);
  const cap = live.capture;

  useEffect(() => {
    if (!cap || !size.w) return undefined;
    let raf;
    let lastDraw = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 50) return;
      lastDraw = now;

      const samples = cap.window();
      const seconds = cap.seconds();
      const ctx = prepare(canvasRef.current, size);
      const { w, h } = size;
      // Fixed time axis: the window fills from the left until 5 s have been captured
      const span = Math.round(cap.sampleRate * WINDOW_SECONDS);
      const x0 = Math.round(((span - samples.length) / span) * w);
      let peak = 0.02; // never amplify near-silence into a full-height trace
      for (let i = 0; i < samples.length; i += 8) peak = Math.max(peak, Math.abs(samples[i]));
      ctx.strokeStyle = 'rgba(23, 25, 28, 0.15)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.fillStyle = '#0e5e5a';
      const per = span / w;
      for (let x = x0; x < w; x++) {
        const a = Math.floor((x - x0) * per);
        const b = Math.min(samples.length, Math.floor((x - x0 + 1) * per));
        let lo = 0;
        let hi = 0;
        for (let i = a; i < b; i++) {
          if (samples[i] < lo) lo = samples[i];
          if (samples[i] > hi) hi = samples[i];
        }
        const y1 = h / 2 - (hi / peak) * (h / 2 - 2);
        const y2 = h / 2 - (lo / peak) * (h / 2 - 2);
        ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }

      const db = cap.level();
      meterRef.current.style.width = `${Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) * 100}%`;
      levelRef.current.textContent = db < FLOOR_DB ? 'silent' : `${db.toFixed(0)} dBFS`;
      timeRef.current.textContent =
        seconds < WINDOW_SECONDS
          ? `filling the first ${WINDOW_SECONDS} s window · ${seconds.toFixed(1)} s`
          : `listening for ${seconds.toFixed(0)} s`;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cap, size]);

  return (
    <div className="live">
      <div className="live__head">
        <span className="live__dot" aria-hidden="true" />
        <span className="live__title">{live.state === 'starting' ? 'Starting…' : 'Listening live'}</span>
        <span className="live__source" title={live.label}>
          {live.label}
        </span>
      </div>

      <div className="viz">
        <div className="viz__track">
          <span className="viz__label">Last {WINDOW_SECONDS} seconds</span>
          <canvas ref={canvasRef} className="viz__canvas live__wave" aria-label="Live waveform" role="img" />
        </div>
      </div>

      <div className="live__meter" aria-hidden="true">
        <span ref={meterRef} />
      </div>
      <p className="live__status">
        <span ref={timeRef}>starting…</span>
        <span ref={levelRef} />
      </p>
      <p className="muted live__hint">
        The latest {WINDOW_SECONDS} seconds are screened every {UPDATE_EVERY_MS / 1000} s. Stop to keep the latest result as a
        report.
      </p>

      <div className="actions">
        <button type="button" className="button button--primary" onClick={onStop} disabled={live.state !== 'on'}>
          Stop listening
        </button>
      </div>
    </div>
  );
}
