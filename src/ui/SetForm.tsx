import { useEffect, useId, useRef, useState } from 'react';
import { activeProfileDb } from '../db/db';
import { localDate } from '../domain/ids';
import { clearDraft, getDraft, saveDraft } from '../state/drafts';
import { REGIONS, type Flag, type Region } from '../domain/types';
import { derivedFlags } from '../domain/buildSet';
import { isHold, likelyRegion, painDefaults } from '../domain/care';

export interface SetFormValue { weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string; painRegion?: Region; painSeverity?: 1 | 2 | 3; at?: string | null }
const SEVERITY: [1 | 2 | 3, string][] = [[1, 'Mild'], [2, 'Moderate'], [3, 'Sharp']];
const cap = (r: string) => r[0].toUpperCase() + r.slice(1);
const TOGGLES: [Flag, string][] = [['pain', 'Pain'], ['unsure', 'Unsure'], ['warmup', 'Warm-up'], ['double_pulley', '2× pulley'], ['test', 'Test']];

function Stepper({ label, value, onChange, step, mode }: { label: string; value: string; onChange: (v: string) => void; step: number; mode: 'decimal' | 'numeric' }) {
  const bump = (d: number) => { const n = Number(value) || 0; onChange(String(Math.max(0, Math.round((n + d) * 100) / 100))); };
  return (
    <label className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label} down`} onClick={() => bump(-step)}>−</button>
        <input aria-label={label} inputMode={mode} value={value} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
        <button type="button" aria-label={`${label} up`} onClick={() => bump(step)}>+</button>
      </div>
    </label>
  );
}

interface Draft { weight: string; reps: string; rir?: number; flags: Flag[]; note: string; region?: Region; severity?: 1 | 2 | 3 }

/** `keepDraft`: what's typed survives leaving the screen or switching profile, until it's saved (the new-set form). */
/**
 * `when`: the set may have been done earlier — `always` shows the time field (a past day), otherwise "Did this earlier?" opens it.
 * `suggest` is asked when the field opens, so it reflects the clock then. An empty field means unknown.
 */
export function SetForm({ exercise, initial, submitLabel, onSubmit, onDelete, onCancel, keepDraft = false, when, day, hold: holdLift }: {
  exercise: string; initial: SetFormValue; submitLabel: string;
  /** Timed in seconds: a known hold, or a lift logged as one (the card knows the log; the name alone doesn't). */
  hold?: boolean;
  onSubmit: (v: SetFormValue) => Promise<boolean>; onDelete?: () => void; onCancel?: () => void; keepDraft?: boolean;
  /** The day this form logs to; defaults to today. */
  day?: string;
  when?: { suggest: () => string | null; always: boolean; max?: () => string | null }; // max: latest allowed HH:MM, null/absent = no limit
}) {
  const [whenOpen, setWhenOpen] = useState(!!when?.always);
  const [time, setTime] = useState(() => (when?.always ? when.suggest() ?? '' : ''));
  // After a late set on a past day, the next time is asked for once the saved set is in the log (a new `suggest`).
  const resuggest = useRef(false);
  useEffect(() => {
    if (!resuggest.current || !when?.always) return;
    resuggest.current = false;
    setTime(when.suggest() ?? '');
  }, [when?.suggest, when?.always]);
  const [owner] = useState(() => ({ profile: activeProfileDb(), date: day ?? localDate(new Date()) }));
  // One draft per lift per day, so a past day's half-typed set never lands in today's form.
  const draftKey = `${exercise}@${owner.date}`;
  const [d] = useState(() => (keepDraft ? getDraft<Draft>(owner.profile, draftKey, owner.date) : undefined));
  const [weight, setWeight] = useState(d?.weight ?? String(initial.weight));
  const [reps, setReps] = useState(d?.reps ?? (initial.reps == null ? '' : String(initial.reps)));
  const [rir, setRir] = useState<number | undefined>(d ? d.rir : initial.rir);
  const [flags, setFlags] = useState<Flag[]>(d?.flags ?? initial.flags.filter((f) => f !== 'bodyweight' && f !== 'partial'));
  const [note, setNote] = useState(d?.note ?? initial.note ?? '');
  const [region, setRegion] = useState<Region | undefined>(() => (d ? d.region : painDefaults(initial, exercise).region));
  const [severity, setSeverity] = useState<1 | 2 | 3 | undefined>(() => (d ? d.severity : painDefaults(initial, exercise).severity));
  // Only a form the user has touched leaves a draft, so an untouched one keeps following the suggested next set.
  const dirty = useRef(d != null);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { dirty.current = true; set(v); };
  useEffect(() => {
    if (keepDraft && dirty.current) saveDraft<Draft>(owner.profile, draftKey, owner.date, { weight, reps, rir, flags, note, region, severity });
  }, [keepDraft, owner, draftKey, weight, reps, rir, flags, note, region, severity]);
  // Flags, pain, "Did this earlier?" and the note fold away; double_pulley persists between sets on purpose, so it doesn't hold the fold open.
  const used = flags.filter((f) => f !== 'double_pulley' && TOGGLES.some(([t]) => t === f));
  const [moreOpen, setMoreOpen] = useState(() => used.length > 0 || note !== '');
  const moreHint = [...TOGGLES.filter(([f]) => used.includes(f)).map(([, l]) => l), ...(note.trim() ? ['note'] : [])].join(', ');
  const hold = holdLift ?? isHold(exercise);
  const pain = flags.includes('pain');
  const w = Number(weight);
  const r = reps.trim() === '' ? null : Number(reps);
  // The time as first shown: a stored time already past "now" (a clock change) must not block fixing the weight.
  const [time0] = useState(time);
  const timeId = useId();
  // Asked on every render, so "now" stays current as the user types.
  const latest = whenOpen ? when?.max?.() ?? null : null;
  const tooLate = !!time && time !== time0 && latest != null && time > latest;
  const valid = weight.trim() !== '' && Number.isFinite(w) && w >= 0 && (r === null || (Number.isInteger(r) && r >= 0 && r < 1000)) && !tooLate;
  const busy = useRef(false);

  async function submit() {
    if (!valid || busy.current) return;
    busy.current = true; // a fast double tap would otherwise log the set twice
    try {
      const withHold: Flag[] = hold && !flags.includes('hold') ? [...flags, 'hold'] : flags;
      const ok = await onSubmit({
        weight: w, reps: r, rir: rir ?? (flags.includes('test') ? 0 : undefined), flags: derivedFlags(withHold, w, r), note: note.trim() || undefined,
        painRegion: pain ? region : undefined, painSeverity: pain ? severity : undefined,
        ...(whenOpen && { at: time || null }),
      });
      if (ok && when) { if (when.always) resuggest.current = true; else setWhenOpen(false); }
      if (ok && keepDraft) { clearDraft(owner.profile, draftKey); dirty.current = false; }
      if (ok) { setNote(''); setFlags((f) => f.filter((x) => x === 'double_pulley')); setRir(undefined); setRegion(likelyRegion(exercise)); setSeverity(1); setMoreOpen(false); }
    } finally { busy.current = false; }
  }

  const whenField = when && whenOpen && (
    <div className="when">
      <label>When <input type="time" aria-label="When" value={time} max={latest ?? undefined} aria-invalid={tooLate || undefined} aria-describedby={timeId} onChange={(e) => setTime(e.target.value)} /></label>
      <span id={timeId} className={tooLate ? 'small err' : 'muted small'}>{tooLate ? `Later than now (${latest})` : time ? 'A guess is fine' : 'Leave empty if you don’t know'}</span>
    </div>
  );

  return (
    <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Weight" value={weight} onChange={touch(setWeight)} step={5} mode="decimal" />
        <Stepper label={hold ? 'Seconds' : 'Reps'} value={reps} onChange={touch(setReps)} step={hold ? 5 : 1} mode="numeric" />
      </div>
      <div className="chips" role="group" aria-label="RIR">
        <span className="chip-label">RIR</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button type="button" key={n} className="chip" aria-pressed={rir === n} onClick={() => touch(setRir)(rir === n ? undefined : n)}>{n === 4 ? '4+' : n}</button>
        ))}
      </div>
      {/* Above the button once open, so a time that blocks Add set never hides behind the fold. */}
      {whenField}
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        {onDelete && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="submit" className="primary" disabled={!valid}>{submitLabel}</button>
      </div>
      <button type="button" className="chip more" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>{moreOpen || !moreHint ? 'More' : `More · ${moreHint}`}</button>
      {moreOpen && (
        <>
          <div className="chips" role="group" aria-label="Flags">
            {TOGGLES.map(([f, label]) => (
              <button type="button" key={f} className="chip" aria-pressed={flags.includes(f)} onClick={() => touch(setFlags)(flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f])}>{label}</button>
            ))}
          </div>
          {pain && (
            <>
              <div className="chips" role="group" aria-label="Pain region">
                <span className="chip-label">Where</span>
                {REGIONS.map((x) => <button type="button" key={x} className="chip" aria-pressed={region === x} onClick={() => touch(setRegion)(x)}>{cap(x)}</button>)}
              </div>
              <div className="chips" role="group" aria-label="Pain severity">
                <span className="chip-label">How bad</span>
                {SEVERITY.map(([n, label]) => <button type="button" key={n} className="chip" aria-pressed={severity === n} onClick={() => touch(setSeverity)(n)}>{label}</button>)}
              </div>
            </>
          )}
          {when && !when.always && !whenOpen && <button type="button" className="chip" onClick={() => { setTime(when.suggest() ?? ''); setWhenOpen(true); }}>Did this earlier?</button>}
          <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => touch(setNote)(e.target.value)} />
        </>
      )}
    </form>
  );
}
