// src/ui/HistoryScreen.tsx
import type { SetsStore } from '../state/useSets';
import { sessionsByDate, sameExercise } from '../domain/stats';
import { fmtDate, fmtSet, plural } from '../domain/format';
import type { SetEntry } from '../domain/types';

function byExercise(sets: SetEntry[]): [string, SetEntry[]][] {
  const out: [string, SetEntry[]][] = [];
  for (const s of sets) {
    const g = out.find(([n]) => sameExercise(n, s.exercise));
    if (g) g[1].push(s); else out.push([s.exercise, [s]]);
  }
  return out.map(([n, xs]) => [n, xs.sort((a, b) => a.setNo - b.setNo)]);
}

export function HistoryScreen({ store, onOpen }: { store: SetsStore; onOpen: (name: string) => void }) {
  const sessions = sessionsByDate(store.entries);
  if (!sessions.length) return (<><h1>History</h1><p className="muted">No history yet — import it from the Data tab.</p></>);
  return (
    <>
      <h1>History</h1>
      {sessions.map((s, i) => {
        const groups = byExercise(s.sets);
        return (
          <details className="day" key={s.date} open={i === 0}>
            <summary>{fmtDate(s.date)} · {plural(groups.length, 'exercise')} · {plural(s.sets.length, 'set')}</summary>
            <div className="day-body">
              {groups.map(([name, sets]) => (
                <button key={name} className="row-button" onClick={() => onOpen(name)}>
                  <b>{name}</b>
                  <span className="muted">{sets.map(fmtSet).join(', ')}</span>
                  {sets.filter((x) => x.note).map((x) => <span key={x.id} className="muted">“{x.note}”</span>)}
                </button>
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}
