// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { sessionsByDate, sameExercise } from '../domain/stats';
import { fmtDate, fmtSet, plural } from '../domain/format';
import type { SetEntry } from '../domain/types';
import { useMemo } from 'react';
import { paces, sessionMinutes } from '../domain/timing';

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort((a, b) => a.seq - b.seq || a.setNo - b.setNo)]);
}

export function HistoryScreen({ store, onOpen, onAddTo }: { store: SetsStore; onOpen: (name: string) => void; onAddTo: (date: string) => void }) {
  const sessions = sessionsByDate(store.entries);
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
            <summary>{fmtDate(s.date)} · {plural(groups.length, 'exercise')} · {plural(s.sets.length, 'set')}{mins != null && ` · ${mins} min`}</summary>
            <div className="day-body">
              {groups.map(([name, sets]) => (
                <button key={name} className="row-button" onClick={() => onOpen(name)}>
                  <b>{name}</b>
                  <span className="muted">{sets.map(fmtSet).join(', ')}</span>
                  {sets.filter((x) => x.note).map((x) => <span key={x.id} className="muted">“{x.note}”</span>)}
                </button>
              ))}
              <button className="wide" onClick={() => onAddTo(s.date)}>Add to this day</button>
            </div>
          </details>
        );
      })}
    </>
  );
}
