// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { byOrderDone, sessionsByDate, sameExercise } from '../domain/stats';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { localDate } from '../domain/ids';
import type { SetEntry } from '../domain/types';
import { Fragment, useMemo } from 'react';
import { paces, sessionMinutes } from '../domain/timing';

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort(byOrderDone)]);
}

export function HistoryScreen({ store, onOpen, onAddTo }: { store: SetsStore; onOpen: (name: string) => void; onAddTo: (date: string) => void }) {
  const sessions = sessionsByDate(store.entries);
  const today = localDate(new Date());
  const pace = useMemo(() => paces(store.entries), [store.entries]);
  if (!sessions.length) return (<><h1>History</h1><p className="muted">No history yet — import it from the Data tab.</p></>);
  return (
    <>
      <h1>History</h1>
      {sessions.map((s, i) => {
        const groups = byExercise(s.sets);
        const mins = sessionMinutes(store.entries, s.date, pace);
        return (
          <details className="day" key={s.date} open={i === 0}>
            <summary>
              <span className="day-date">{fmtDay(s.date, today)}</span>
              <span className="muted small">{plural(groups.length, 'exercise')} · {plural(s.sets.length, 'set')}{mins != null && ` · ${mins} min`}</span>
            </summary>
            <div className="day-body">
              {groups.map(([name, sets]) => {
                // Warm-ups would bury the working weights: count them, don't list them.
                const working = sets.filter((x) => !x.flags.includes('warmup'));
                const warm = sets.length - working.length;
                return (
                <button key={name} className="row-button" onClick={() => onOpen(name)}>
                  <b>{name}</b>
                  <span className="muted">
                    {working.map((x, j) => <Fragment key={x.id}>{j > 0 && ', '}<span className="nw">{fmtSet(x)}{x.flags.includes('pain') && <>{' '}<span className="pain-mark">pain</span></>}</span></Fragment>)}
                    {warm > 0 && `${working.length ? ' + ' : ''}${plural(warm, 'warm-up')}`}
                  </span>
                  {sets.filter((x) => x.note).map((x) => <span key={x.id} className="muted">“{x.note}”</span>)}
                </button>
                );
              })}
              <button className="wide" onClick={() => onAddTo(s.date)}>Add to this day</button>
            </div>
          </details>
        );
      })}
    </>
  );
}
