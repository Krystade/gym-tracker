// src/ui/LiftsScreen.tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { exerciseNames, sessionsFor } from '../domain/stats';
import { fmtDate, plural } from '../domain/format';

export function LiftsScreen({ store, onOpen }: { store: SetsStore; onOpen: (name: string) => void }) {
  const [q, setQ] = useState('');
  const names = exerciseNames(store.entries).filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <h1>Lifts</h1>
      <input type="search" aria-label="Filter lifts" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
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
        {!names.length && <p className="muted">No lifts yet.</p>}
      </div>
    </>
  );
}
