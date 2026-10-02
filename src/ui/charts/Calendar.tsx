import { useState } from 'react';
import { fmtDay, plural } from '../../domain/format';

// One hue, dark → bright amber: more sets reads as brighter on the dark surface.
export const STEPS = ['#2a2f3a', '#5c4a1f', '#8a6a24', '#b98a2b', '#f5b83d'];
const step = (n: number) => (n === 0 ? 0 : n < 6 ? 1 : n < 12 ? 2 : n < 20 ? 3 : 4);
const C = 16, G = 3, LBL = 14, TOP = 13;
const month = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' });

export function Calendar({ days, today }: { days: { date: string; sets: number }[]; today: string }) {
  const [sel, setSel] = useState<string | null>(null);
  // Pad the front so each column is a Monday–Sunday week.
  const pad = (new Date(days[0].date + 'T00:00:00').getDay() + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...days];
  const cols = Math.ceil(cells.length / 7);
  const picked = days.find((d) => d.date === sel);
  // A month label sits over the column holding its 1st; the first column is named too unless the next label is under two columns away.
  const labels: { col: number; text: string }[] = [];
  for (let c = 0; c < cols; c++) {
    const first = cells.slice(c * 7, c * 7 + 7).find((d) => d && d.date.endsWith('-01'));
    if (first) labels.push({ col: c, text: month(first.date) });
  }
  if (!labels.length || labels[0].col >= 2) labels.unshift({ col: 0, text: month(days[0].date) });
  const x = (col: number) => LBL + col * (C + G);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${x(cols) - G} ${TOP + 7 * (C + G) - G}`} width="100%" role="img" aria-label="Training calendar, last 12 weeks">
        {[['M', 0], ['W', 2], ['F', 4]].map(([t, r]) => <text key={t} x={0} y={TOP + Number(r) * (C + G) + C - 4} className="lbl cal-lbl">{t}</text>)}
        {labels.map((l) => <text key={l.col} x={x(l.col)} y={TOP - 4} className="lbl cal-lbl">{l.text}</text>)}
        {cells.map((d, i) => d && (
          <rect key={d.date} x={x(Math.floor(i / 7))} y={TOP + (i % 7) * (C + G)} width={C} height={C} rx={3}
            fill={STEPS[step(d.sets)]} className={sel === d.date ? 'cell sel' : 'cell'} onClick={() => setSel(d.date)} />
        ))}
      </svg>
      <p className="readout" aria-live="polite">{picked ? `${fmtDay(picked.date, today)}: ${plural(picked.sets, 'set')}` : 'Tap a day for its sets.'}</p>
      <div className="cal-legend" aria-hidden="true"><span>fewer</span>{STEPS.map((c) => <i key={c} style={{ background: c }} />)}<span>more sets</span></div>
    </>
  );
}
