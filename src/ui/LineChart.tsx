import { useState, type MouseEvent } from 'react';
import type { SeriesPoint } from '../domain/stats';
import { fmtDay, fmtWeight } from '../domain/format';
import { ChartTable } from './charts/ChartTable';

const W = 340, H = 180, L = 48, R = 10, T = 12, B = 26;
const t = (d: string) => new Date(d + 'T00:00:00').getTime();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// unit, noun and column come from the caller: a hold chart is seconds, with no 1RM in it.
export function LineChart({ points, today, label = 'Estimated 1RM over time', unit = 'lb', noun = 'e1RM', column = 'e1RM (lb)' }: {
  points: SeriesPoint[]; today: string; label?: string; unit?: string; noun?: string; column?: string;
}) {
  const [tap, setTap] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted">Log this lift on two days to see a trend.</p>;
  const xs = points.map((p) => t(p.date)), ys = points.map((p) => p.e1rm);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 5;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const mid = (y0 + y1) / 2;
  // Dots are too close for a thumb, so a tap anywhere on the chart picks the point nearest in x.
  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(X(x) - vx) < Math.abs(X(xs[best]) - vx)) best = i; });
    setTap(best);
  };
  const at = tap != null && tap < points.length ? tap : points.length - 1;
  const sel = points[at];
  const val = (v: number) => `${fmtWeight(Math.round(v))} ${unit}`;
  return (
    <>
      <p className="readout" aria-live="polite">{fmtDay(sel.date, today)} · {val(sel.e1rm)}{noun ? ` ${noun}` : ''}{sel.pr ? ' · PR' : ''}</p>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onClick={pick}>
        {[y0, mid, y1].map((y) => <line key={y} x1={L} x2={W - R} y1={Y(y)} y2={Y(y)} className="grid" />)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
        <text x={L - 8} y={T + 4} className="lbl" textAnchor="end">{val(y1)}</text>
        <text x={L - 8} y={Y(mid) + 4} className="lbl" textAnchor="end">{fmtWeight(Math.round(mid))}</text>
        <text x={L - 8} y={H - B - 2} className="lbl" textAnchor="end">{fmtWeight(Math.round(y0))}</text>
        <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
        <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.date)}</text>
        <polyline className="line" fill="none" points={points.map((p) => `${X(t(p.date))},${Y(p.e1rm)}`).join(' ')} />
        {points.map((p, i) => <circle key={p.date} cx={X(t(p.date))} cy={Y(p.e1rm)} r={i === at ? 6 : p.pr ? 5 : 4} className={`pt${p.pr ? ' pr' : ''}${i === at ? ' sel' : ''}`} />)}
      </svg>
      <ChartTable caption={label} head={['Date', column]} rows={[...points].reverse().map((p) => [fmtDay(p.date, today), fmtWeight(Math.round(p.e1rm))])} />
    </>
  );
}
