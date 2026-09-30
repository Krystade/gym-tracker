import { useState } from 'react';
import type { Flag } from '../domain/types';
import { derivedFlags } from '../domain/buildSet';

export interface SetFormValue { weight: number; reps: number | null; rir?: number; flags: Flag[]; note?: string }
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

export function SetForm({ initial, submitLabel, onSubmit, onDelete, onCancel }: {
  initial: SetFormValue; submitLabel: string;
  onSubmit: (v: SetFormValue) => Promise<boolean>; onDelete?: () => void; onCancel?: () => void;
}) {
  const [weight, setWeight] = useState(String(initial.weight));
  const [reps, setReps] = useState(initial.reps == null ? '' : String(initial.reps));
  const [rir, setRir] = useState<number | undefined>(initial.rir);
  const [flags, setFlags] = useState<Flag[]>(initial.flags.filter((f) => f !== 'bodyweight' && f !== 'partial'));
  const [note, setNote] = useState(initial.note ?? '');
  const w = Number(weight);
  const r = reps.trim() === '' ? null : Number(reps);
  const valid = weight.trim() !== '' && Number.isFinite(w) && w >= 0 && (r === null || (Number.isInteger(r) && r >= 0 && r < 1000));

  async function submit() {
    if (!valid) return;
    const ok = await onSubmit({ weight: w, reps: r, rir: rir ?? (flags.includes('test') ? 0 : undefined), flags: derivedFlags(flags, w, r), note: note.trim() || undefined });
    if (ok) { setNote(''); setFlags((f) => f.filter((x) => x === 'double_pulley')); setRir(undefined); }
  }

  return (
    <form className="set-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="steppers">
        <Stepper label="Weight" value={weight} onChange={setWeight} step={5} mode="decimal" />
        <Stepper label="Reps" value={reps} onChange={setReps} step={1} mode="numeric" />
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
      <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="form-actions">
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
        {onDelete && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="submit" className="primary" disabled={!valid}>{submitLabel}</button>
      </div>
    </form>
  );
}
