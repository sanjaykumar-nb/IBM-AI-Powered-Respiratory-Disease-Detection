import { useEffect, useRef, useState } from 'react';

// The backend's public API (backend/server.js), reachable through nginx on this same origin.
const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/health',
    title: 'Gateway health',
    body: 'Answers as long as the API gateway (Express) is running. Used by Docker’s health check.',
    request: { url: '/api/health' },
  },
  {
    method: 'GET',
    path: '/api/status',
    title: 'Model and IBM Z status',
    body: 'Health of the ML service: whether the graph neural network is loaded, the CPU architecture, and the IBM Z hardware it runs on (machine type, vector facility, AI accelerator, CPACF, compression).',
    request: { url: '/api/status' },
  },
  {
    method: 'GET',
    path: '/api/history',
    title: 'Screening history (IBM Db2)',
    body: 'Recent screenings and totals stored in IBM Db2: results, refusal rate, inference time. Results only — recordings are never stored. Add ?limit=N for more rows.',
    request: { url: '/api/history?limit=5' },
  },
  {
    method: 'POST',
    path: '/api/upload',
    title: 'Screen a recording',
    body: 'Multipart form with an "audio" WAV file. Returns the class probabilities, the inference time and the explanation (which sound information the result relied on). Silent, too-short or noise-only audio gets HTTP 422 with the reason.',
    request: { upload: '/samples/copd.wav', label: 'Send the COPD example recording' },
    note: 'Sending it runs a real screening, which is also recorded in the History.',
    curl: 'curl -F "audio=@recording.wav" http://<server>/api/upload',
  },
  {
    method: 'POST',
    path: '/api/whatsapp',
    title: 'WhatsApp webhook (Twilio)',
    body: 'Called by Twilio when someone sends a voice note to the WhatsApp number. Downloads the audio from MediaUrl0, screens it and replies with the result as TwiML. It needs a Twilio request, so it can’t be tried from here.',
    curl: 'curl -d NumMedia=1 -d MediaUrl0=<public URL of a WAV> -d MediaContentType0=audio/wav -d From=whatsapp:+123 http://<server>/api/whatsapp',
  },
];

function Response({ result }) {
  if (!result) return null;
  if (result.state === 'loading') return <p className="api__meta">Sending request…</p>;
  if (result.state === 'failed') return <p className="api__meta api__meta--bad">Request failed: {result.message}</p>;
  return (
    <>
      <p className={`api__meta${result.status >= 400 ? ' api__meta--bad' : ''}`}>
        HTTP {result.status} · {Math.round(result.ms)} ms
      </p>
      <pre className="api__json">{result.text}</pre>
    </>
  );
}

function EndpointDialog({ endpoint, onClose }) {
  const ref = useRef(null);
  const [result, setResult] = useState(null);

  const send = async () => {
    setResult({ state: 'loading' });
    const started = performance.now();
    try {
      let res;
      if (endpoint.request.upload) {
        const blob = await (await fetch(endpoint.request.upload)).blob();
        const body = new FormData();
        body.append('audio', new File([blob], 'copd-example.wav', { type: 'audio/wav' }));
        res = await fetch(endpoint.path, { method: 'POST', body });
      } else {
        res = await fetch(endpoint.request.url);
      }
      const raw = await res.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* not JSON: show as is */
      }
      setResult({ state: 'done', status: res.status, ms: performance.now() - started, text });
    } catch (e) {
      setResult({ state: 'failed', message: e.message });
    }
  };

  useEffect(() => {
    ref.current?.showModal();
    if (endpoint.request?.url) send(); // GET endpoints are safe to call straight away
  }, []);

  return (
    <dialog ref={ref} className="api__dialog" onClose={onClose} aria-labelledby="api-title">
      <div className="api__head">
        <p className="api__line">
          <span className={`api__method api__method--${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
          <code>{endpoint.path}</code>
        </p>
        <button type="button" className="api__close" onClick={() => ref.current?.close()} aria-label="Close">
          ×
        </button>
      </div>
      <h2 id="api-title" className="api__title">
        {endpoint.title}
      </h2>
      <p className="api__body">{endpoint.body}</p>
      {endpoint.curl && <pre className="api__curl">{endpoint.curl}</pre>}

      {endpoint.request && (
        <div className="actions">
          <button type="button" className="button button--primary" onClick={send} disabled={result?.state === 'loading'}>
            {endpoint.request.label || (result ? 'Send again' : 'Send request')}
          </button>
        </div>
      )}
      {endpoint.note && <p className="api__note">{endpoint.note}</p>}
      <Response result={result} />
    </dialog>
  );
}

/** Second navbar row: one button per API endpoint, each opening a panel with a live response. */
export default function ApiBar() {
  const [open, setOpen] = useState(null);
  return (
    <div className="api">
      <div className="api__inner">
        <span className="api__label">API</span>
        <ul className="api__list">
          {ENDPOINTS.map((e) => (
            <li key={e.path}>
              <button type="button" className="api__button" onClick={() => setOpen(e)} title={e.title}>
                <span className={`api__method api__method--${e.method.toLowerCase()}`}>{e.method}</span>
                {e.path}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {open && <EndpointDialog key={open.path} endpoint={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
