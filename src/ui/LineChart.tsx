import type { SeriesPoint } from '../domain/stats';
import { fmtWeight } from '../domain/format';

const W = 340, H = 180, L = 40, R = 10, T = 12, B = 26;
const t = (d: string) => new Date(d + 'T00:00:00').getTime();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function LineChart({ points, label = 'Estimated 1RM over time' }: { points: SeriesPoint[]; label?: string }) {
  if (points.length < 2) return <p className="muted">Log this lift on two days to see a trend.</p>;
  const xs = points.map((p) => t(p.date)), ys = points.map((p) => p.e1rm);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.05 || 5;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
      <text x={L - 8} y={T + 4} className="lbl" textAnchor="end">{fmtWeight(Math.round(y1))}</text>
      <text x={L - 8} y={H - B - 2} className="lbl" textAnchor="end">{fmtWeight(Math.round(y0))}</text>
      <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
      <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.date)}</text>
      <polyline className="line" fill="none" points={points.map((p) => `${X(t(p.date))},${Y(p.e1rm)}`).join(' ')} />
      {points.map((p) => <circle key={p.date} cx={X(t(p.date))} cy={Y(p.e1rm)} r={p.pr ? 5 : 4} className={p.pr ? 'pt pr' : 'pt'}><title>{`${p.date}: ${Math.round(p.e1rm)}`}</title></circle>)}
    </svg>
  );
}
