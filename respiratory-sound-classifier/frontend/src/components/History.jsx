// Screening audit trail: every result (never the audio) as stored in IBM Db2 by the API gateway.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHistory } from '../lib/api.js';
import { CONDITIONS } from '../lib/config.js';

const CHANNELS = { web: 'Upload', whatsapp: 'WhatsApp' };
const REASONS = { silent: 'silent', too_short: 'too short', noise: 'noise' };
const POLL_MS = 30000;
const MIN_REFRESH_MS = 3000;

const pct = (p, digits = 0) => (p == null ? '—' : `${(p * 100).toFixed(digits)}%`);
const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

function when(iso) {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Result({ row }) {
  if (row.status === 'ok') {
    return (
      <span className="log__class">
        <span className="swatch" style={{ background: CONDITIONS[row.predicted_class]?.color }} aria-hidden="true" />
        {row.predicted_class}
      </span>
    );
  }
  if (row.status === 'refused') {
    return <span className="log__flag log__flag--warn">Refused · {REASONS[row.refusal_reason] || row.refusal_reason || 'quality'}</span>;
  }
  return <span className="log__flag log__flag--alert">Error</span>;
}

/** refreshKey changes after each screening in this browser, so the new row shows up without waiting for the poll. */
export default function History({ refreshKey, serverArch }) {
  const [history, setHistory] = useState({ state: 'loading' });
  const lastLoad = useRef(0);

  const load = useCallback(() => {
    lastLoad.current = Date.now();
    return fetchHistory(50).then(
      (data) => setHistory({ state: 'ready', data, at: new Date() }),
      (e) => setHistory((h) => ({ state: 'unavailable', message: e.message, data: h.data, at: h.at })),
    );
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The gateway writes to Db2 after it has answered, so reload a moment after each screening
  useEffect(() => {
    if (!refreshKey) return undefined;
    const t = setTimeout(load, Math.max(800, lastLoad.current + MIN_REFRESH_MS - Date.now()));
    return () => clearTimeout(t);
  }, [refreshKey, load]);

  const { data } = history;
  const arch = data?.database?.arch || serverArch;
  const classMax = data ? Math.max(1, ...Object.values(data.by_class)) : 1;

  return (
    <section id="history" className="history">
      <div className="page">
        <p className="eyebrow">History</p>
        <div className="history__head">
          <h2 className="method__title">Screening audit trail</h2>
          <span className="badge badge--neutral">Stored in IBM Db2{arch ? ` on ${arch}` : ''}</span>
        </div>
        <p className="history__lede">
          Every screening — web uploads and WhatsApp — is recorded with its result, the quality checks and
          the inference time. Only results are stored: recordings are deleted as soon as they have been analysed.
        </p>

        {history.state === 'loading' && <p className="history__empty">Loading history from IBM Db2…</p>}
        {history.state === 'unavailable' && (
          <p className="callout">
            {history.message} Screening keeps working; results are not recorded until the database is back
            {data ? ' — the figures below are from the last successful read.' : '.'}
          </p>
        )}

        {data && (
          <>
            <dl className="details history__stats">
              <div>
                <dt>Screenings</dt>
                <dd>{data.total.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Refused</dt>
                <dd>
                  {pct(data.refusal_rate, 1)}
                  <span className="history__sub"> ({data.refused})</span>
                </dd>
              </div>
              <div>
                <dt>Median inference</dt>
                <dd>{ms(data.latency.median_ms)}</dd>
              </div>
              <div>
                <dt>p95 inference</dt>
                <dd>{ms(data.latency.p95_ms)}</dd>
              </div>
            </dl>

            <div className="history__grid">
              <div>
                <h3 className="history__h3">Results by class</h3>
                <table className="probs history__table">
                  <caption className="visually-hidden">Number of screenings per predicted class</caption>
                  <tbody>
                    {Object.entries(data.by_class).map(([name, n]) => (
                      <tr key={name}>
                        <th scope="row">
                          <span className="swatch" style={{ background: CONDITIONS[name]?.color }} aria-hidden="true" />
                          {name}
                        </th>
                        <td className="probs__barcol">
                          <div className="bar">
                            <span style={{ width: `${n ? Math.max((n / classMax) * 100, 1) : 0}%`, background: CONDITIONS[name]?.color }} />
                          </div>
                        </td>
                        <td className="num">{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="history__h3">By channel</h3>
                <table className="probs history__table">
                  <caption className="visually-hidden">Screenings and refusals per channel</caption>
                  <thead>
                    <tr>
                      <th scope="col">Channel</th>
                      <th scope="col" className="num">Screenings</th>
                      <th scope="col" className="num">Refused</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.by_channel).map(([ch, c]) => (
                      <tr key={ch}>
                        <th scope="row">{CHANNELS[ch] || ch}</th>
                        <td className="num">{c.count}</td>
                        <td className="num">{c.count ? pct(c.refused / c.count) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <h3 className="history__h3">Last {Math.min(50, data.recent.length) || ''} screenings</h3>
            {data.recent.length ? (
              <div className="log__scroll">
                <table className="log">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Channel</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="num">Match</th>
                      <th scope="col" className="num log__opt">Length</th>
                      <th scope="col" className="num log__opt">Inference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="log__time">
                          <time dateTime={r.created_at}>{when(r.created_at)}</time>
                        </td>
                        <td>{CHANNELS[r.channel] || r.channel}</td>
                        <td>
                          <Result row={r} />
                        </td>
                        <td className="num">{r.status === 'ok' ? pct(r.confidence, 1) : '—'}</td>
                        <td className="num log__opt">{r.recording_seconds == null ? '—' : `${r.recording_seconds.toFixed(1)} s`}</td>
                        <td className="num log__opt">{ms(r.inference_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="history__empty">No screenings recorded yet. Analyse a recording above and it appears here.</p>
            )}

            <p className="platform__note">
              Read from {data.database.version || 'IBM Db2'}
              {data.database.name ? `, database ${data.database.name}` : ''}
              {history.at ? ` · updated ${history.at.toLocaleTimeString()}` : ''}. Times are shown in your local time zone.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
