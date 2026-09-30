import { useState } from 'react';
import { proteinCheck, rate, rateBand, trend } from '../domain/body';
import type { BodyStore } from '../state/useBody';
import { fmtWeight } from '../domain/format';
import { ChartTable } from './charts/ChartTable';

const W = 340, H = 170, L = 40, R = 10, T = 12, B = 26;
const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

const OkIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
const WarnIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 1.8 15 14H1z" strokeLinejoin="round" /><path d="M8 6v4" /><circle cx="8" cy="12" r="0.6" fill="currentColor" /></svg>;

/** Trend (amber line) through daily weigh-ins (muted dots); last 90 days. */
function BodyChart({ points }: { points: { date: string; weight: number; trend: number }[] }) {
  const [tap, setTap] = useState<number | null>(null);
  const xs = points.map((p) => ms(p.date)), ys = points.flatMap((p) => [p.weight, p.trend]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const pad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 2;
  const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
  const X = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const last = points.at(-1)!;
  const sel = tap == null ? null : points[tap];
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Body weight, ${md(points[0].date)} to ${md(last.date)}: trend ${fmtWeight(Math.round(last.trend * 10) / 10)} lb`}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
        <text x={L - 8} y={T + 4} className="lbl" textAnchor="end">{Math.round(y1)}</text>
        <text x={L - 8} y={H - B - 2} className="lbl" textAnchor="end">{Math.round(y0)}</text>
        <text x={L} y={H - 6} className="lbl">{md(points[0].date)}</text>
        <text x={W - R} y={H - 6} className="lbl" textAnchor="end">{md(last.date)}</text>
        {points.map((p) => (
          <circle key={p.date} cx={X(ms(p.date))} cy={Y(p.weight)} r={3} className="bw-pt" />
        ))}
        {points.length > 1 && <polyline className="line" fill="none" points={points.map((p) => `${X(ms(p.date))},${Y(p.trend)}`).join(' ')} />}
        {sel && <line className="bw-sel" x1={X(ms(sel.date))} x2={X(ms(sel.date))} y1={T} y2={H - B} />}
        {points.map((p, i) => (
          <rect key={p.date} x={X(ms(p.date)) - 8} y={T} width={16} height={H - T - B} fill="transparent" onClick={() => setTap(i === tap ? null : i)} />
        ))}
      </svg>
      <p className="muted small">{sel ? `${md(sel.date)}: weighed ${fmtWeight(sel.weight)} lb · trend ${sel.trend.toFixed(1)} lb` : 'Line: trend (smoothed). Dots: weigh-ins. Tap for a day.'}</p>
    </>
  );
}

export function BodyCard({ body, today }: { body: BodyStore; today: string }) {
  const t = trend(body.days);
  const recent = t.filter((p) => ms(p.date) >= ms(today) - 90 * 864e5);
  const r = rate(t);
  const band = r ? rateBand(r.pctPerWeek) : null;
  const protein = t.length ? proteinCheck(body.days, t.at(-1)!.trend, today) : null;
  return (
    <section className="card" aria-labelledby="body-h">
      <h2 id="body-h">Body weight</h2>
      {!t.length ? <p className="muted">Weigh in on the Today tab, or import MyFitnessPal’s export on the Data tab.</p> : (<>
        <div className="tiles">
          <div className="tile"><span>Trend</span><b>{t.at(-1)!.trend.toFixed(1)} lb</b></div>
          <div className="tile"><span>4-week rate</span><b>{r ? `${signed(r.lbPerWeek)} lb` : '—'}</b>{r && <span>lb/week · {signed(r.pctPerWeek, 2)} % of body weight</span>}</div>
        </div>
        {band && <p className={`bw-band ${band.tone}`}>{band.tone === 'ok' ? <OkIcon /> : <WarnIcon />} {band.label}</p>}
        {!r && <p className="muted small">Two weeks of weigh-ins give a rate.</p>}
        {recent.length > 0 && <BodyChart points={recent} />}
        {protein && <p className="small">Protein, last {protein.days === 1 ? 'day' : `${protein.days} days`}: <b>{protein.avg} g/day</b> <span className="muted">· about {protein.target} g covers most of the muscle-building benefit (1.6 g/kg)</span></p>}
        <p className="muted small">Bands: lean gain ≈ 0.25–0.5 %/week, cutting ≈ 0.5–1 %/week. Context, not advice.</p>
        <ChartTable caption="Weigh-ins and trend (lb)" head={['Date', 'Weighed / trend']}
          rows={[...recent].reverse().map((p) => [p.date, `${fmtWeight(p.weight)} / ${p.trend.toFixed(1)}`])} />
      </>)}
    </section>
  );
}
