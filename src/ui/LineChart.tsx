import { useRef, useState, type PointerEvent } from 'react';
import type { SeriesPoint } from '../domain/stats';
import { fmtDay, fmtWeight } from '../domain/format';
import { ChartTable } from './charts/ChartTable';

const W = 340, H = 180, L = 48, R = 10, T = 12, B = 26;
const t = (d: string) => new Date(d + 'T00:00:00').getTime();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * The value axis: bounds on whole steps of what the labels show (tenths under 10 with `tenths`, else whole numbers), an even
 * number of steps apart, so the bottom, middle and top ticks never read the same. Positive values never get a negative axis.
 */
export function yAxis(ys: number[], tenths: boolean): { y0: number; y1: number; fmt: (v: number) => string } {
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const k = tenths && hi < 10 ? 10 : 1; // steps per unit
  const pad = (hi - lo) * 0.05;
  let a = Math.floor((lo - pad) * k + 1e-9), b = Math.ceil((hi + pad) * k - 1e-9);
  if (lo >= 0) a = Math.max(0, a);
  if (b - a < 2) { a -= 1; b += 1; if (lo >= 0 && a < 0) { b -= a; a = 0; } }
  if ((b - a) % 2) b += 1;
  return { y0: a / k, y1: b / k, fmt: k > 1 ? (v) => v.toFixed(1) : (v) => fmtWeight(Math.round(v)) };
}

// unit, noun and column come from the caller: a hold chart is seconds, with no 1RM in it. `tenths`: distances.
export function LineChart({ points, today, label = 'Estimated 1RM over time', unit = 'lb', noun = 'e1RM', column = 'e1RM (lb)', what = 'this lift', tenths = false }: {
  points: SeriesPoint[]; today: string; label?: string; unit?: string; noun?: string; column?: string; what?: string; tenths?: boolean;
}) {
  const [tap, setTap] = useState<number | null>(null);
  const held = useRef<number | null>(null);
  if (points.length < 2) return <p className="muted">Log {what} on two days to see a trend.</p>;
  const xs = points.map((p) => t(p.date)), ys = points.map((p) => p.e1rm);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const { y0, y1, fmt } = yAxis(ys, tenths);
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const mid = (y0 + y1) / 2;
  // Dots are too close for a thumb, so a tap anywhere on the chart picks the point nearest in x, and a drag across it scrubs
  // (the chart is touch-action: pan-y, so a sideways drag is the chart's and an up-and-down one still scrolls).
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(X(x) - vx) < Math.abs(X(xs[best]) - vx)) best = i; });
    setTap(best);
  };
  const at = tap != null && tap < points.length ? tap : points.length - 1;
  const sel = points[at];
  // The axis may round to whole steps; a point's own value keeps its tenths.
  const one = (v: number) => (tenths && v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : fmt(v));
  const val = (v: number) => `${one(v)} ${unit}`;
  return (
    <>
      <p className="readout" aria-live="polite">{fmtDay(sel.date, today)} · {val(sel.e1rm)}{noun ? ` ${noun}` : ''}{sel.pr ? ' · PR' : ''}</p>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}
        onPointerDown={(e) => { held.current = e.pointerId; pick(e); }} onPointerMove={(e) => { if (held.current === e.pointerId) pick(e); }}
        onPointerUp={() => { held.current = null; }} onPointerCancel={() => { held.current = null; }}>
        {[y0, mid, y1].map((y) => <line key={y} x1={L} x2={W - R} y1={Y(y)} y2={Y(y)} className="grid" />)}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
        <text x={L - 8} y={T + 4} className="lbl" textAnchor="end">{val(y1)}</text>
        <text x={L - 8} y={Y(mid) + 4} className="lbl" textAnchor="end">{fmt(mid)}</text>
        <text x={L - 8} y={H - B - 2} className="lbl" textAnchor="end">{fmt(y0)}</text>
        <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
        <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.date)}</text>
        <polyline className="line" fill="none" points={points.map((p) => `${X(t(p.date))},${Y(p.e1rm)}`).join(' ')} />
        {points.map((p, i) => <circle key={p.date} cx={X(t(p.date))} cy={Y(p.e1rm)} r={i === at ? 6 : p.pr ? 5 : 4} className={`pt${p.pr ? ' pr' : ''}${i === at ? ' sel' : ''}`} />)}
      </svg>
      <ChartTable caption={label} head={['Date', column]} rows={[...points].reverse().map((p) => [fmtDay(p.date, today), one(p.e1rm)])} />
    </>
  );
}
