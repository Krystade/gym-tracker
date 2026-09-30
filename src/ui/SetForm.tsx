import { useState } from 'react';
import { REGIONS, type Flag, type Region } from '../domain/types';
import { derivedFlags } from '../domain/buildSet';
import { isHold, likelyRegion } from '../domain/care';

export interface SetFormValue { weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string; painRegion?: Region; painSeverity?: 1 | 2 | 3 }
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

export function SetForm({ exercise, initial, submitLabel, onSubmit, onDelete, onCancel }: {
  exercise: string; initial: SetFormValue; submitLabel: string;
  onSubmit: (v: SetFormValue) => Promise<boolean>; onDelete?: () => void; onCancel?: () => void;
}) {
  const [weight, setWeight] = useState(String(initial.weight));
  const [reps, setReps] = useState(initial.reps == null ? '' : String(initial.reps));
  const [rir, setRir] = useState<number | undefined>(initial.rir);
  const [flags, setFlags] = useState<Flag[]>(initial.flags.filter((f) => f !== 'bodyweight' && f !== 'partial'));
  const [note, setNote] = useState(initial.note ?? '');
  const [region, setRegion] = useState<Region>(initial.painRegion ?? likelyRegion(exercise));
  const [severity, setSeverity] = useState<1 | 2 | 3>(initial.painSeverity ?? 1);
  const hold = isHold(exercise);
  const pain = flags.includes('pain');
  const w = Number(weight);
  const r = reps.trim() === '' ? null : Number(reps);
  const valid = weight.trim() !== '' && Number.isFinite(w) && w >= 0 && (r === null || (Number.isInteger(r) && r >= 0 && r < 1000));

  async function submit() {
    if (!valid) return;
    const withHold: Flag[] = hold && !flags.includes('hold') ? [...flags, 'hold'] : flags;
    const ok = await onSubmit({
      weight: w, reps: r, rir: rir ?? (flags.includes('test') ? 0 : undefined), flags: derivedFlags(withHold, w, r), note: note.trim() || undefined,
      painRegion: pain ? region : undefined, painSeverity: pain ? severity : undefined,
    });
    if (ok) { setNote(''); setFlags((f) => f.filter((x) => x === 'double_pulley')); setRir(undefined); setRegion(likelyRegion(exercise)); setSeverity(1); }
  }

  return (
    <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Weight" value={weight} onChange={setWeight} step={5} mode="decimal" />
        <Stepper label={hold ? 'Seconds' : 'Reps'} value={reps} onChange={setReps} step={hold ? 5 : 1} mode="numeric" />
      </div>
      <div className="chips" role="group" aria-label="RIR">
        <span className="chip-label">RIR</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button type="button" key={n} className="chip" aria-pressed={rir === n} onClick={() => setRir(rir === n ? undefined : n)}>{n === 4 ? '4+' : n}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Flags">
        {TOGGLES.map(([f, label]) => (
          <button type="button" key={f} className="chip" aria-pressed={flags.includes(f)} onClick={() => setFlags(flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f])}>{label}</button>
        ))}
      </div>
      {pain && (
        <>
          <div className="chips" role="group" aria-label="Pain region">
            <span className="chip-label">Where</span>
            {REGIONS.map((x) => <button type="button" key={x} className="chip" aria-pressed={region === x} onClick={() => setRegion(x)}>{cap(x)}</button>)}
          </div>
          <div className="chips" role="group" aria-label="Pain severity">
            <span className="chip-label">How bad</span>
            {SEVERITY.map(([n, label]) => <button type="button" key={n} className="chip" aria-pressed={severity === n} onClick={() => setSeverity(n)}>{label}</button>)}
          </div>
        </>
      )}
      <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        {onDelete && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="submit" className="primary" disabled={!valid}>{submitLabel}</button>
      </div>
    </form>
  );
}
