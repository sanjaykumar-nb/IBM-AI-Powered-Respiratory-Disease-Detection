export const APP_NAME = 'Auscult';
export const APP_TAGLINE = 'Respiratory sound screening';

// Keys match the class names returned by the ML service
export const CONDITIONS = {
  Healthy: {
    color: '#2f7d4f',
    summary: 'Breath sounds consistent with the healthy recordings the model was trained on.',
  },
  Asthma: {
    color: '#b07a1f',
    summary:
      'Acoustic patterns associated with asthma, such as wheeze — continuous, musical sounds produced by narrowed airways.',
  },
  COPD: {
    color: '#a63a2b',
    summary:
      'Acoustic patterns associated with chronic obstructive pulmonary disease, such as prolonged expiration, wheeze or coarse crackles.',
  },
  Pneumonia: {
    color: '#6b4c8a',
    summary:
      'Acoustic patterns associated with pneumonia, such as fine crackles or bronchial breathing over the affected area.',
  },
  Bronchial: {
    color: '#2f5d8a',
    summary:
      'Acoustic patterns associated with bronchial conditions such as bronchitis, for example rhonchi or coarse crackles.',
  },
};

// Example recordings from the training dataset (Asthma Detection Dataset v2), one per class
export const SAMPLES = [
  { label: 'Healthy', file: 'healthy.wav' },
  { label: 'Asthma', file: 'asthma.wav' },
  { label: 'COPD', file: 'copd.wav' },
  { label: 'Pneumonia', file: 'pneumonia.wav' },
  { label: 'Bronchial', file: 'bronchial.wav' },
];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function confidenceBand(p) {
  if (p >= 0.85) return { label: 'High agreement', tone: 'ok' };
  if (p >= 0.6) return { label: 'Moderate agreement', tone: 'warn' };
  return { label: 'Low agreement', tone: 'alert' };
}
