import { APP_NAME } from '../lib/config.js';

export default function Footer({ server }) {
  return (
    <footer className="site-footer">
      <div className="page site-footer__inner">
        <p>
          <strong>{APP_NAME}</strong> is a research prototype, not a medical device. Results must not be used to
          diagnose, treat or rule out any condition.
        </p>
        <p className="muted">
          {server.state === 'online' && server.arch ? `Inference node: ${server.arch}` : 'Inference node: —'}
        </p>
      </div>
    </footer>
  );
}
