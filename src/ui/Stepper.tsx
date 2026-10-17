/** A number with − and + either side. `min`: the lowest the buttons go (0 by default; incline can go below). */
export function Stepper({ label, value, onChange, step, mode, min = 0 }: { label: string; value: string; onChange: (v: string) => void; step: number; mode: 'decimal' | 'numeric'; min?: number }) {
  const bump = (d: number) => { const n = Number(value) || 0; onChange(String(Math.max(min, Math.round((n + d) * 100) / 100))); };
  return (
    <label className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label} down`} onClick={() => bump(-step)}>−</button>
        <input aria-label={label} inputMode={mode} value={value} onChange={(e) => onChange(e.target.value.replace(',', '.').replace('−', '-'))} />
        <button type="button" aria-label={`${label} up`} onClick={() => bump(step)}>+</button>
      </div>
    </label>
  );
}
