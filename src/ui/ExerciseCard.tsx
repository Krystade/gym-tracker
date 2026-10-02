import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, byOrderDone, e1rm, lastSession, sameExercise } from '../domain/stats';
import { estimateRir, isWorking, nextTarget, prCheck, priorE1rm, rirOffset } from '../domain/progression';
import { fmtDate, fmtSet, fmtWeight } from '../domain/format';
import type { Flag, SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';
import { SetRowContent } from './SetRow';
import { suggest } from '../domain/suggest';
import { fmtLoad, fmtRamp } from './SuggestionCard';
import { hhmm, paces, suggestTime } from '../domain/timing';

const TargetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="8" cy="8" r="6.5" /><circle cx="8" cy="8" r="3.5" /><circle cx="8" cy="8" r="0.8" fill="currentColor" />
  </svg>
);

export function ExerciseCard({ exercise, date, today: realToday = date, store, settings, onOpen, plannedSets = null, gym }: {
  exercise: string; date: string; today?: string; store: SetsStore; settings: SettingsStore; onOpen: (name: string) => void; plannedSets?: number | null; gym?: string;
}) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const [pr, setPr] = useState<string | null>(null);
  useEffect(() => { if (!pr) return; const t = setTimeout(() => setPr(null), 6000); return () => clearTimeout(t); }, [pr]);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort(byOrderDone); // in the order done: a late set sits where it happened
  const last = lastSession(store.entries, exercise, date);
  const best = bestSet(store.entries, exercise);
  const st = settings.get(exercise);
  const target = nextTarget(store.entries, exercise, st, date);
  const sug = suggest(store.entries, exercise, st, date, plannedSets);
  const pace = useMemo(() => paces(store.entries), [store.entries]);
  // A new function only when the log changes, so the form can re-ask once a late set has landed.
  const suggestWhen = useCallback(() => suggestTime(store.entries, date, exercise, pace, new Date()), [store.entries, date, exercise, pace]);
  // Whole-history scans: recompute only when the log changes, not on every keystroke in the form.
  const { prior, offset } = useMemo(() => ({
    prior: priorE1rm(store.entries, exercise, date), offset: rirOffset(store.entries, exercise),
  }), [store.entries, exercise, date]);
  // The last set actually done here, not a pasted one that sorts after it.
  const seed = today.findLast((s) => s.loggedAt) ?? today.at(-1);
  const pulley: Flag[] = (seed ?? last?.sets.find(isWorking))?.flags.includes('double_pulley') ? ['double_pulley'] : [];
  const initial: SetFormValue = seed ? { weight: seed.weight, reps: seed.reps ?? st.repMin, flags: pulley }
    : target ? { weight: target.weight, reps: target.reps, flags: pulley }
    : { weight: 0, reps: st.repMin, flags: [] };

  async function addSet(v: SetFormValue): Promise<boolean> {
    setPr(null);
    // What was suggested rides along with every set, so suggested and done can be compared later.
    const { at, ...rest } = v;
    // A time for a late set is on the day being logged to.
    const e = await store.add({ date, exercise, ...rest, gym, ...(at !== undefined && { at: at ? new Date(`${date}T${at}:00`) : null }), target: { weight: sug.weight, reps: sug.reps, sets: sug.sets } });
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
      {target && <p className="target" aria-label="Target"><TargetIcon /><span>{sug.kind === 'increase' && 'Go up: '}{sug.sets} × {sug.reps}{sug.unit}+{fmtLoad(sug.weight)}{sug.warmups.length > 0 && <span className="muted"> · warm-up {fmtRamp(sug)}</span>}</span></p>}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s, i) => (
          <li key={s.id}>
            <button className="set-row" onClick={() => setEditing(s)}>
              <SetRowContent s={s} no={i + 1} estRir={estimateRir(s, today, prior, offset)} />
            </button>
          </li>
        ))}
      </ol>
      {pr && <p role="status" className="pr">{pr}</p>}
      {editing ? (
        <SetForm key={editing.id} exercise={exercise} initial={editing} submitLabel="Save"
          onCancel={() => setEditing(null)}
          onDelete={async () => {
            const no = today.findIndex((x) => x.id === editing.id) + 1; // the number on the row, not the entry order
            if (confirm(`Delete set ${no}?`) && (await store.remove(editing.id))) setEditing(null);
          }}
          onSubmit={async (v) => { const ok = await store.update({ ...editing, ...v }); if (ok) setEditing(null); return ok; }} />
      ) : (
        <SetForm key="new" exercise={exercise} initial={initial} submitLabel="Add set" onSubmit={addSet} keepDraft day={date}
          when={{ suggest: suggestWhen, always: date < realToday, max: date === realToday ? () => hhmm(new Date()) : undefined }} />
      )}
    </section>
  );
}
