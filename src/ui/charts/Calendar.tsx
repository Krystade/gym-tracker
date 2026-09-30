import { useState } from 'react';
import { fmtDate, plural } from '../../domain/format';

// One hue, dark → bright amber: more sets reads as brighter on the dark surface.
export const STEPS = ['#2a2f3a', '#5c4a1f', '#8a6a24', '#b98a2b', '#f5b83d'];
const step = (n: number) => (n === 0 ? 0 : n < 6 ? 1 : n < 12 ? 2 : n < 20 ? 3 : 4);
const C = 14, G = 3;

export function Calendar({ days }: { days: { date: string; sets: number }[] }) {
  const [sel, setSel] = useState<string | null>(null);
  // Pad the front so each column is a Monday–Sunday week.
  const pad = (new Date(days[0].date + 'T00:00:00').getDay() + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...days];
  const cols = Math.ceil(cells.length / 7);
  const picked = days.find((d) => d.date === sel);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${cols * (C + G) - G} ${7 * (C + G) - G}`} width="100%" role="img" aria-label="Training calendar, last 16 weeks">
        {cells.map((d, i) => d && (
          <rect key={d.date} x={Math.floor(i / 7) * (C + G)} y={(i % 7) * (C + G)} width={C} height={C} rx={3}
            fill={STEPS[step(d.sets)]} className={sel === d.date ? 'cell sel' : 'cell'} onClick={() => setSel(d.date)} />
        ))}
      </svg>
      <p className="readout" aria-live="polite">{picked ? `${fmtDate(picked.date)}: ${plural(picked.sets, 'set')}` : 'Tap a day for its sets.'}</p>
      <div className="cal-legend" aria-hidden="true"><span>fewer</span>{STEPS.map((c) => <i key={c} style={{ background: c }} />)}<span>more sets</span></div>
    </>
  );
}
