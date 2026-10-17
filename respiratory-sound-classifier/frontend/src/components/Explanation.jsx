import { useEffect, useState } from 'react';
import { explainResult } from '../lib/api.js';

const LANGUAGES = [
  ['en', 'English'],
  ['ta', 'தமிழ்'],
  ['hi', 'हिन्दी'],
];

/** IBM Granite's plain-language explanation of a result; renders nothing if watsonx.ai is unavailable. */
export default function Explanation({ result }) {
  const [language, setLanguage] = useState('en');
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    explainResult(result, language).then((e) => !cancelled && setState(e ? { status: 'done', ...e } : { status: 'none' }));
    return () => {
      cancelled = true;
    };
  }, [result, language]);

  if (state.status === 'none') return null;

  return (
    <section className="explain" aria-live="polite" aria-busy={state.status === 'loading'}>
      <div className="explain__head">
        <p className="finding__label">In plain words</p>
        <div className="explain__langs no-print" role="group" aria-label="Explanation language">
          {LANGUAGES.map(([code, name]) => (
            <button
              key={code}
              type="button"
              className={`explain__lang${code === language ? ' is-active' : ''}`}
              aria-pressed={code === language}
              onClick={() => setLanguage(code)}
              disabled={state.status === 'loading'}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      {state.status === 'loading' ? (
        <p className="explain__text muted">IBM Granite is writing a plain-language summary…</p>
      ) : (
        <p className="explain__text" lang={state.language}>
          {state.text}
        </p>
      )}
      <p className="explain__source">Explained by IBM Granite on watsonx.ai · only the result is sent, never the recording</p>
    </section>
  );
}
