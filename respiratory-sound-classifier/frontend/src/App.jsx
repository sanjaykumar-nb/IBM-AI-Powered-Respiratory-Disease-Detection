import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import RecordingPanel from './components/RecordingPanel.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import Method from './components/Method.jsx';
import Platform from './components/Platform.jsx';
import History from './components/History.jsx';
import Footer from './components/Footer.jsx';
import { analyseRecording, fetchStatus } from './lib/api.js';
import { inspectRecording } from './lib/audio.js';
import { MAX_UPLOAD_BYTES } from './lib/config.js';

export default function App() {
  const [server, setServer] = useState({ state: 'checking' });
  const [file, setFile] = useState(null);
  const [recording, setRecording] = useState(null); // decoded preview, or { error }
  const [analysis, setAnalysis] = useState({ state: 'idle' });
  const [screened, setScreened] = useState(0); // finished uploads, so the History section reloads
  const runId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      fetchStatus()
        .then((s) => !cancelled && setServer({ state: s.model?.model_loaded ? 'online' : 'offline', arch: s.model?.arch, ibmZ: s.model?.ibm_z, watsonx: s.watsonx }))
        .catch(() => !cancelled && setServer({ state: 'offline' }));
    poll();
    const id = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const start = useCallback(async (selected) => {
    if (!selected.name.toLowerCase().endsWith('.wav')) {
      setAnalysis({ state: 'error', message: 'Please choose a WAV recording (.wav).' });
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setAnalysis({ state: 'error', message: 'This file is larger than the 50 MB limit.' });
      return;
    }
    const id = ++runId.current;
    setFile(selected);
    setRecording(null);
    setAnalysis({ state: 'analysing' });

    inspectRecording(selected)
      .then((r) => id === runId.current && setRecording(r))
      .catch(() => id === runId.current && setRecording({ error: true, name: selected.name, sizeBytes: selected.size }));

    try {
      const result = await analyseRecording(selected);
      if (id === runId.current) setAnalysis({ state: 'done', result, finishedAt: new Date() });
    } catch (e) {
      if (id === runId.current) setAnalysis({ state: 'error', message: e.message, refused: e.refused });
    }
    setScreened((n) => n + 1);
  }, []);

  const reset = () => {
    runId.current++;
    setFile(null);
    setRecording(null);
    setAnalysis({ state: 'idle' });
  };

  return (
    <>
      <Header server={server} />
      <main id="screening" className="page">
        <section className="intro">
          <p className="eyebrow">Screening</p>
          <h1>Listen to a lung recording, get a screening read‑out in seconds.</h1>
          <p className="lede">
            Upload an auscultation recording. A graph neural network compares its acoustic signature against
            five classes — healthy, asthma, COPD, pneumonia and bronchial — and reports how strongly it matches each.
          </p>
        </section>

        <div className="workspace">
          <RecordingPanel
            file={file}
            recording={recording}
            busy={analysis.state === 'analysing'}
            onSelect={start}
            onReset={reset}
          />
          <ResultPanel analysis={analysis} recording={recording} file={file} explain={Boolean(server.watsonx?.enabled)} onRetry={() => file && start(file)} onReset={reset} />
        </div>
      </main>
      <Method arch={server.arch} />
      <Platform server={server} />
      <History refreshKey={screened} serverArch={server.arch} />
      <Footer server={server} />
    </>
  );
}
