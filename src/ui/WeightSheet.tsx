import { useRef, useState, type PointerEvent } from 'react';
import { proteinCheck, type BodyDay, type weightSummary } from '../domain/body';
import { fmtDay, fmtWeight, plural } from '../domain/format';
import { rangeWords, type Range } from '../domain/statsLayout';
import { ChartTable } from './charts/ChartTable';

// Stats › Body › Weight's sheet (IA A5, owner 2026-10-21): what the old Body weight card showed (deleted with Stats v2 S1, 8686b63),
// over the one range: the trend, the 4-week rate and its band, the weigh-ins and their trend on one chart (drag across to read a
// day), protein against 1.6 g/kg when MyFitnessPal brought it, and the bands it's read against. Yours only: friends never see it.

type Summary = NonNullable<ReturnType<typeof weightSummary>>;
const W = 340, H = 170, L = 40, R = 10, T = 12, B = 26;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

const OkIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
const WarnIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 1.8 15 14H1z" strokeLinejoin="round" /><path d="M8 6v4" /><circle cx="8" cy="12" r="0.6" fill="currentColor" /></svg>;

/** The trend (a line) through the weigh-ins (faint dots); a tap or a drag picks the nearest day. */
function WeightChart({ points, today, label }: { points: Summary['points']; today: string; label: string }) {
  const [tap, setTap] = useState<number | null>(null);
  const held = useRef<number | null>(null);
  const xs = points.map((p) => ms(p.date)), ys = points.flatMap((p) => [p.weight, p.trend]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 2;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(X(x) - vx) < Math.abs(X(xs[best]) - vx)) best = i; });
    setTap(best);
  };
  const at = tap != null && tap < points.length ? tap : points.length - 1;
  const sel = points[at];
  return (<>
    <p className="readout" aria-live="polite">{fmtDay(sel.date, today)} · weighed {fmtWeight(sel.weight)} lb · trend {sel.trend.toFixed(1)} lb</p>
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}
      onPointerDown={(e) => { held.current = e.pointerId; pick(e); }} onPointerMove={(e) => { if (held.current === e.pointerId) pick(e); }}
      onPointerUp={() => { held.current = null; }} onPointerCancel={() => { held.current = null; }}>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
      <text x={L - 8} y={T + 4} className="lbl" textAnchor="end">{Math.round(y1)}</text>
      <text x={L - 8} y={H - B - 2} className="lbl" textAnchor="end">{Math.round(y0)}</text>
      <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
      <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(points.at(-1)!.date)}</text>
      {points.map((p) => <circle key={p.date} cx={X(ms(p.date))} cy={Y(p.weight)} r={3} className="bw-pt" />)}
      {points.length > 1 && <polyline className="line" fill="none" points={points.map((p) => `${X(ms(p.date))},${Y(p.trend)}`).join(' ')} />}
      <line className="bw-sel" x1={X(ms(sel.date))} x2={X(ms(sel.date))} y1={T} y2={H - B} />
      <circle cx={X(ms(sel.date))} cy={Y(sel.trend)} r={5} className="pt pr" />
    </svg>
  </>);
}

export function WeightSheet({ s, body, today, range }: { s: Summary; body: readonly BodyDay[]; today: string; range: Range }) {
  const r = s.rate, band = s.band;
  const protein = proteinCheck([...body], s.last.trend, today);
  const label = `Body weight, last ${rangeWords(range)}: trend ${s.last.trend.toFixed(1)} lb`;
  return (<>
    <div className="st-dr-hero"><span className="st-dr-k">Trend · weighed {fmtDay(s.last.date, today)}</span><span className="st-dr-v"><b>{s.last.trend.toFixed(1)}</b> lb</span></div>
    {band && <p className={`bw-band ${band.tone}`}>{band.tone === 'ok' ? <OkIcon /> : <WarnIcon />} {band.label}</p>}
    <dl className="st-cells3">
      <div><dt>4-week rate</dt><dd>{r ? `${signed(r.lbPerWeek)} lb/wk` : '—'}</dd></div>
      <div><dt>Of body weight</dt><dd>{r ? `${signed(r.pctPerWeek, 2)} %/wk` : '—'}</dd></div>
      <div><dt>Weigh-ins</dt><dd>{s.count}</dd></div>
    </dl>
    {!r && <p className="muted small">Two weeks of weigh-ins give a rate.</p>}
    {s.points.length > 0 ? <WeightChart points={s.points} today={today} label={label} /> : <p className="muted small">No weigh-ins in the last {rangeWords(range)}.</p>}
    {protein && <p className="small">Protein, last {protein.days === 1 ? 'day' : `${protein.days} days`}: <b>{protein.avg} g/day</b> <span className="muted">· about {protein.target} g covers most of the muscle-building benefit (1.6 g/kg)</span></p>}
    <p className="muted small">The line is the trend: each weigh-in moves it a tenth of the way, so one heavy morning barely shifts it. Bands, in % of body weight a week: lean gain about 0.25–0.5, cutting about 0.5–1. Context, not advice. Only you see this; friends never do.</p>
    {s.points.length > 0 && <ChartTable caption={`Weigh-ins and trend (lb), last ${plural(s.points.length, 'weigh-in')}`} head={['Date', 'Weighed / trend']}
      rows={[...s.points].reverse().map((p) => [p.date, `${fmtWeight(p.weight)} / ${p.trend.toFixed(1)}`])} />}
  </>);
}
