import type { CSSProperties } from 'react';
import { Icon } from './icons';

/** A number with − and + either side. `min`: the lowest the buttons go (0 by default; incline can go below). */
export function Stepper({ label, value, onChange, step, mode, min = 0 }: { label: string; value: string; onChange: (v: string) => void; step: number; mode: 'decimal' | 'numeric'; min?: number }) {
  // How many digits wide the value is (a point is about half of one), so styles.css can size it to fit.
  const n = Math.max(2, value.length - 0.55 * (value.match(/[.,]/g)?.length ?? 0));
  const bump = (d: number) => { const n = Number(value) || 0; onChange(String(Math.max(min, Math.round((n + d) * 100) / 100))); };
  // A div, not a label: a tap on the caption would press the first button inside it (−).
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`${label} down`} onClick={() => bump(-step)}><Icon name="minus" size={22} sw={2.25} /></button>
        <input aria-label={label} inputMode={mode} style={{ '--n': n } as CSSProperties} value={value} onChange={(e) => onChange(e.target.value.replace(',', '.').replace('−', '-'))} />
        <button type="button" aria-label={`${label} up`} onClick={() => bump(step)}><Icon name="plus" size={22} sw={2.25} /></button>
      </div>
    </div>
  );
}
