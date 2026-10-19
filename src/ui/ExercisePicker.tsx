import { useState } from 'react';
import { normalizeName } from '../domain/ids';
import { sameExercise } from '../domain/stats';
import type { Suggestion } from '../domain/care';
import { SwapSuggestions } from './SwapSuggestions';
import { canDo, type Gym } from '../domain/equipment';
import { searchLifts } from '../domain/search';
import { countsFor } from '../domain/muscles';
import { Input } from './Field';

export function ExercisePicker({ recent, onPick, onCancel, suggested = [], gym = null, title }: { recent: string[]; onPick: (name: string) => void; onCancel: () => void; suggested?: Suggestion[]; gym?: Gym | null; title?: string }) {
  const [q, setQ] = useState('');
  const query = normalizeName(q);
  // Before typing: his lifts, then the common ones. Typing searches every lift and its other names (domain/search).
  const matches = searchLifts(query, recent);
  const exact = matches.some((n) => sameExercise(n, query));
  // What the gym can't do goes last, under a divider; unknown gear stays in the main list.
  const here = matches.filter((n) => canDo(gym, n) !== false), away = matches.filter((n) => canDo(gym, n) === false);
  const item = (n: string) => <li key={n}><button onClick={() => onPick(n)}>{n}{recent.includes(n) && <span className="muted"> · logged</span>}</button></li>;
  return (
    <div className="picker">
      <div className="picker-head">
        {/* Inside the sticky head: it keeps the notch handling, and the lift being swapped stays named while scrolling. */}
        {title && <h1 className="picker-title">{title}</h1>}
        <Input type="search" aria-label="Search exercises" placeholder="Search or add new" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={onCancel}>Cancel</button>
      </div>
      {!query && <SwapSuggestions items={suggested} onPick={onPick} />}
      <ul className="picker-list">
        {here.slice(0, 60).map(item)}
        {/* After the matches, so a slip of the thumb picks a real lift; with no match it's the one thing to do. */}
        {query && !exact && <li><button className={`picker-add${here.length ? '' : ' primary'}`} aria-label={`Add “${query}” as a new lift`} aria-describedby="picker-counts"
          onClick={() => onPick(query)}>Add “{query}” as a new lift
          {/* What it will count for, read from its words: no question to answer, and nothing to tap. */}
          <span className="picker-counts" id="picker-counts">{countsFor(query)}</span></button></li>}
        {gym && away.length > 0 && <li className="picker-divider muted small">Not at {gym.name}</li>}
        {gym && away.slice(0, 30).map(item)}
      </ul>
    </div>
  );
}
