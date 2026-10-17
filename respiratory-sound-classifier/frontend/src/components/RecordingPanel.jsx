import { useRef, useState } from 'react';
import RecordingView from './RecordingView.jsx';
import { SAMPLES } from '../lib/config.js';

export default function RecordingPanel({ file, recording, busy, onSelect, onReset }) {
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
    <section className="panel" aria-labelledby="recording-title">
      <header className="panel__head">
        <span className="panel__step">01</span>
        <h2 id="recording-title">Recording</h2>
        {file && (
          <button type="button" className="link-button" onClick={onReset} disabled={busy}>
            Choose another
          </button>
        )}
      </header>

      {!file ? (
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
            <svg className="dropzone__icon" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M4 24h6l3-8 5 18 4-14 3 6 3-10 4 16 3-8h9" />
            </svg>
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
      ) : (
        <RecordingView file={file} recording={recording} />
      )}
    </section>
  );
}
