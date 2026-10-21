import { useState } from 'react';
import { fmtDay, plural } from '../../domain/format';

// Lightness only ever rises, neutral into the accent, so more sets reads as brighter on the dark surface and no step goes
// brown: oklch(0.301 0.008 264) · (0.441 0.009 261) · (0.580 0.013 270) · (0.720 0.125 76) · (0.859 0.130 82). Each step is
// ΔE×100 12.5 or more from the next, under protan, deutan and tritan simulation too.
export const STEPS = ['#2c2e32', '#505358', '#777a82', '#d1993e', '#fbc865'];
const step = (n: number) => (n === 0 ? 0 : n < 6 ? 1 : n < 12 ? 2 : n < 20 ? 3 : 4);
const C = 16, G = 3, LBL = 14, TOP = 16;
/** Weeks in one band: a year is four or five bands, one under another, so a day stays big enough to tap whatever the range. */
const BAND = 13;
/** How far a band's cells may grow past their drawn 16px: 12 weeks fill the width; 4 weeks don't stretch to it. */
const GROW = 1.45;
const month = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' });

/** Days as weeks (columns, Monday on top), in bands of up to 13 weeks, newest last. Tap a day for its sets. */
export function Calendar({ days, today, label = 'Training calendar, last 12 weeks' }: { days: { date: string; sets: number }[]; today: string; label?: string }) {
  const [sel, setSel] = useState<string | null>(null);
  // Pad the front so each column is a Monday–Sunday week.
  const pad = (new Date(days[0].date + 'T00:00:00').getDay() + 6) % 7;
  const cells = [...Array.from({ length: pad }, () => null), ...days];
  const cols = Math.ceil(cells.length / 7);
  const bands = Math.ceil(cols / BAND), per = Math.ceil(cols / bands);
  const picked = days.find((d) => d.date === sel);
  const x = (col: number) => LBL + col * (C + G);
  const width = x(per) - G, height = TOP + 7 * (C + G) - G;
  return (
    <>
      <div className="cal" role="img" aria-label={label}>
        {Array.from({ length: bands }, (_, b) => {
          const part = cells.slice(b * per * 7, (b + 1) * per * 7);
          const n = Math.ceil(part.length / 7);
          // A month label sits over the column holding its 1st; the first column is named too unless the next label is under two columns away.
          const labels: { col: number; text: string }[] = [];
          for (let c = 0; c < n; c++) {
            const first = part.slice(c * 7, c * 7 + 7).find((d) => d && d.date.endsWith('-01'));
            if (first) labels.push({ col: c, text: month(first.date) });
          }
          const lead = part.find((d) => d);
          if (lead && (!labels.length || labels[0].col >= 2)) labels.unshift({ col: 0, text: month(lead.date) });
          return (
            <svg key={b} className="chart" viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: `${Math.round(width * GROW)}px` }} aria-hidden="true">
              {[['M', 0], ['W', 2], ['F', 4]].map(([t, r]) => <text key={t} x={0} y={TOP + Number(r) * (C + G) + C - 4} className="lbl cal-lbl">{t}</text>)}
              {labels.map((l) => <text key={l.col} x={x(l.col)} y={TOP - 7} className="lbl cal-lbl">{l.text}</text>)}
              {part.map((d, i) => d && (
                <rect key={d.date} x={x(Math.floor(i / 7))} y={TOP + (i % 7) * (C + G)} width={C} height={C} rx={3}
                  fill={STEPS[step(d.sets)]} className={sel === d.date ? 'cell sel' : 'cell'} onClick={() => setSel(d.date)} />
              ))}
            </svg>
          );
        })}
      </div>
      <p className="readout cal-readout" aria-live="polite">{picked ? `${fmtDay(picked.date, today)}: ${plural(picked.sets, 'set')}` : 'Tap a day for its sets.'}</p>
      <div className="cal-legend" aria-hidden="true"><span>fewer</span>{STEPS.map((c) => <i key={c} style={{ background: c }} />)}<span>more sets</span></div>
    </>
  );
}
