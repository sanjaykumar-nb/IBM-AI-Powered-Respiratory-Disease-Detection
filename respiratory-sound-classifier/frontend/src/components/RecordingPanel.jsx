import { useRef, useState } from 'react';
import RecordingView from './RecordingView.jsx';
import LiveView from './LiveView.jsx';
import { SAMPLES } from '../lib/config.js';
import { microphoneProblem } from '../lib/live.js';

const WAVE_ICON = (
  <svg className="dropzone__icon" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M4 24h6l3-8 5 18 4-14 3 6 3-10 4 16 3-8h9" />
  </svg>
);

function UploadPicker({ onSelect }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState(null);

  const pick = (files) => files && files[0] && onSelect(files[0]);

  const loadSample = async (sample) => {
    setLoadingSample(sample.file);
    try {
      const blob = await (await fetch(`/samples/${sample.file}`)).blob();
      onSelect(new File([blob], `sample-${sample.file}`, { type: 'audio/wav' }));
    } finally {
      setLoadingSample(null);
    }
  };

  return (
    <>
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
      >
        {WAVE_ICON}
        <p className="dropzone__title">Drop a lung sound recording here</p>
        <p className="dropzone__hint">WAV format · up to 50 MB · the centre 5 seconds are analysed</p>
        <button type="button" className="button button--primary" onClick={() => inputRef.current?.click()}>
          Choose file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          className="visually-hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="samples">
        <p className="samples__label">Or try an example recording from the training dataset</p>
        <div className="samples__list">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              className="chip"
              onClick={() => loadSample(s)}
              disabled={loadingSample !== null}
            >
              {loadingSample === s.file ? 'Loading…' : s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function LiveStart({ live, onLive }) {
  const micProblem = microphoneProblem();
  return (
    <>
      <div className="dropzone">
        {WAVE_ICON}
        <p className="dropzone__title">Screen in real time</p>
        <p className="dropzone__hint">
          Connect a digital stethoscope (or use the microphone) and place it on the chest. The latest 5 seconds are
          screened continuously.
        </p>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onLive({ kind: 'mic' })}
          disabled={Boolean(micProblem)}
        >
          Start listening
        </button>
        {micProblem && <p className="live-note">{micProblem}</p>}
        {live.state === 'error' && <p className="live-note live-note--alert">{live.message}</p>}
      </div>

      <div className="samples">
        <p className="samples__label">No stethoscope? Simulate one by playing an example recording into live mode</p>
        <div className="samples__list">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              className="chip"
              onClick={() =>
                onLive({ kind: 'sample', url: `/samples/${s.file}`, label: `Simulated stethoscope · ${s.label} example` })
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function RecordingPanel({ file, recording, busy, live, onSelect, onReset, onLive, onStopLive }) {
  const [mode, setMode] = useState('upload');
  const listening = live.state === 'on' || live.state === 'starting';

  let body;
  if (listening) body = <LiveView live={live} onStop={onStopLive} />;
  else if (file) body = <RecordingView file={file} recording={recording} />;
  else {
    body = (
      <>
        <div className="tabs" role="tablist" aria-label="How to screen">
          <button type="button" role="tab" aria-selected={mode === 'upload'} className="tabs__tab" onClick={() => setMode('upload')}>
            Upload a recording
          </button>
          <button type="button" role="tab" aria-selected={mode === 'live'} className="tabs__tab" onClick={() => setMode('live')}>
            <span className="live__dot" aria-hidden="true" /> Listen live
          </button>
        </div>
        {mode === 'live' ? <LiveStart live={live} onLive={onLive} /> : <UploadPicker onSelect={onSelect} />}
      </>
    );
  }

  return (
    <section className="panel" aria-labelledby="recording-title">
      <header className="panel__head">
        <span className="panel__step">01</span>
        <h2 id="recording-title">Recording</h2>
        {file && !listening && (
          <button type="button" className="link-button" onClick={onReset} disabled={busy}>
            Choose another
          </button>
        )}
      </header>
      {body}
    </section>
  );
}
