import { CONDITIONS, confidenceBand } from '../lib/config.js';
import { WINDOW_SECONDS } from '../lib/live.js';
import { UPDATE_EVERY_MS } from '../lib/useLiveScreening.js';
import { ProbabilityTable, pct } from './ResultPanel.jsx';

function ms(v) {
  return v == null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

function Timeline({ history }) {
  return (
    <ol className="timeline" aria-label="Recent results, oldest first">
      {history.map((e) => {
        const name = e.ok ? e.result.predicted_class : null;
        const label = e.ok ? `${name} ${pct(e.result.confidence, 0)}` : e.refused ? 'No usable signal' : 'Error';
        return (
          <li
            key={e.at.getTime()}
            className={`timeline__item${e.ok ? '' : ' timeline__item--empty'}`}
            style={e.ok ? { background: CONDITIONS[name]?.color, opacity: 0.35 + 0.65 * e.result.confidence } : undefined}
            title={`${e.at.toLocaleTimeString()} · ${label}`}
          >
            <span className="visually-hidden">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Result panel while listening live: the latest window's screening, updated as results arrive. */
export default function LiveResult({ live }) {
  const latest = live.history[live.history.length - 1];
  const lastOk = [...live.history].reverse().find((e) => e.ok);

  if (live.state === 'starting' || !latest) {
    return (
      <div className="result-empty" aria-busy="true">
        <div className="progress" role="progressbar" aria-label="Listening">
          <span />
        </div>
        <p className="result-empty__title">{live.state === 'starting' ? 'Starting…' : 'Listening…'}</p>
        <p className="muted">
          The first result appears once {WINDOW_SECONDS} seconds have been captured, then updates every{' '}
          {UPDATE_EVERY_MS / 1000} s.
        </p>
      </div>
    );
  }

  const result = latest.ok ? latest.result : null;
  const band = result && confidenceBand(result.confidence);
  const info = result && (CONDITIONS[result.predicted_class] ?? { color: '#17191c', summary: '' });

  return (
    <div className="report report--live">
      <div className="report__meta">
        <span className="live__badge">
          <span className="live__dot" aria-hidden="true" /> Live screening
        </span>
        <time dateTime={latest.at.toISOString()}>{latest.at.toLocaleTimeString()}</time>
      </div>

      {result ? (
        <div className="finding">
          <p className="finding__label">Current match · last {WINDOW_SECONDS} s</p>
          <div className="finding__row">
            <h3 className="finding__class">
              <span className="swatch swatch--lg" style={{ background: info.color }} aria-hidden="true" />
              {result.predicted_class}
            </h3>
            <p className="finding__score">{pct(result.confidence)}</p>
          </div>
          <p className={`badge badge--${band.tone}`}>{band.label}</p>
        </div>
      ) : (
        <div className="finding">
          <p className="finding__label">{latest.refused ? 'Waiting for breath sounds' : 'This window could not be screened'}</p>
          <p className="callout">{latest.message}</p>
        </div>
      )}

      {(result || lastOk) && (
        <>
          {!result && <p className="finding__label live__previous">Previous result</p>}
          <ProbabilityTable
            probabilities={(result || lastOk.result).all_probabilities}
            top={(result || lastOk.result).predicted_class}
          />
        </>
      )}

      <div className="live__timeline">
        <p className="finding__label">Last {live.history.length} updates</p>
        <Timeline history={live.history} />
      </div>

      <dl className="details">
        <div>
          <dt>Updates</dt>
          <dd>every {UPDATE_EVERY_MS / 1000} s</dd>
        </div>
        <div>
          <dt>Round trip</dt>
          <dd>{ms(latest.roundTripMs)}</dd>
        </div>
        <div>
          <dt>Inference</dt>
          <dd>{ms((result || lastOk?.result)?.inference_ms)}</dd>
        </div>
        <div>
          <dt>Windows</dt>
          <dd>{live.windows}</dd>
        </div>
        {(result || lastOk?.result)?.arch && (
          <div>
            <dt>Server</dt>
            <dd>{(result || lastOk.result).arch === 's390x' ? 'IBM LinuxONE (s390x)' : (result || lastOk.result).arch}</dd>
          </div>
        )}
      </dl>

      <p className="disclaimer">
        Screening aid for research and education. This is not a diagnosis — a clinician should interpret the recording
        together with symptoms and examination.
      </p>
    </div>
  );
}
