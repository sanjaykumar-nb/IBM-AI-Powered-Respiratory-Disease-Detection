import { CONDITIONS, confidenceBand } from '../lib/config.js';

const STEPS = [
  'Resample to 16 kHz and take the centre 5 seconds',
  'Extract 76 acoustic features for each of 157 frames',
  'Link similar frames into a graph',
  'Classify the graph with the neural network',
];

function pct(p, digits = 1) {
  if (p > 0 && p < 0.001) return '<0.1%';
  return `${(p * 100).toFixed(digits)}%`;
}

function Idle() {
  return (
    <div className="result-empty">
      <p className="result-empty__title">No recording analysed yet</p>
      <p className="muted">When you add a recording, the screening runs automatically:</p>
      <ol className="steps">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function Analysing() {
  return (
    <div className="result-empty" aria-busy="true">
      <div className="progress" role="progressbar" aria-label="Analysing recording">
        <span />
      </div>
      <p className="result-empty__title">Analysing recording…</p>
      <ol className="steps steps--running">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function Failed({ message, refused, onRetry, onReset, canRetry }) {
  return (
    <div className="result-empty result-error" role="alert">
      <p className="result-empty__title">
        {refused ? 'This recording cannot be screened' : 'The recording could not be analysed'}
      </p>
      <p>{message}</p>
      <div className="actions">
        {canRetry && (
          <button type="button" className="button button--primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="button" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}

function Report({ result, finishedAt, file, onReset }) {
  const ranked = Object.entries(result.all_probabilities).sort((a, b) => b[1] - a[1]);
  const top = result.predicted_class;
  const band = confidenceBand(result.confidence);
  const info = CONDITIONS[top] ?? { color: '#17191c', summary: '' };
  const runnerUp = ranked[1];

  return (
    <div className="report">
      <div className="report__meta">
        <span>Screening report</span>
        <time dateTime={finishedAt.toISOString()}>
          {finishedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      </div>

      <div className="finding">
        <p className="finding__label">Closest match</p>
        <div className="finding__row">
          <h3 className="finding__class">
            <span className="swatch swatch--lg" style={{ background: info.color }} aria-hidden="true" />
            {top}
          </h3>
          <p className="finding__score">{pct(result.confidence)}</p>
        </div>
        <p className={`badge badge--${band.tone}`}>{band.label}</p>
        <p className="finding__summary">{info.summary}</p>
        {band.tone !== 'ok' && runnerUp && (
          <p className="callout">
            The model is not confident: <strong>{runnerUp[0]}</strong> is also plausible ({pct(runnerUp[1])}). Consider
            re-recording in a quiet room with the stethoscope held still.
          </p>
        )}
      </div>

      <table className="probs">
        <caption className="visually-hidden">Match strength for each class</caption>
        <thead>
          <tr>
            <th scope="col">Class</th>
            <th scope="col" className="probs__barcol">
              <span className="visually-hidden">Bar</span>
            </th>
            <th scope="col" className="num">Match</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(([name, p]) => (
            <tr key={name} className={name === top ? 'is-top' : undefined}>
              <th scope="row">
                <span className="swatch" style={{ background: CONDITIONS[name]?.color }} aria-hidden="true" />
                {name}
              </th>
              <td className="probs__barcol">
                <div className="bar">
                  <span style={{ width: `${Math.max(p * 100, 0.4)}%` }} />
                </div>
              </td>
              <td className="num">{pct(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="details">
        <div>
          <dt>Recording</dt>
          <dd title={file?.name}>{file?.name}</dd>
        </div>
        {result.recording_seconds != null && (
          <div>
            <dt>Analysed</dt>
            <dd>{Math.min(result.recording_seconds, 5).toFixed(1)} s of {result.recording_seconds.toFixed(1)} s</dd>
          </div>
        )}
        {result.inference_ms != null && (
          <div>
            <dt>Processing</dt>
            <dd>{result.inference_ms < 1000 ? `${Math.round(result.inference_ms)} ms` : `${(result.inference_ms / 1000).toFixed(1)} s`}</dd>
          </div>
        )}
        {result.arch && (
          <div>
            <dt>Server</dt>
            <dd>{result.arch === 's390x' ? 'IBM LinuxONE (s390x)' : result.arch}</dd>
          </div>
        )}
      </dl>

      <p className="disclaimer">
        Screening aid for research and education. This is not a diagnosis — a clinician should interpret the recording
        together with symptoms and examination.
      </p>

      <div className="actions no-print">
        <button type="button" className="button button--primary" onClick={onReset}>
          New screening
        </button>
        <button type="button" className="button" onClick={() => window.print()}>
          Print report
        </button>
      </div>
    </div>
  );
}

export default function ResultPanel({ analysis, file, onRetry, onReset }) {
  return (
    <section className="panel panel--result" aria-labelledby="result-title" aria-live="polite">
      <header className="panel__head">
        <span className="panel__step">02</span>
        <h2 id="result-title">Result</h2>
      </header>
      {analysis.state === 'idle' && <Idle />}
      {analysis.state === 'analysing' && <Analysing />}
      {analysis.state === 'error' && (
        <Failed
          message={analysis.message}
          refused={analysis.refused}
          onRetry={onRetry}
          onReset={onReset}
          canRetry={Boolean(file) && !analysis.refused}
        />
      )}
      {analysis.state === 'done' && (
        <Report result={analysis.result} finishedAt={analysis.finishedAt} file={file} onReset={onReset} />
      )}
    </section>
  );
}
