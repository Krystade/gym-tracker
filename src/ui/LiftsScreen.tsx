// src/ui/LiftsScreen.tsx
import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { exerciseNames, sessionsFor } from '../domain/stats';
import { fmtDay, fmtSet, plural } from '../domain/format';
import { isWorking } from '../domain/progression';
import { topSet } from '../domain/summary';
import { localDate } from '../domain/ids';
import { searchLifts } from '../domain/search';
import { Input } from './Field';

/** `loggedOnly`: a friend's lifts, without the catalogue's never-logged ones. */
export function LiftsScreen({ store, onOpen, loggedOnly }: { store: SetsStore; onOpen: (name: string) => void; loggedOnly?: boolean }) {
  const [q, setQ] = useState('');
  const today = localDate(new Date());
  const query = q.trim().toLowerCase();
  const logged = exerciseNames(store.entries);
  // Searching also finds lifts never logged (by any name they go by), so any exercise can be opened for a suggestion.
  const found = query ? searchLifts(query, logged) : null;
  const mine = new Set(logged);
  const names = found ? found.filter((n) => mine.has(n)) : logged;
  const fresh = found && !loggedOnly ? found.filter((n) => !mine.has(n)).slice(0, 40) : [];
  return (
    <>
      <h1>Lifts</h1>
      <Input type="search" aria-label="Filter lifts" placeholder="Search lifts" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="lift-list">
        {names.map((n) => {
          const s = sessionsFor(store.entries, n);
          const work = s[0].sets.filter(isWorking);
          return (
            <button key={n} className="row-button" onClick={() => onOpen(n)}>
              <b>{n}</b>
              <span className="muted">{plural(s.length, 'session')} · last {fmtDay(s[0].date, today)}{work.length > 0 && <> · <span className="nw">{fmtSet(topSet(work))}</span></>}</span>
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
