const API = '/api';

export async function fetchStatus() {
  const res = await fetch(`${API}/status`);
  if (!res.ok) throw new Error('unavailable');
  return res.json();
}

export async function analyseRecording(file) {
  const body = new FormData();
  body.append('audio', file, file.name);
  let res;
  try {
    res = await fetch(`${API}/upload`, { method: 'POST', body });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const detail = typeof data.details === 'object' ? data.details?.error : data.details;
    const error = new Error(detail || data.error || `The server returned an error (${res.status}).`);
    // 422: the recording failed the quality check (silent, too short, noise) - sending it again won't help
    error.refused = res.status === 422;
    throw error;
  }
  return data.prediction;
}

/** Plain-language explanation by IBM Granite on watsonx.ai, or null when it isn't available. */
export async function explainResult(prediction, language) {
  try {
    const res = await fetch(`${API}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prediction, language }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
