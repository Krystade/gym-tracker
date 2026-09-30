import { painReport } from '../domain/care';
import type { SetEntry } from '../domain/types';
import { fmtWeight, plural } from '../domain/format';

const cap = (r: string) => r[0].toUpperCase() + r.slice(1);
const SEV = ['', 'mild', 'moderate', 'sharp'];
const WarnIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M8 1.8 15 14H1z" strokeLinejoin="round" /><path d="M8 6v4" /><circle cx="8" cy="12" r="0.6" fill="currentColor" />
  </svg>
);

/** Pain-flagged sets per region over 8 weeks. Records and surfaces; never diagnoses. */
export function CareCard({ entries, today }: { entries: SetEntry[]; today: string }) {
  const report = painReport(entries, today, 8);
  return (
    <section className="card" aria-labelledby="care-h">
      <h2 id="care-h">Joint &amp; back care</h2>
      {report.length === 0 && <p className="muted">No pain logged in the last 8 weeks.</p>}
      {report.map((r) => {
        const max = Math.max(1, ...r.weekly);
        return (
          <div className="care-region" key={r.region}>
            <p className="care-head"><b>{cap(r.region)}</b><span className="muted small">{plural(r.total, 'set')} with pain</span>
              {r.rising && <span className="warn small care-rising"><WarnIcon /> Rising</span>}</p>
            <div className="care-bars" role="img" aria-label={`Pain sets per week, oldest first: ${r.weekly.join(', ')}`}>
              {r.weekly.map((n, i) => <span key={i} style={{ height: `${n ? 4 + (20 * n) / max : 2}px` }} className={n ? '' : 'zero'} />)}
            </div>
            <p className="muted small care-axis"><span>8 weeks ago</span><span>this week</span></p>
            <ul className="care-ex">
              {r.byExercise.slice(0, 3).map((x) => (
                <li key={x.exercise}><b>{x.exercise}</b><span className="muted small">{plural(x.sets, 'set')} · avg {fmtWeight(x.avgWeight)} lb{x.maxSeverity ? ` · worst ${SEV[x.maxSeverity]}` : ''}</span></li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="muted small">Rule of thumb (pain-monitoring model): up to moderate (5/10) is acceptable if it settles by the next morning and isn’t rising week to week. Sharp pain: stop that lift and swap it.</p>
      <p className="muted small">Not medical advice. See a physio if pain persists.</p>
    </section>
  );
}
