import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { bestSet, byOrderDone, e1rm, lastSession, sameExercise } from '../domain/stats';
import { estimateRir, isWorking, nextTarget, prCheck, priorE1rm, rirOffset } from '../domain/progression';
import { fmtDay, fmtSet, fmtWeight } from '../domain/format';
import type { Flag, SetEntry } from '../domain/types';
import { SetForm, type SetFormValue } from './SetForm';
import { isHoldLift } from '../domain/care';
import { SetRowContent } from './SetRow';
import { suggest } from '../domain/suggest';
import { fmtLoad, fmtRamp } from './SuggestionCard';
import { hhmm, paces, suggestTime } from '../domain/timing';
import { localDate } from '../domain/ids';
import { gearOf } from '../domain/equipment';

const TargetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="8" cy="8" r="6.5" /><circle cx="8" cy="8" r="3.5" /><circle cx="8" cy="8" r="0.8" fill="currentColor" />
  </svg>
);

export function ExerciseCard({ exercise, date, today: realToday = date, store, settings, onOpen, plannedSets = null, gym, openReq = false, onOpenReq, who, swappedFrom, left = [], onGo }: {
  exercise: string; date: string; today?: string; store: SetsStore; settings: SettingsStore; onOpen: (name: string) => void; plannedSets?: number | null; gym?: string;
  openReq?: boolean; onOpenReq?: () => void;
  /** Named on Add set when several people share the phone. */
  who?: string;
  /** The planned lift this one was swapped in for. */
  swappedFrom?: string;
  /** The plan's lifts still to do, offered on the card you just finished so you can take whichever machine is free. */
  left?: string[]; onGo?: (exercise: string) => void;
}) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  // Once the user has opened a finished card it stays open (more sets are theirs to add); a reload starts it folded again.
  const [opened, setOpened] = useState(false);
  const [pr, setPr] = useState<string | null>(null);
  useEffect(() => { if (!pr) return; const t = setTimeout(() => setPr(null), 6000); return () => clearTimeout(t); }, [pr]);
  const today = store.entries.filter((e) => e.date === date && sameExercise(e.exercise, exercise)).sort(byOrderDone); // in the order done: a late set sits where it happened
  // The set being edited may vanish (deleted in another tab, an import): close the editor rather than offer "Delete set 0".
  if (editing && !today.some((x) => x.id === editing.id)) setEditing(null);
  const editBox = useRef<HTMLDivElement>(null);
  const hold = isHoldLift(exercise, store.entries);
  // With several sets and cards below, Save sits off-screen; 'nearest' moves nothing when it is already in view.
  useEffect(() => { if (editing) editBox.current?.scrollIntoView({ block: 'nearest' }); }, [editing?.id]);
  const last = lastSession(store.entries, exercise, date);
  const best = bestSet(store.entries, exercise);
  // The heaviest working set ever: a weight far above it is more likely a typo than a jump.
  // A lift swapped in with no history of its own is checked against the one it replaces.
  const heaviest = useMemo(() => {
    const top = (n: string) => store.entries.filter((e) => sameExercise(e.exercise, n) && isWorking(e)).reduce((m, e) => Math.max(m, e.weight), 0);
    return top(exercise) || (swappedFrom ? top(swappedFrom) : 0);
  }, [store.entries, exercise, swappedFrom]);
  const from = useMemo(() => (swappedFrom ? lastSession(store.entries, swappedFrom, date) : null), [store.entries, swappedFrom, date]);
  const st = settings.get(exercise, hold);
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
  // With nothing to go on, a lift that needs gear starts empty: a prefilled 0 would log a weighted lift as bodyweight.
  const initial: Omit<SetFormValue, 'weight'> & { weight: number | null } = seed ? { weight: seed.weight, reps: seed.reps ?? st.repMin, flags: pulley }
    : target ? { weight: target.weight, reps: target.reps, flags: pulley }
    : { weight: hold || gearOf(exercise) === 'no equipment' ? 0 : null, reps: st.repMin, flags: [] };

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

  const working = today.filter(isWorking);
  const complete = plannedSets != null && plannedSets > 0 && working.length >= plannedSets;
  // The plan sent you here: open a folded card, but a card that isn't finished has nothing to open, so don't pin it open.
  if (openReq && complete && !opened) setOpened(true);
  useEffect(() => { if (openReq) onOpenReq?.(); }, [openReq, onOpenReq]);
  const folded = complete && !opened;
  // Finished while on screen: this card is where you are, so it offers what's left.
  const wasFolded = useRef(folded);
  const [justDone, setJustDone] = useState(false);
  useLayoutEffect(() => { if (folded && !wasFolded.current) setJustDone(true); wasFolded.current = folded; }, [folded]);

  if (folded) {
    const top = working.reduce((a, b) => (b.weight > a.weight || (b.weight === a.weight && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
    return (
      <section className="card folded" data-card={exercise.toLowerCase()}>
        <button className="fold-line" aria-expanded="false" aria-label={`Show ${exercise}`} onClick={() => setOpened(true)}>
          <b>{exercise}</b>
          <span className="ok">{working.length}/{plannedSets} sets ✓</span>
          <span className="muted nw">{fmtSet(top)}</span>
        </button>
        {pr && <p role="status" className="pr">{pr}</p>}
        {justDone && onGo && left.length > 0 && (
          <div className="chips left-row" role="group" aria-label="Left to do">
            <span className="chip-label">Left</span>
            {left.map((ex) => <button key={ex} type="button" className="chip" onClick={() => onGo(ex)}>{ex}</button>)}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card" data-card={exercise.toLowerCase()}>
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {complete && <button className="mini" aria-expanded="true" onClick={() => setOpened(false)}>Fold</button>}
        {best && <span className="muted">Best {fmtSet(best.set)} · e1RM {fmtWeight(Math.round(best.e1rm))} lb</span>}
      </header>
      {last && <p className="muted card-last">Last ({fmtDay(last.date, realToday)}): {last.sets.map((s, i) => <Fragment key={s.id}>{i > 0 && ' · '}<span className="nw">{fmtSet(s)}</span></Fragment>)}</p>}
      {swappedFrom && <p className="muted card-last">For {swappedFrom}{from && <> · last {from.sets.map((s, i) => <Fragment key={s.id}>{i > 0 && ' · '}<span className="nw">{fmtSet(s)}</span></Fragment>)}</>}</p>}
      {target && <p className="target" aria-label="Target"><TargetIcon /><span>{sug.kind === 'increase' && 'Go up: '}{sug.sets} × {sug.reps}{sug.unit}{sug.kind !== 'maxed' && '+'}{fmtLoad(sug.weight)}{sug.warmups.length > 0 && <span className="target-warm muted">warm-up {fmtRamp(sug)}</span>}</span></p>}
      <ol className="sets" aria-label={`Sets for ${exercise}`}>
        {today.map((s, i) => (
          <li key={s.id}>
            <button className={editing?.id === s.id ? 'set-row editing' : 'set-row'} aria-current={editing?.id === s.id ? 'true' : undefined} onClick={() => setEditing(s)}>
              <SetRowContent s={s} no={i + 1} estRir={estimateRir(s, today, prior, offset)} />
            </button>
          </li>
        ))}
      </ol>
      {pr && <p role="status" className="pr">{pr}</p>}
      {editing ? (
        <div ref={editBox} className="edit-box">
        <p className="edit-title">Editing set {today.findIndex((x) => x.id === editing.id) + 1}</p>
        <SetForm key={editing.id} exercise={exercise} hold={hold} initial={editing} submitLabel="Save"
          onCancel={() => setEditing(null)}
          onDelete={async () => {
            const no = today.findIndex((x) => x.id === editing.id) + 1; // the number on the row, not the entry order
            if (confirm(`Delete set ${no}?`) && (await store.remove(editing.id))) setEditing(null);
          }}
          when={{
            suggest: () => (editing.loggedAt ? hhmm(new Date(editing.loggedAt)) : null),
            always: true,
            max: date === localDate(new Date()) ? () => hhmm(new Date()) : undefined,
          }}
          onSubmit={async (v) => {
            const { at, ...rest } = v;
            const next: SetEntry = { ...editing, ...rest };
            const was = editing.loggedAt ? hhmm(new Date(editing.loggedAt)) : null;
            // Only a changed time is rewritten: re-saving 18:02 would drop the seconds and move the set.
            if (at !== undefined && (at || null) !== was) {
              next.enteredAt = editing.enteredAt ?? editing.loggedAt ?? new Date().toISOString();
              if (at) { const d = new Date(`${date}T${at}:00`); next.loggedAt = d.toISOString(); next.seq = d.getTime(); }
              else delete next.loggedAt;
            }
            const ok = await store.update(next); if (ok) setEditing(null); return ok;
          }} />
        </div>
      ) : (
        <SetForm key="new" exercise={exercise} hold={hold} initial={initial} submitLabel={who ? `Add set · ${who}` : 'Add set'} onSubmit={addSet} keepDraft day={date} heaviest={heaviest}
          when={{ suggest: suggestWhen, always: date < realToday, max: date === localDate(new Date()) ? () => hhmm(new Date()) : undefined }} />
      )}
    </section>
  );
}
