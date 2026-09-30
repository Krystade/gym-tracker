import { useState } from 'react';
import { CATALOG } from '../domain/catalog';
import { normalizeName } from '../domain/ids';
import { sameExercise } from '../domain/stats';

export function ExercisePicker({ recent, onPick, onCancel }: { recent: string[]; onPick: (name: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const query = normalizeName(q);
  const all = [...recent, ...CATALOG.filter((c) => !recent.some((r) => sameExercise(r, c)))];
  const matches = query ? all.filter((n) => n.toLowerCase().includes(query.toLowerCase())) : all;
  const exact = matches.some((n) => sameExercise(n, query));
  return (
    <div className="picker">
      <div className="picker-head">
        <input type="search" aria-label="Search exercises" placeholder="Search or type a new exercise" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={onCancel}>Cancel</button>
      </div>
      <ul className="picker-list">
        {query && !exact && <li><button className="primary" onClick={() => onPick(query)}>Add “{query}”</button></li>}
        {matches.slice(0, 60).map((n) => <li key={n}><button onClick={() => onPick(n)}>{n}{recent.includes(n) && <span className="muted"> · logged</span>}</button></li>)}
      </ul>
    </div>
  );
}
