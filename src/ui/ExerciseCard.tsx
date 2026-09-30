import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import { bestSet, lastSession, sameExercise } from '../domain/stats';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import type { SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';

export function ExerciseCard({ exercise, date, store, onOpen }: { exercise: string; date: string; store: SetsStore; onOpen: (name: string) => void }) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort((a, b) => a.setNo - b.setNo);
  const last = lastSession(store.entries, exercise, date);
  const best = bestSet(store.entries, exercise);
  const seed = today.at(-1) ?? last?.sets[0];
  const initial: SetFormValue = { weight: seed?.weight ?? 0, reps: seed?.reps ?? 10, flags: seed?.flags.includes('double_pulley') ? ['double_pulley'] : [] };

  return (
    <section className="card">
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {best && <span className="muted">Best {fmtSet(best.set)} · e1RM {fmtWeight(Math.round(best.e1rm))}</span>}
      </header>
      {last && <p className="muted">Last ({fmtDate(last.date)}): {last.sets.map(fmtSet).join(' · ')}</p>}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s) => (
          <li key={s.id}>
            <button className="set-row" onClick={() => setEditing(s)}>
              <span className="set-no">{s.setNo}</span>
              <span>{fmtSet(s)}</span>
              {s.rir != null && <span className="tag">RIR {s.rir}</span>}
              {s.flags.filter((f) => f !== 'bodyweight').map((f) => <span key={f} className={`tag ${f}`}>{f.replace('_', ' ')}</span>)}
              {s.note && <span className="note">{s.note}</span>}
            </button>
          </li>
        ))}
      </ol>
      {editing ? (
        <SetForm key={editing.id} initial={editing} submitLabel="Save"
          onCancel={() => setEditing(null)}
          onDelete={async () => { if (confirm(`Delete set ${editing.setNo}?`) && (await store.remove(editing.id))) setEditing(null); }}
          onSubmit={async (v) => { const ok = await store.update({ ...editing, ...v }); if (ok) setEditing(null); return ok; }} />
      ) : (
        <SetForm key="new" initial={initial} submitLabel="Add set"
          onSubmit={async (v) => (await store.add({ date, exercise, ...v })) != null} />
      )}
    </section>
  );
}
