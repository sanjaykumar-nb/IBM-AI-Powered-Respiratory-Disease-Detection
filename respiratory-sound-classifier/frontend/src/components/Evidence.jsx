// Explainable AI: which kinds of acoustic information, and which moments of the 5 s window, the model
// relied on for this result (occlusion analysis computed by the ML service, see predict.explain_prediction).

function pct(p) {
  if (p > 0.999) return '>99.9%';
  if (p < 0.001) return '<0.1%';
  return `${(p * 100).toFixed(1)}%`;
}

// Thresholds on the drop in log-odds: 3 = odds 20x lower (e.g. 99.5% -> 91%), 0.7 = odds halved
const STRONG = 3;
const RELIED = 0.7;

function effect(drop) {
  if (drop >= STRONG) return 'strong';
  if (drop >= RELIED) return 'moderate';
  if (drop > -RELIED) return 'little';
  return 'against';
}

const EFFECT_LABEL = {
  strong: 'Relied on strongly',
  moderate: 'Relied on',
  little: 'Little effect',
  against: 'Pointed away',
};

export default function Evidence({ explanation, confidence }) {
  if (!explanation) return null;
  const { target, feature_groups: groups, time_segments: segments } = explanation;
  const ranked = [...groups].sort((a, b) => b.log_odds_drop - a.log_odds_drop);
  const scale = Math.max(1, ...groups.map((g) => Math.abs(g.log_odds_drop)));
  const timeScale = Math.max(0.5, ...segments.map((s) => Math.max(0, s.log_odds_drop)));
  const peak = [...segments].filter((s) => !s.padding).sort((a, b) => b.log_odds_drop - a.log_odds_drop)[0];

  return (
    <section className="evidence" aria-labelledby="evidence-title">
      <h3 id="evidence-title" className="evidence__title">
        Why {target}?
      </h3>
      <p className="evidence__intro">
        Each kind of sound information was hidden in turn, replaced by what a typical recording sounds like, and the
        model was run again. The more {target} lost, the more the model relied on it.
      </p>

      <ol className="evidence__groups">
        {ranked.map((g) => {
          const kind = effect(g.log_odds_drop);
          const width = Math.min(100, (Math.abs(g.log_odds_drop) / scale) * 100);
          return (
            <li key={g.key} className={`evidence__group evidence__group--${kind}`}>
              <div className="evidence__row">
                <span className="evidence__name">{g.label}</span>
                <span className="evidence__effect">{EFFECT_LABEL[kind]}</span>
              </div>
              <div className="evidence__bar" aria-hidden="true">
                <span style={{ width: `${Math.max(width, 1)}%` }} />
              </div>
              <p className="evidence__detail">
                Without it: {target} {pct(confidence)} → {pct(g.probability_without)}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="evidence__time">
        <p className="finding__label">Where in the 5 seconds</p>
        <ol className="timestrip" aria-label={`Importance of each half-second for ${target}`}>
          {segments.map((s) => {
            const w = Math.max(0, s.log_odds_drop) / timeScale;
            const against = s.log_odds_drop <= -RELIED;
            return (
              <li
                key={s.start}
                className={`timestrip__cell${s.padding ? ' timestrip__cell--pad' : ''}${against ? ' timestrip__cell--against' : ''}`}
                style={s.padding || against ? undefined : { opacity: 0.12 + 0.88 * w }}
                title={
                  s.padding
                    ? `${s.start.toFixed(1)}–${s.end.toFixed(1)} s: silence added to a short recording`
                    : `${s.start.toFixed(1)}–${s.end.toFixed(1)} s: without it ${target} ${pct(s.probability_without)}`
                }
              >
                <span className="visually-hidden">
                  {s.start.toFixed(1)} to {s.end.toFixed(1)} seconds: without it {target} {pct(s.probability_without)}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="timestrip__axis" aria-hidden="true">
          <span>0 s</span>
          <span>2.5 s</span>
          <span>5 s</span>
        </div>
        <p className="evidence__detail">
          {peak && peak.log_odds_drop >= RELIED
            ? `Most important: ${peak.start.toFixed(1)}–${peak.end.toFixed(1)} s of the analysed window. Darker means the model relied on that half-second more.`
            : 'No single half-second stands out: the evidence is spread across the whole recording.'}
        </p>
      </div>

      <p className="evidence__note">
        This shows what the model based its answer on, not medical findings. Computed for this recording in{' '}
        {Math.round(explanation.explain_ms)} ms.
      </p>
    </section>
  );
}
