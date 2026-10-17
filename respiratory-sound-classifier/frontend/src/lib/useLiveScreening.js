import { useCallback, useEffect, useRef, useState } from 'react';
import { analyseRecording } from './api.js';
import { WINDOW_SECONDS, startCapture, toWavFile } from './live.js';

export const UPDATE_EVERY_MS = 1500; // a new 5 s window is screened this often
const HISTORY = 12;

function stamp(d) {
  return d.toTimeString().slice(0, 8).replace(/:/g, '');
}

/**
 * Real-time screening: while listening, the latest 5 s of audio is sent to the model every
 * UPDATE_EVERY_MS (never more than one request at a time). Each result goes into `history`;
 * refused windows (HTTP 422 from the quality gate) are kept too, with the server's message.
 */
export function useLiveScreening() {
  const [live, setLive] = useState({ state: 'off', history: [] });
  const capture = useRef(null);
  const session = useRef(0);
  const lastOk = useRef(undefined);

  const loop = useCallback(async (id) => {
    let lastSent = 0;
    while (session.current === id) {
      const cap = capture.current;
      const wait = lastSent + UPDATE_EVERY_MS - performance.now();
      if (!cap || cap.seconds() < WINDOW_SECONDS || wait > 0) {
        await new Promise((r) => setTimeout(r, Math.max(100, Math.min(wait, 250))));
        continue;
      }
      lastSent = performance.now();
      const at = new Date();
      const file = toWavFile(cap.window(), cap.sampleRate, `live-${stamp(at)}.wav`);
      const started = performance.now();
      let entry;
      try {
        const result = await analyseRecording(file);
        entry = { ok: true, result, file, at };
      } catch (e) {
        entry = { ok: false, refused: Boolean(e.refused), message: e.message, at };
      }
      entry.roundTripMs = performance.now() - started;
      if (session.current !== id) return;
      if (entry.ok) lastOk.current = entry;
      setLive((l) => ({
        ...l,
        history: [...l.history, entry].slice(-HISTORY),
        windows: (l.windows || 0) + 1,
      }));
    }
  }, []);

  const start = useCallback(
    async (source) => {
      const id = ++session.current;
      lastOk.current = undefined;
      setLive({ state: 'starting', source, history: [] });
      try {
        const cap = await startCapture(source);
        if (session.current !== id) {
          cap.stop();
          return;
        }
        capture.current = cap;
        setLive({ state: 'on', source, label: cap.label, capture: cap, startedAt: Date.now(), history: [], windows: 0 });
        loop(id);
      } catch (e) {
        if (session.current === id) setLive({ state: 'error', source, message: e.message, history: [] });
      }
    },
    [loop],
  );

  /** Stop listening; resolves to the last successfully screened window (or undefined). */
  const stop = useCallback(async () => {
    session.current++;
    const cap = capture.current;
    capture.current = null;
    setLive({ state: 'off', history: [] });
    if (cap) await cap.stop();
    return lastOk.current;
  }, []);

  useEffect(
    () => () => {
      session.current++;
      capture.current?.stop();
    },
    [],
  );

  return { live, start, stop };
}
