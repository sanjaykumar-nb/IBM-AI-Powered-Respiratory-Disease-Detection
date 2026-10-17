const PIPELINE = [
  {
    title: 'Recording',
    body: 'Resampled to 16 kHz, centred and trimmed or padded to 5 seconds, then peak-normalised.',
    stat: '80,000 samples',
  },
  {
    title: 'Acoustic features',
    body: 'MFCCs with first and second derivatives, spectral centroid, roll-off, contrast and bandwidth, zero-crossing rate, chroma, mel energies and RMS.',
    stat: '76 features × 157 frames',
  },
  {
    title: 'Frame graph',
    body: 'Each analysis frame (one every 32 ms) becomes a node, linked to the five frames that sound most like it.',
    stat: 'k = 5 nearest neighbours',
  },
  {
    title: 'Graph neural network',
    body: 'Four graph-convolution layers with residual connections, mean pooling and a small classifier.',
    stat: '5 classes',
  },
];

export default function Method({ arch }) {
  return (
    <section id="method" className="method">
      <div className="page">
        <p className="eyebrow">Method</p>
        <h2 className="method__title">From breath sound to graph to read‑out</h2>
        <ol className="pipeline">
          {PIPELINE.map((step, i) => (
            <li key={step.title} className="pipeline__step">
              <span className="pipeline__index">{String(i + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <p className="pipeline__stat">{step.stat}</p>
            </li>
          ))}
        </ol>

        <div className="facts">
          <div>
            <h3>Training data</h3>
            <p>
              Asthma Detection Dataset v2: 1,211 stethoscope recordings labelled healthy, asthma, COPD, pneumonia or
              bronchial.
            </p>
          </div>
          <div>
            <h3>Deployment</h3>
            <p>
              Three containers — web, API gateway and inference — orchestrated with Docker Compose
              {arch === 's390x' ? ', currently serving from IBM LinuxONE (s390x).' : arch ? `, currently serving from ${arch}.` : '.'}
            </p>
          </div>
          <div>
            <h3>Privacy</h3>
            <p>Recordings are processed on this server and deleted as soon as the analysis finishes. Nothing is stored.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
