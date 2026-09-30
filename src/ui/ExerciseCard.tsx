import { useEffect, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, e1rm, lastSession, sameExercise } from '../domain/stats';
import { estimateRir, isWorking, nextTarget, prCheck, priorE1rm, rirOffset } from '../domain/progression';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import type { Flag, SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';
import { SetRowContent } from './SetRow';

const TargetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="8" cy="8" r="6.5" /><circle cx="8" cy="8" r="3.5" /><circle cx="8" cy="8" r="0.8" fill="currentColor" />
  </svg>
);

export function ExerciseCard({ exercise, date, store, settings, onOpen }: {
  exercise: string; date: string; store: SetsStore; settings: SettingsStore; onOpen: (name: string) => void;
}) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  useEffect(() => { if (!pr) return; const t = setTimeout(() => setPr(null), 6000); return () => clearTimeout(t); }, [pr]);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort((a, b) => a.setNo - b.setNo);
  const last = lastSession(store.entries, exercise, date);
  const best = bestSet(store.entries, exercise);
  const st = settings.get(exercise);
  const target = nextTarget(store.entries, exercise, st, date);
  const prior = priorE1rm(store.entries, exercise, date);
  const offset = rirOffset(store.entries, exercise);
  const seed = today.at(-1);
  const pulley: Flag[] = (seed ?? last?.sets.find(isWorking))?.flags.includes('double_pulley') ? ['double_pulley'] : [];
  const initial: SetFormValue = seed ? { weight: seed.weight, reps: seed.reps ?? st.repMin, flags: pulley }
    : target ? { weight: target.weight, reps: target.reps, flags: pulley }
    : { weight: 0, reps: st.repMin, flags: [] };

  async function addSet(v: SetFormValue): Promise<boolean> {
    setPr(null);
    const e = await store.add({ date, exercise, ...v });
    if (!e) return false;
    const r = prCheck([...store.entries, e], e);
    if (r.e1rm) setPr(`PR! New best e1RM ${Math.round(e1rm(e)!)} lb`);
    else if (r.reps) setPr(`Rep PR at ${fmtWeight(e.weight)} lb`);
    return true;
  }

  return (
    <section className="card">
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {best && <span className="muted">Best {fmtSet(best.set)} · e1RM {fmtWeight(Math.round(best.e1rm))}</span>}
      </header>
      {last && <p className="muted">Last ({fmtDate(last.date)}): {last.sets.map(fmtSet).join(' · ')}</p>}
      {target && <p className="target" aria-label="Target"><TargetIcon />{target.text}</p>}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s) => (
          <li key={s.id}>
            <button className="set-row" onClick={() => setEditing(s)}>
              <SetRowContent s={s} estRir={estimateRir(s, today, prior, offset)} />
            </button>
          </li>
        ))}
      </ol>
      {pr && <p role="status" className="pr">{pr}</p>}
      {editing ? (
        <SetForm key={editing.id} initial={editing} submitLabel="Save"
          onCancel={() => setEditing(null)}
          onDelete={async () => { if (confirm(`Delete set ${editing.setNo}?`) && (await store.remove(editing.id))) setEditing(null); }}
          onSubmit={async (v) => { const ok = await store.update({ ...editing, ...v }); if (ok) setEditing(null); return ok; }} />
      ) : (
        <SetForm key="new" initial={initial} submitLabel="Add set" onSubmit={addSet} />
      )}
    </section>
  );
}
