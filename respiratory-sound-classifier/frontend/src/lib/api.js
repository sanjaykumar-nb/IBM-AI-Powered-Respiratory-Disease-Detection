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
    throw new Error(detail || data.error || `The server returned an error (${res.status}).`);
  }
  return data.prediction;
}
