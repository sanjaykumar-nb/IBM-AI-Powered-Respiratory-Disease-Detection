import { APP_NAME, APP_TAGLINE } from '../lib/config.js';

const STATUS_TEXT = {
  checking: 'Connecting…',
  online: 'Model online',
  offline: 'Model unavailable',
};

export default function Header({ server }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="brand" href="#screening" aria-label={`${APP_NAME} — ${APP_TAGLINE}`}>
          <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" />
            <path d="M5 16h4l2.5-6 4 12 3-9 2 3H27" />
          </svg>
          <span className="brand__name">{APP_NAME}</span>
          <span className="brand__tagline">{APP_TAGLINE}</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          <a href="#screening">Screening</a>
          <a href="#method">Method</a>
          <a href="#platform">IBM Z</a>
        </nav>
        <div className={`status status--${server.state}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {STATUS_TEXT[server.state]}
          {server.state === 'online' && server.arch && <span className="status__arch">{server.arch}</span>}
        </div>
      </div>
    </header>
  );
}
