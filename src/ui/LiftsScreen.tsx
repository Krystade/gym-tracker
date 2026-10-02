// src/ui/LiftsScreen.tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { exerciseNames, sessionsFor } from '../domain/stats';
import { fmtDate, plural } from '../domain/format';
import { CATALOG } from '../domain/catalog';
import { sameExercise } from '../domain/stats';

export function LiftsScreen({ store, onOpen }: { store: SetsStore; onOpen: (name: string) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const logged = exerciseNames(store.entries);
  const names = logged.filter((n) => n.toLowerCase().includes(query));
  // Searching also finds lifts never logged, so any exercise can be opened for a suggestion.
  const fresh = query ? CATALOG.filter((c) => c.toLowerCase().includes(query) && !logged.some((l) => sameExercise(l, c))) : [];
  return (
    <>
      <h1>Lifts</h1>
      <input type="search" aria-label="Filter lifts" placeholder="Search lifts" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="day-body" style={{ padding: '12px 0' }}>
        {names.map((n) => {
          const s = sessionsFor(store.entries, n);
          return (
            <button key={n} className="row-button" onClick={() => onOpen(n)}>
              <b>{n}</b>
              <span className="muted">{plural(s.length, 'session')} · last {fmtDate(s[0].date)}</span>
            </button>
          );
        })}
        {fresh.map((n) => (
          <button key={n} className="row-button" onClick={() => onOpen(n)}>
            <b>{n}</b>
            <span className="muted">never logged</span>
          </button>
        ))}
        {!names.length && !fresh.length && <p className="muted">{query ? 'Nothing matches.' : 'No lifts yet.'}</p>}
      </div>
    </>
  );
}
