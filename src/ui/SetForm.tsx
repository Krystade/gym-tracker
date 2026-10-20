import { useEffect, useId, useRef, useState } from 'react';
import { activeProfileDb } from '../db/db';
import { localDate } from '../domain/ids';
import { clearDraft, getDraft, markDirty, saveDraft } from '../state/drafts';
import { REGIONS, type Flag, type Region } from '../domain/types';
import { derivedFlags } from '../domain/buildSet';
import { isHold, likelyRegion, painDefaults } from '../domain/care';
import { Stepper } from './Stepper';
import { Icon } from './icons';
import { BUILT_IN, type TagPrefs } from '../domain/tags';
import { TagEditor } from './TagEditor';
import { fmtPerSide } from '../domain/plates';
import { useMinute } from '../state/clock';
import { Input } from './Field';
import { bodyShare } from '../domain/learn/bodyweight';
import { fmtWeight } from '../domain/format';

export interface SetFormValue { weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string; painRegion?: Region; painSeverity?: 1 | 2 | 3; at?: string | null; tags?: string[] }
const SEVERITY: [1 | 2 | 3, string][] = [[1, 'Mild'], [2, 'Moderate'], [3, 'Sharp']];
const cap = (r: string) => r[0].toUpperCase() + r.slice(1);

interface Draft { weight: string; reps: string; rir?: number; flags: Flag[]; note: string; region?: Region; severity?: 1 | 2 | 3; at?: string; tags?: string[] }

/** `keepDraft`: what's typed survives leaving the screen or switching profile, until it's saved (the new-set form). */
/**
 * `when`: the set may have been done earlier — `always` shows the time field (a past day), otherwise "Did this earlier?" opens it.
 * `suggest` is asked when the field opens, so it reflects the clock then. An empty field means unknown.
 */
export function SetForm({ exercise, initial, submitLabel, onSubmit, onDelete, onCancel, keepDraft = false, when, day, hold: holdLift, heaviest = 0, tagPrefs, onTagPrefs, nextReps, weightStep = 5 }: {
  /** An empty weight (null) is for a lift with nothing to suggest from. */
  exercise: string; initial: Omit<SetFormValue, 'weight'> & { weight: number | null }; submitLabel: string;
  /** The heaviest working weight logged for this lift: over twice it asks once before saving. */
  heaviest?: number;
  /** Timed in seconds: a known hold, or a lift logged as one (the card knows the log; the name alone doesn't). */
  hold?: boolean;
  onSubmit: (v: SetFormValue) => Promise<boolean>; onDelete?: () => void; onCancel?: () => void; keepDraft?: boolean;
  /** The day this form logs to; defaults to today. */
  day?: string;
  when?: { suggest: () => string | null; always: boolean; max?: () => string | null }; // max: latest allowed HH:MM, null/absent = no limit
  /** The tag row as the person keeps it; with `onTagPrefs` it ends in Edit tags. */
  tagPrefs?: TagPrefs; onTagPrefs?: (t: TagPrefs) => void;
  /** After a set is saved: the reps the next set aims at (its own target), if it has one; else the reps stay as typed. */
  nextReps?: (saved: SetFormValue) => number | undefined;
  /** The weight stepper's step: the lift's learned rung when finer than 5 lb (a 2.5 stack is one tap), else 5. */
  weightStep?: number;
}) {
  const [owner] = useState(() => ({ profile: activeProfileDb(), date: day ?? localDate(new Date()) }));
  // One draft per lift per day, so a past day's half-typed set never lands in today's form.
  const draftKey = `${exercise}@${owner.date}`;
  const [d] = useState(() => (keepDraft ? getDraft<Draft>(owner.profile, draftKey, owner.date) : undefined));
  // A restored time reopens the field: `at` is only in the draft while it was open.
  const [whenOpen, setWhenOpen] = useState(!!when?.always || (!!when && d?.at !== undefined));
  const [time, setTime] = useState(() => d?.at ?? (when?.always ? when.suggest() ?? '' : ''));
  // After a late set on a past day, the next time is asked for once the saved set is in the log (a new `suggest`).
  const resuggest = useRef(false);
  useEffect(() => {
    if (!resuggest.current || !when?.always) return;
    resuggest.current = false;
    setTime(when.suggest() ?? '');
  }, [when?.suggest, when?.always]);
  const [weight, setWeight] = useState(d?.weight ?? (initial.weight == null ? '' : String(initial.weight)));
  const [reps, setReps] = useState(d?.reps ?? (initial.reps == null ? '' : String(initial.reps)));
  const [rir, setRir] = useState<number | undefined>(d ? d.rir : initial.rir);
  const [flags, setFlags] = useState<Flag[]>(d?.flags ?? initial.flags.filter((f) => f !== 'bodyweight' && f !== 'partial'));
  const [note, setNote] = useState(d?.note ?? initial.note ?? '');
  const [tags, setTags] = useState<string[]>(d?.tags ?? initial.tags ?? []);
  const [editTags, setEditTags] = useState(false);
  const [region, setRegion] = useState<Region | undefined>(() => (d ? d.region : painDefaults(initial, exercise).region));
  const [severity, setSeverity] = useState<1 | 2 | 3 | undefined>(() => (d ? d.severity : painDefaults(initial, exercise).severity));
  // Only a form the user has touched leaves a draft, so an untouched one keeps following the suggested next set.
  const dirty = useRef(d != null);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { dirty.current = true; set(v); };
  useEffect(() => {
    if (keepDraft && dirty.current) saveDraft<Draft>(owner.profile, draftKey, owner.date, { weight, reps, rir, flags, note, region, severity, tags, ...(whenOpen && { at: time }) });
  }, [keepDraft, owner, draftKey, weight, reps, rir, flags, note, region, severity, tags, whenOpen, time]);
  // An app update waits while any form has changes not saved yet (main.tsx).
  const formId = useId();
  useEffect(() => markDirty(formId, dirty.current));
  useEffect(() => () => markDirty(formId, false), [formId]);
  // Flags, pain, "Did this earlier?" and the note fold away; double_pulley persists between sets on purpose, so it doesn't hold the fold open.
  const used = flags.filter((f) => f !== 'double_pulley' && BUILT_IN.some(([t]) => t === f));
  const [moreOpen, setMoreOpen] = useState(() => used.length > 0 || tags.length > 0 || note !== '');
  const moreHint = [...BUILT_IN.filter(([f]) => used.includes(f)).map(([, l]) => l), ...tags, ...(note.trim() ? ['note'] : [])].join(', ');
  // A hidden built-in or a removed tag still shows on a set that has it, so it can be turned off.
  const hidden = tagPrefs?.hidden ?? [];
  const builtIns = BUILT_IN.filter(([f]) => !hidden.includes(f) || flags.includes(f));
  const own = [...(tagPrefs?.custom ?? []), ...tags.filter((t) => !tagPrefs?.custom.includes(t))];
  const hold = holdLift ?? isHold(exercise);
  const pain = flags.includes('pain');
  const w = Number(weight);
  const r = reps.trim() === '' ? null : Number(reps);
  // The time as first shown: a stored time already past "now" (a clock change) must not block fixing the weight.
  const [time0] = useState(d?.at !== undefined ? '' : time); // a time restored from a draft was typed, so it is checked
  const timeId = useId();
  // Asked on every render, so "now" stays current as the user types and as the minute moves.
  useMinute(whenOpen && !!when?.max);
  const latest = whenOpen ? when?.max?.() ?? null : null;
  const tooLate = !!time && time !== time0 && latest != null && time > latest;
  const unit = hold ? 'Seconds' : 'Reps';
  // Item 14: a lift whose load is the body takes help (an assisted machine, a band) as a weight below 0, and weight added above it.
  const body = !hold && bodyShare(exercise) != null;
  // Why Add set is off, said under the fields; a time later than now explains itself by the time field.
  const problem = weight.trim() === '' ? (body ? 'Enter a weight (0 for bodyweight, below 0 for help)' : 'Enter a weight (0 for bodyweight)')
    : !Number.isFinite(w) || (w < 0 && !body) ? 'Weight must be a number'
    : r !== null && (!Number.isInteger(r) || r < 0) ? `${unit} must be a whole number`
    : r !== null && r >= 1000 ? `${unit} go up to 999`
    : w === 0 && r === 0 ? `A set needs a weight or ${unit.toLowerCase()}`
    : null;
  const valid = !problem && !tooLate;
  // A new card's empty weight is help until the field is touched, not an error from the start (Add set stays off either way).
  const [loud, setLoud] = useState(false);
  const quiet = weight.trim() === '' && !loud;
  const busy = useRef(false);
  // A weight far over the best is asked about once; the same weight tapped again is kept.
  const [asked, setAsked] = useState<number | null>(null);
  const typo = heaviest > 0 && Number.isFinite(w) && w > heaviest * 2;
  const painBox = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pain) painBox.current?.scrollIntoView({ block: 'nearest' }); }, [pain]);

  async function submit() {
    if (!valid || busy.current) return;
    if (typo && asked !== w) { setAsked(w); return; }
    busy.current = true; // a fast double tap would otherwise log the set twice
    try {
      const withHold: Flag[] = hold && !flags.includes('hold') ? [...flags, 'hold'] : flags;
      const value: SetFormValue = {
        weight: w, reps: r, rir: rir ?? (flags.includes('test') ? 0 : undefined), flags: derivedFlags(withHold, w, r), note: note.trim() || undefined,
        painRegion: pain ? region : undefined, painSeverity: pain ? severity : undefined, tags: tags.length ? tags : undefined,
        ...(whenOpen && { at: time || null }),
      };
      const ok = await onSubmit(value);
      const next = ok ? nextReps?.(value) : undefined;
      if (next != null) setReps(String(next));
      if (ok && when) { if (when.always) resuggest.current = true; else setWhenOpen(false); }
      if (ok && keepDraft) { clearDraft(owner.profile, draftKey); dirty.current = false; }
      // A warm-up doesn't move the next set: back to what the card suggests (the last working set, else the target).
      if (ok && keepDraft && flags.includes('warmup')) { setWeight(initial.weight == null ? '' : String(initial.weight)); setReps(initial.reps == null ? '' : String(initial.reps)); }
      if (ok) { setLoud(false); setAsked(null); setNote(''); setFlags((f) => f.filter((x) => x === 'double_pulley')); setTags([]); setEditTags(false); setRir(undefined); setRegion(likelyRegion(exercise)); setSeverity(1); setMoreOpen(false); }
    } finally { busy.current = false; }
  }

  const whenField = when && whenOpen && (
    <div className="when">
      <label>When <Input type="time" aria-label="When" value={time} max={latest ?? undefined} aria-invalid={tooLate || undefined} aria-describedby={timeId} onChange={(e) => touch(setTime)(e.target.value)} /></label>
      <span id={timeId} className={tooLate ? 'small err' : 'muted small'}>{tooLate ? `Later than now (${latest})` : time ? 'A guess is fine' : 'Leave empty if you don’t know'}</span>
    </div>
  );

  return (
    <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Weight" value={weight} onChange={(v) => { setLoud(true); touch(setWeight)(v); }} step={weightStep} mode="decimal" min={body ? -Infinity : 0} />
        <Stepper label={unit} value={reps} onChange={touch(setReps)} step={hold ? 5 : 1} mode="numeric" />
      </div>
      {!problem && fmtPerSide(w, exercise) && <p className="small muted plates" aria-label="Per side">{fmtPerSide(w, exercise)}</p>}
      {!problem && body && w !== 0 && <p className="small muted plates" aria-label="Load">{w < 0 ? `BW − ${fmtWeight(-w)} lb: help` : `BW + ${fmtWeight(w)} lb`}</p>}
      {problem && <p role="status" className={quiet ? 'small muted' : 'small err'}>{problem}</p>}
      {!problem && typo && asked === w && <p role="status" className="small err">{weight} lb is {Math.round(w / heaviest)}× your best: tap {submitLabel.split(' ·')[0]} again to keep it</p>}
      {/* Reps in reserve doesn't apply to a timed hold. */}
      {!hold && <div className="chips seg" role="group" aria-label="RIR">
        <span className="chip-label">RIR</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button type="button" key={n} className="chip" aria-pressed={rir === n} onClick={() => touch(setRir)(rir === n ? undefined : n)}>{n === 4 ? '4+' : n}</button>
        ))}
      </div>}
      {/* Above the button once open, so a time that blocks Add set never hides behind the fold. */}
      {whenField}
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={!valid}>{submitLabel}</button>
      </div>
      <button type="button" className="chip more" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>{moreOpen || !moreHint ? 'Details' : `Details · ${moreHint}`}<Icon name="chev-down" size={18} sw={2} className="chev" /></button>
      {moreOpen && (
        <>
          <div className="chips" role="group" aria-label="Flags">
            {builtIns.map(([f, label]) => (
              <button type="button" key={f} className="chip" aria-pressed={flags.includes(f)} onClick={() => touch(setFlags)(flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f])}>{label}</button>
            ))}
            {own.map((t) => (
              <button type="button" key={`#${t}`} className="chip" aria-pressed={tags.includes(t)} onClick={() => touch(setTags)(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>
            ))}
            {onTagPrefs && <button type="button" className="chip edit-tags" aria-expanded={editTags} onClick={() => setEditTags(!editTags)}>Edit tags</button>}
          </div>
          {editTags && tagPrefs && onTagPrefs && <TagEditor prefs={tagPrefs} onChange={onTagPrefs} onDone={() => setEditTags(false)} />}
          {pain && (
            <div ref={painBox} className="pain-box">
              <div className="chips" role="group" aria-label="Pain region">
                <span className="chip-label">Where</span>
                {REGIONS.map((x) => <button type="button" key={x} className="chip" aria-pressed={region === x} onClick={() => touch(setRegion)(x)}>{cap(x)}</button>)}
              </div>
              <div className="chips" role="group" aria-label="Pain severity">
                <span className="chip-label">How bad</span>
                {SEVERITY.map(([n, label]) => <button type="button" key={n} className="chip" aria-pressed={severity === n} onClick={() => touch(setSeverity)(n)}>{label}</button>)}
              </div>
            </div>
          )}
          {when && !when.always && !whenOpen && <button type="button" className="chip" onClick={() => { setTime(when.suggest() ?? ''); setWhenOpen(true); }}>Did this earlier?</button>}
          <Input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => touch(setNote)(e.target.value)} />
        </>
      )}
      {/* Out of the Cancel/Save row, so a reach for Save can't delete; Undo still brings it back. */}
      {onDelete && <button type="button" className="mini danger form-delete" onClick={onDelete}>Delete</button>}
    </form>
  );
}
