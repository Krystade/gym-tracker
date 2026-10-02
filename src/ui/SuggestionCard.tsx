import type { Suggestion } from '../domain/suggest';
import { fmtWeight } from '../domain/format';

const FROM = { program: 'today’s program', last: 'as many as last time', default: 'a default — no history yet' } as const;
export const fmtLoad = (w: number | null) => (w == null ? '' : w === 0 ? ' @ BW' : ` @ ${fmtWeight(w)} lb`);
export const fmtRamp = (s: Suggestion) => s.warmups.map((x) => `${fmtWeight(x.weight)} × ${x.reps}`).join(' · ');

/** What to do next time for one exercise, and why. */
/** `onLog` absent: already trained today, so this is the session after and there's nothing to start. */
export function SuggestionCard({ s, onLog }: { s: Suggestion; onLog?: () => void }) {
  return (
    <section className="card suggestion" aria-label="Next time">
      <h2>Next time</h2>
      <p className="big">{s.sets} × {s.reps}–{s.repMax}{s.unit}{fmtLoad(s.weight)}</p>
      <p className="muted small">{s.reason}</p>
      <p className="muted small">Sets: {FROM[s.setsFrom]}</p>
      {s.warmups.length > 0 && <p className="muted small">Warm-up: {fmtRamp(s)}</p>}
      {onLog && <button className="primary wide" onClick={onLog}>Log it today</button>}
    </section>
  );
}
