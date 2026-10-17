import { useMemo, type ReactNode } from 'react';
import { fmtCardio } from '../domain/cardio';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { fmtRecord, recordLabel, records, REP_MAXES, type Held, type RecordKind } from '../domain/records';
import type { SetEntry } from '../domain/types';

// The records in the order they're listed; a lift only shows the ones it holds. Rep maxes get their own grid.
const LIST: RecordKind[] = ['e1rm', 'heaviest', 'setVolume', 'sessionVolume', 'mostReps', 'sessionReps', 'hold', 'distance', 'floors', 'pace', 'time'];

/** What the record was set with: the set, the session's number of sets, or the cardio bout. */
function what(h: Held): string | null {
  if (!h.set) return h.sets ? plural(h.sets, 'set') : null;
  if (h.set.cardio) return fmtCardio(h.set.cardio);
  return h.kind === 'mostReps' || h.kind === 'hold' ? null : fmtSet(h.set);
}

/** A day without the weekday, for the narrow rep-max cells: "Sep 8", or "Jan 5, 2025" in another year. */
function shortDay(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, iso.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A lift's records, worked out from the log on every render, so an edit or a delete corrects them. Each shows its value
 * and the day it was set; with `onDay`, tapping one opens that day in History.
 */
export function Records({ entries, name, today, onDay }: { entries: SetEntry[]; name: string; today: string; onDay?: (date: string) => void }) {
  const held = useMemo(() => records(entries, name), [entries, name]);
  if (!held.size) return null;
  const rows = LIST.flatMap((k) => held.get(k) ?? []);
  const rms = REP_MAXES.map((n) => held.get(`rm${n}`));
  const tap = (h: Held, className: string, body: ReactNode) => (onDay
    ? <button type="button" className={className} onClick={() => onDay(h.date)}>{body}</button>
    : <div className={className}>{body}</div>);
  return (
    <section className="card records" aria-label="Records">
      <h2>Records</h2>
      {rows.length > 0 && (
        <ul className="rec-list">
          {rows.map((h) => (
            <li key={h.kind}>
              {tap(h, 'rec', <>
                <span className="rec-name">{recordLabel(h.kind)}</span>
                <b className="rec-val">{fmtRecord(h.kind, h.value)}</b>
                <span className="rec-meta">{[what(h), fmtDay(h.date, today)].filter(Boolean).join(' · ')}</span>
              </>)}
            </li>
          ))}
        </ul>
      )}
      {rms.some(Boolean) && <>
        <h3 className="rec-sub">Rep maxes <span>· at least that many reps</span></h3>
        <ul className="rec-grid" aria-label="Rep maxes">
          {REP_MAXES.map((n, i) => {
            const h = rms[i];
            return (
              <li key={n}>
                {h ? tap(h, 'rec-cell', <>
                  <span className="rec-name">{plural(n, 'rep')}</span>
                  <b className="rec-val">{fmtRecord(h.kind, h.value)}</b>
                  <span className="rec-meta">× {h.set!.reps}</span>
                  <span className="rec-meta">{shortDay(h.date, today)}</span>
                </>) : (
                  <div className="rec-cell empty"><span className="rec-name">{plural(n, 'rep')}</span><b className="rec-val">—</b></div>
                )}
              </li>
            );
          })}
        </ul>
      </>}
    </section>
  );
}
