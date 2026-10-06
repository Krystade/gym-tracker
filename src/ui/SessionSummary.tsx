import { useMemo } from 'react';
import { fmtSet } from '../domain/format';
import { e1rm } from '../domain/stats';
import { daySummary } from '../domain/summary';
import type { SetEntry } from '../domain/types';

// Half sets read as noise at a glance; a muscle with under one set isn't worth a word.
const sets = (n: number) => Math.round(n * 2) / 2;

/** How the day went: each lift's top set against last time, PRs, and the sets each muscle got. */
export function SessionSummary({ entries, date, past = false }: { entries: SetEntry[]; date: string; past?: boolean }) {
  const d = useMemo(() => daySummary(entries, date), [entries, date]);
  if (!d.lifts.length) return null;
  const muscles = d.muscles.filter(([, n]) => n >= 1);
  return (
    <section className="card" aria-label={past ? 'That day' : 'Today so far'}>
      <h2>{past ? 'That day' : 'Today so far'}</h2>
      <ul className="summary-lifts">
        {d.lifts.map((l) => {
          const now = e1rm(l.top), then = l.last && e1rm(l.last);
          const up = now != null && then != null && now > then;
          return (
            <li key={l.exercise}>
              <b>{l.exercise}</b>
              <span className="nw">{fmtSet(l.top)}</span>
              {l.pr && <span className="tag pr-tag">PR</span>}
              {l.last && <span className={up ? 'small up' : 'muted small'}>{up ? '↑ ' : ''}last {fmtSet(l.last)}</span>}
            </li>
          );
        })}
      </ul>
      {muscles.length > 0 && <p className="muted small" aria-label="Sets per muscle">Sets: {muscles.map(([m, n]) => `${m} ${sets(n)}`).join(' · ')}</p>}
    </section>
  );
}
