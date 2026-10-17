import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { CardioData, SetEntry } from '../domain/types';
import { byOrderDone, lastSession, sameExercise } from '../domain/stats';
import { cardioTarget, fmtCardio, machine, type CardioField } from '../domain/cardio';
import { fmtDay } from '../domain/format';
import { localDate } from '../domain/ids';
import { activeProfileDb } from '../db/db';
import { clearDraft, getDraft, markDirty, saveDraft } from '../state/drafts';
import { Stepper } from './Stepper';

const LABEL: Record<CardioField, string> = { miles: 'Distance (mi)', incline: 'Incline %', level: 'Level', floors: 'Floors' };
const STEP: Record<CardioField, number> = { miles: 0.05, incline: 0.5, level: 1, floors: 1 };

interface Draft { min: string; sec: string; vals: Partial<Record<CardioField, string>>; note: string; at?: string }
const str = (n: number | undefined) => (n == null ? '' : String(n));

/** One bout on a cardio machine: time first, then whatever that machine shows. Fields left empty aren't saved. */
function CardioForm({ name, initial, submitLabel, onSubmit, onCancel, onDelete, draftKey, askTime }: {
  name: string; initial: CardioData & { note?: string }; submitLabel: string;
  onSubmit: (c: CardioData, note: string | undefined, at: string | null | undefined) => Promise<boolean>;
  onCancel?: () => void; onDelete?: () => void;
  /** Keeps a half-typed new bout across leaving the screen. */
  draftKey?: { profile: string; key: string; date: string };
  /** A past day: ask when it was done. */
  askTime?: boolean;
}) {
  const m = machine(name)!;
  const [d] = useState(() => (draftKey ? getDraft<Draft>(draftKey.profile, draftKey.key, draftKey.date) : undefined));
  const [min, setMin] = useState(d?.min ?? String(Math.floor(initial.seconds / 60)));
  const [sec, setSec] = useState(d?.sec ?? String(initial.seconds % 60));
  const [vals, setVals] = useState<Partial<Record<CardioField, string>>>(d?.vals ?? Object.fromEntries(m.fields.map((f) => [f, str(initial[f])])));
  const [note, setNote] = useState(d?.note ?? initial.note ?? '');
  const [moreOpen, setMoreOpen] = useState(note !== '');
  const [whenOpen, setWhenOpen] = useState(!!askTime || d?.at !== undefined);
  const [at, setAt] = useState(d?.at ?? '');
  const dirty = useRef(d != null);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { dirty.current = true; set(v); };
  useEffect(() => {
    if (draftKey && dirty.current) saveDraft<Draft>(draftKey.profile, draftKey.key, draftKey.date, { min, sec, vals, note, ...(whenOpen && { at }) });
  }, [draftKey, min, sec, vals, note, whenOpen, at]);
  const formId = useId();
  useEffect(() => markDirty(formId, dirty.current));
  useEffect(() => () => markDirty(formId, false), [formId]);

  const seconds = (Number(min) || 0) * 60 + (Number(sec) || 0);
  const nums = Object.fromEntries(m.fields.map((f) => [f, vals[f]?.trim() ? Number(vals[f]) : undefined])) as Partial<Record<CardioField, number>>;
  const problem = !/^\d*$/.test(min.trim()) || !/^\d*$/.test(sec.trim()) ? 'Time is whole minutes and seconds'
    : Number(sec) > 59 ? 'Seconds go up to 59'
    : seconds <= 0 ? 'Enter how long you went'
    : m.fields.find((f) => nums[f] != null && !Number.isFinite(nums[f]!)) ? 'Numbers only'
    : m.fields.find((f) => f !== 'incline' && nums[f] != null && nums[f]! < 0) ? 'Only incline can go below 0'
    : null;
  const busy = useRef(false);
  async function submit() {
    if (problem || busy.current) return;
    busy.current = true;
    try {
      const c: CardioData = { seconds, ...Object.fromEntries(Object.entries(nums).filter(([, v]) => v != null)) };
      const ok = await onSubmit(c, note.trim() || undefined, whenOpen ? at || null : undefined);
      if (ok && draftKey) { clearDraft(draftKey.profile, draftKey.key); dirty.current = false; setNote(''); setMoreOpen(false); if (!askTime) setWhenOpen(false); }
    } finally { busy.current = false; }
  }
  return (
    <form className="set-form cardio-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Minutes" value={min} onChange={touch(setMin)} step={1} mode="numeric" />
        <Stepper label="Seconds" value={sec} onChange={touch((v: string) => setSec(Number(v) > 59 ? '0' : v))} step={15} mode="numeric" />
        {m.fields.map((f) => (
          <Stepper key={f} label={LABEL[f]} value={vals[f] ?? ''} onChange={touch((v: string) => setVals((x) => ({ ...x, [f]: v })))} step={STEP[f]} mode="decimal"
            min={f === 'incline' && m.decline ? -10 : 0} />
        ))}
      </div>
      {m.decline && (nums.incline ?? 0) < 0 && <p className="muted small">Below 0 is decline</p>}
      {problem && <p role="status" className="small err">{problem}</p>}
      {whenOpen && <div className="when"><label>When <input type="time" aria-label="When" value={at} onChange={(e) => touch(setAt)(e.target.value)} /></label><span className="muted small">Leave empty if you don’t know</span></div>}
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={!!problem}>{submitLabel}</button>
      </div>
      <button type="button" className="chip more" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>More</button>
      {moreOpen && (<>
        {!whenOpen && <button type="button" className="chip" onClick={() => setWhenOpen(true)}>Did this earlier?</button>}
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => touch(setNote)(e.target.value)} />
      </>)}
      {onDelete && <button type="button" className="mini danger form-delete" onClick={onDelete}>Delete</button>}
    </form>
  );
}

/** A cardio machine on Today: its target, today's bouts and the form. Folds once the planned bout is logged. */
export function CardioCard({ exercise, date, today: realToday = date, store, onOpen, plannedMinutes = null, gym, who, openReq = false, onOpenReq }: {
  exercise: string; date: string; today?: string; store: SetsStore; onOpen: (name: string) => void; plannedMinutes?: number | null; gym?: string; who?: string;
  openReq?: boolean; onOpenReq?: () => void;
}) {
  const [editing, setEditing] = useState<SetEntry | null>(null);
  const [opened, setOpened] = useState(false);
  const [gone, setGone] = useState<SetEntry | null>(null);
  useLayoutEffect(() => { if (!gone) return; const t = setTimeout(() => setGone(null), 8000); return () => clearTimeout(t); }, [gone]);
  const bouts = store.entries.filter((e) => e.date === date && e.cardio && sameExercise(e.exercise, exercise)).sort(byOrderDone);
  if (editing && !bouts.some((x) => x.id === editing.id)) setEditing(null);
  const last = lastSession(store.entries.filter((e) => e.cardio), exercise, date);
  const target = cardioTarget(store.entries, exercise, plannedMinutes, date);
  const complete = plannedMinutes != null && bouts.length > 0;
  if (openReq && complete && !opened) setOpened(true);
  useEffect(() => { if (openReq) onOpenReq?.(); }, [openReq, onOpenReq]);
  const [owner] = useState(() => ({ profile: activeProfileDb(), date }));
  const prev = last?.sets.at(-1)?.cardio;
  const start: CardioData = { seconds: target.minutes * 60, ...(prev?.miles != null && { miles: prev.miles }), ...(target.aim != null && target.unit === 'mi' && { miles: target.aim }),
    ...(target.aim != null && target.unit === 'floors' && { floors: target.aim }), ...(target.incline != null && { incline: target.incline }), ...(target.level != null && { level: target.level }) };

  if (complete && !opened) {
    return (
      <section className="card folded" data-card={exercise.toLowerCase()}>
        <button className="fold-line" aria-expanded="false" aria-label={`Show ${exercise}`} onClick={() => setOpened(true)}>
          <b>{exercise}</b><span className="ok">✓</span><span className="muted nw">{fmtCardio(bouts.at(-1)!.cardio!)}</span>
        </button>
      </section>
    );
  }
  async function add(c: CardioData, note: string | undefined, at: string | null | undefined) {
    const e = await store.add({ date, exercise, weight: 0, reps: null, flags: ['cardio'], gym, note,
      cardio: { ...c, ...(target.aim != null && { aim: target.aim }) }, ...(at !== undefined && { at: at ? new Date(`${date}T${at}:00`) : null }) });
    return !!e;
  }
  return (
    <section className="card" data-card={exercise.toLowerCase()}>
      <header className="card-head">
        <button className="link" onClick={() => onOpen(exercise)}>{exercise}</button>
        {complete && <button className="mini" aria-expanded="true" onClick={() => setOpened(false)}>Fold</button>}
      </header>
      {last && <p className="muted card-last">Last ({fmtDay(last.date, realToday)}): <span className="nw">{last.sets.map((s) => fmtCardio(s.cardio!)).join(' · ')}</span></p>}
      <p className="target" aria-label="Target">{target.text}</p>
      <ol className="sets" aria-label={`Sessions for ${exercise}`}>
        {bouts.map((s, i) => (
          <li key={s.id}><button className={editing?.id === s.id ? 'set-row editing' : 'set-row'} onClick={() => setEditing(s)}>
            <span className="muted">{i + 1}</span> <span className="nw">{fmtCardio(s.cardio!)}</span>{s.note && <span className="muted small"> · {s.note}</span>}
          </button></li>
        ))}
      </ol>
      {gone && <p className="undo-note" role="status">Session deleted. <button className="mini" onClick={async () => { if (await store.restore(gone)) setGone(null); }}>Undo</button></p>}
      {editing ? (
        <div className="edit-box">
          <p className="edit-title">Editing session {bouts.findIndex((x) => x.id === editing.id) + 1}</p>
          <CardioForm key={editing.id} name={exercise} initial={{ ...editing.cardio!, note: editing.note }} submitLabel="Save" onCancel={() => setEditing(null)}
            onDelete={async () => { const s = editing; if (await store.remove(s.id)) { setEditing(null); setGone(s); } }}
            onSubmit={async (c, note) => {
              const next: SetEntry = { ...editing, cardio: { ...c, ...(editing.cardio?.aim != null && { aim: editing.cardio.aim }) } };
              if (note) next.note = note; else delete next.note;
              const ok = await store.update(next); if (ok) setEditing(null); return ok;
            }} />
        </div>
      ) : (
        <CardioForm key={`new-${target.minutes}-${target.aim}`} name={exercise} initial={start} submitLabel={who ? `Log cardio · ${who}` : 'Log cardio'} onSubmit={add}
          draftKey={{ profile: owner.profile, key: `${exercise}@${owner.date}`, date: owner.date }} askTime={date < localDate(new Date())} />
      )}
    </section>
  );
}
