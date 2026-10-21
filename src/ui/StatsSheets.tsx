import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { fmtDay, plural } from '../domain/format';
import { liftTrend } from '../domain/feed';
import { rotationReason, type Rotation } from '../domain/rotation';
import { rangeDays, rangeFrom, rangeWords, type Range } from '../domain/statsLayout';
import {
  familyRates, liftsInRotation, PR_GROUPS, rateOfGain, RIR_BINS, type Balance, type Effort, type Energy, type HitRate, type LiftRotation, type LiftState,
  type PrDot, type PrGroup, type Rests, type When,
} from '../domain/statsTiles';
import type { SetEntry } from '../domain/types';
import { ChartTable } from './charts/ChartTable';
import { Icon } from './icons';

// Stats v2 S2's sheets and the mini visuals of their tiles (plan §2). Charts here are HTML bars and dots, labelled in words beside
// them: columns and bars start at zero, nothing is dashed, a status colour always has a word or an arrow with it, and every
// sheet has its Table. Times of day are only ever an hour (owner: by day only, the usual start hour is fine).

// ---- Words for numbers ----

const f1 = (n: number) => n.toFixed(1);
/** Seconds as m:ss. */
export const mss = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
/** A signed number, one decimal (or `d`), with a real minus. */
export const signed = (n: number, d = 1) => { const r = Number(n.toFixed(d)); return r === 0 ? (0).toFixed(d) : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(d)}`; };
/** An hour of the day as the phone says it ("5 PM"), rounded to the nearest hour. */
export const hourLabel = (h: number) => new Date(2026, 0, 5, Math.round(h) % 24).toLocaleTimeString(undefined, { hour: 'numeric' });
/** A weekday, Monday 0: "Mon", or "Monday". */
export const dayName = (i: number, long = false) => new Date(2026, 9, 12 + i).toLocaleDateString(undefined, { weekday: long ? 'long' : 'short' });
/** "Dec 3". */
export const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** Up, down or level, in an arrow and a word as well as a colour: `up` for a strength rate. */
export function Dir({ v, up = 'climbing', down = 'down' }: { v: number; up?: string; down?: string }) {
  if (Math.abs(v) < 0.05) return <span>— level</span>;
  return v > 0 ? <span className="up">↑ {up}</span> : <span className="down">↓ {down}</span>;
}

// ---- Tile visuals (24 px unless said) ----

const n1 = (n: number) => n.toFixed(1);

/** PRs as dots along the range, a row per kind (strength on top); the newest in the accent. */
export function PrDots({ dots, w, h = 24 }: { dots: PrDot[]; w: number; h?: number }) {
  // A tick a day with a PR across the range, the newest in the accent; the sheet splits them by kind.
  const days = dots.filter((d, i) => i === dots.length - 1 || d.date !== dots[i + 1].date);
  return (
    <svg width={w} height={h} className="st-dots">
      <rect x="0" y={n1(h / 2 - 1)} width={w} height="2" rx="1" fill="var(--fill)" />
      {days.map((d, i) => <rect key={d.date} x={n1(2 + d.at * (w - 6))} y="2" width="2" height={h - 4} rx="1" fill={i === days.length - 1 ? 'var(--accent)' : 'var(--col)'} />)}
    </svg>
  );
}

/** A lift each: a bar for flat, a triangle up or down, a dot for level. Shape and colour both say it. */
export function Pips({ pips, w, h = 24 }: { pips: ('flat' | 'up' | 'down' | 'level')[]; w: number; h?: number }) {
  const step = Math.min(24, (w - 4) / Math.max(1, pips.length)), cy = h / 2;
  return (
    <svg width={w} height={h} className="st-pips">
      {pips.map((p, i) => {
        const cx = 8 + i * step;
        return p === 'flat' ? <rect key={i} x={cx - 7} y={cy - 2} width="14" height="4" rx="2" fill="var(--warn)" />
          : p === 'up' ? <path key={i} d={`M${n1(cx)} ${cy - 6}L${n1(cx + 6)} ${cy + 5}H${n1(cx - 6)}Z`} fill="var(--ok)" />
          : p === 'down' ? <path key={i} d={`M${n1(cx)} ${cy + 6}L${n1(cx + 6)} ${cy - 5}H${n1(cx - 6)}Z`} fill="var(--warn)" />
          : <circle key={i} cx={n1(cx)} cy={cy} r="3" fill="var(--col)" />;
      })}
    </svg>
  );
}

/** Pull and push as two labelled bars from zero (30 px), in the calendar's kind colours. */
export function PullPush({ pull, push, w, h = 30 }: { pull: number; push: number; w: number; h?: number }) {
  const lw = 34, max = Math.max(pull, push, 1), bw = (v: number) => Math.max(2, ((w - lw) * v) / max), rh = h / 2;
  return (
    <svg width={w} height={h} className="st-pp">
      {([['Pull', pull, 'var(--kind-pull)'], ['Push', push, 'var(--kind-push)']] as const).map(([k, v, c], i) => (
        <g key={k}>
          <text x="0" y={n1(rh * i + rh / 2 + 4)} className="st-pp-l">{k}</text>
          <rect x={lw} y={n1(rh * i + rh / 2 - 4)} width={n1(bw(v))} height="8" rx="3" fill={c} />
        </g>
      ))}
    </svg>
  );
}

/** A trend in grey with its current point in the accent, and a solid line across where the timer is. */
export function SparkRef({ values, at, w, h = 24 }: { values: number[]; at: number; w: number; h?: number }) {
  const p = 5, lo = Math.min(at, ...values), hi = Math.max(at, ...values), sp = hi - lo || 1;
  const X = (i: number) => p + (values.length > 1 ? (i * (w - 2 * p)) / (values.length - 1) : (w - 2 * p) / 2), Y = (v: number) => h - p - ((v - lo) / sp) * (h - 2 * p);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${n1(X(i))} ${n1(Y(v))}`).join('');
  return (
    <svg width={w} height={h} className="st-spark">
      <line x1="0" x2={w} y1={n1(Y(at))} y2={n1(Y(at))} className="st-ref" />
      {values.length > 1 && <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {values.length > 0 && <circle cx={n1(X(values.length - 1))} cy={n1(Y(values.at(-1)!))} r="4" />}
    </svg>
  );
}

// ---- Sheet parts ----

interface BarRow { key: string; label: ReactNode; value: ReactNode; frac: number; accent?: boolean; colour?: string }
/** Labelled bars from zero, each its own row: the label and its number above, the bar under them. */
function Bars({ label, rows }: { label: string; rows: BarRow[] }) {
  return (
    <ul className="st-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="st-b-l">{r.label}</span><span className="st-b-v">{r.value}</span>
          <span className="st-b-track" aria-hidden="true"><i style={{ '--w': `${Math.round(Math.min(1, Math.max(0, r.frac)) * 1000) / 10}%`, ...(r.colour ? { background: r.colour } : r.accent ? { background: 'var(--accent)' } : {}) } as CSSProperties} /></span>
        </li>
      ))}
    </ul>
  );
}

/** Bars either side of a zero line, scaled to the largest: for a rate or a change that can go below zero. */
function Diverging({ label, rows }: { label: string; rows: { key: string; label: ReactNode; value: ReactNode; v: number | null }[] }) {
  const vs = rows.flatMap((r) => (r.v == null ? [] : [r.v]));
  const neg = Math.max(0, ...vs.map((v) => -v)), pos = Math.max(0, ...vs), span = neg + pos || 1, zero = neg / span;
  return (
    <ul className="st-bars st-div" aria-label={label}>
      {rows.map((r) => {
        const v = r.v ?? 0, wd = Math.abs(v) / span;
        return (
          <li key={r.key}>
            <span className="st-b-l">{r.label}</span><span className="st-b-v">{r.value}</span>
            <span className="st-b-track" aria-hidden="true">
              <b style={{ left: `${n1(zero * 100)}%` } as CSSProperties} />
              {r.v != null && <i style={{ left: `${n1((v < 0 ? zero - wd : zero) * 100)}%`, '--w': `${n1(wd * 100)}%` } as CSSProperties} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const Hero = ({ k, children }: { k: string; children: ReactNode }) => <div className="st-dr-hero"><span className="st-dr-k">{k}</span><span className="st-dr-v">{children}</span></div>;
const pctOf = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

// ---- Rate of gain ----

/** Every lift with a rate over the range, fastest first, and the same by family. */
export function RateSheet({ entries, today, range, median, followed }: { entries: SetEntry[]; today: string; range: Range; median: number; followed: number }) {
  const v = useMemo(() => {
    const names = liftsInRotation(entries, rangeFrom(range, today), today).lifts.map((l) => l.name);
    const all = rateOfGain(names.flatMap((name) => { const t = liftTrend(entries, name, today, rangeDays(range)); return t ? [{ name, points: t.points }] : []; }));
    return { rows: all.rows, fams: familyRates(all.rows) };
  }, [entries, today, range]);
  return (<>
    <Hero k={`Median of the ${plural(followed, 'lift')} followed · last ${rangeWords(range)}`}><b>{signed(median)}</b> % a week <Dir v={median} /></Hero>
    <h3>Every lift · {v.rows.length}</h3>
    <Diverging label="Rate of gain per lift" rows={v.rows.map((r) => ({ key: r.name, label: r.name, value: `${signed(r.pct)} %/wk`, v: r.pct }))} />
    {v.fams.length > 0 && (<>
      <h3>By family</h3>
      <Diverging label="Rate of gain per family" rows={v.fams.map((f) => ({ key: f.family, label: <>{f.family}<small> · {plural(f.lifts.length, 'lift')}</small></>, value: `${signed(f.pct)} %/wk`, v: f.pct }))} />
    </>)}
    <p className="muted small">A straight line through each lift’s sessions in the last {rangeWords(range)} (at least 4, spread over 2 weeks or more), as a share of its level each week. Trained lifters typically gain about 0.1–0.3% a week; newer ones faster. A family is the lifts of one movement, at their median.</p>
    <ChartTable caption="Rate of gain (% a week)" head={['Lift', '%/wk']} rows={v.rows.map((r) => [r.name, signed(r.pct, 2)])} />
  </>);
}

// ---- PRs by kind ----

/** The range's PRs as a timeline, a row per kind, and the count of each. */
export function PrKinds({ dots, groups, from, to }: { dots: PrDot[]; groups: Record<PrGroup, number>; from: string; to: string }) {
  const rows = PR_GROUPS.filter((g) => groups[g.id] > 0), last = dots.at(-1);
  // A dot a day: several PRs in one session would sit on top of each other (the count beside says how many).
  const days = (ds: PrDot[]) => ds.filter((d, i) => i === 0 || d.date !== ds[i - 1].date);
  return (
    <section className="st-prk" aria-label="PRs by kind">
      <h3>By kind</h3>
      <div className="st-tl" role="img" aria-label={`PRs by kind: ${rows.map((g) => `${g.label} ${groups[g.id]}`).join(', ')}`}>
        {rows.map((g) => (
          <div key={g.id} className="st-tl-row">
            <span className="st-tl-k">{g.label}<b>{groups[g.id]}</b></span>
            <span className="st-tl-track">{days(dots.filter((d) => d.group === g.id)).map((d) => <i key={d.date} className={d.date === last?.date && d.group === last.group ? 'now' : undefined} style={{ left: `${n1(d.at * 100)}%` } as CSSProperties} />)}</span>
          </div>
        ))}
        <div className="st-tl-axis"><span>{shortDate(from)}</span><span>{shortDate(to)}</span></div>
      </div>
    </section>
  );
}

// ---- Plateaus ----

/** The lifts followed that are flat, longest first, each with the variation the lift's page would offer; then the rest. */
export function PlateauSheet({ flat, moving, today, rotationOf, onOpenLift, who }: {
  flat: LiftState[]; moving: LiftState[]; today: string; rotationOf?: (lift: string) => Rotation | null; onOpenLift?: (name: string) => void; who?: string;
}) {
  const rot = useMemo(() => new Map(flat.map((l) => [l.name, rotationOf?.(l.name) ?? null])), [flat, rotationOf]);
  return (<>
    {flat.length ? (
      <ul className="st-plat" aria-label="Flat lifts">
        {flat.map((l) => {
          const r = rot.get(l.name);
          return (
            <li key={l.name}>
              <span className="st-pl-n">{l.name}</span><span className="st-pl-s flat">— flat {plural(Math.max(1, l.stall!.weeks), 'wk')}</span>
              <span className="st-pl-why">No new best since {fmtDay(l.stall!.since, today)}.</span>
              {r && <span className="st-pl-rot">Next, try <b>{r.to}</b>: {rotationReason(r)}.</span>}
              {onOpenLift && <button type="button" className="st-fix" onClick={() => onOpenLift(l.name)}>{r ? 'Switch on its page' : `Open ${l.name}`}<Icon name="chev-right" size={16} sw={2} /></button>}
            </li>
          );
        })}
      </ul>
    ) : <p className="st-sub"><span className="up">↑</span> None of the lifts {who ? `@${who} follows` : 'followed'} is flat.</p>}
    {moving.length > 0 && (<>
      <h3>Moving</h3>
      <ul className="st-plat" aria-label="Moving lifts">
        {moving.map((l) => <li key={l.name}><span className="st-pl-n">{l.name}</span><span className="st-pl-s">{l.pct == null ? 'too new to say' : <Dir v={l.pct} up={`${signed(l.pct)}%`} down={`${signed(l.pct)}%`} />}</span></li>)}
      </ul>
    </>)}
    <p className="muted small">Flat: the lift’s fatigue-adjusted level is more likely on a plateau than climbing, and its latest session set no new best (its page says the same). A switch to the next variation is offered on the lift’s page, where one tap puts it in the program.</p>
    <ChartTable caption="Lifts followed" head={['Lift', 'Status']} rows={[...flat.map((l): [string, string] => [l.name, `flat ${l.stall!.weeks} wk`]), ...moving.map((l): [string, string] => [l.name, l.pct == null ? 'too new' : `${signed(l.pct)}%`])]} />
  </>);
}

// ---- Target hit rate ----

export function HitRateSheet({ r, range }: { r: HitRate; range: Range }) {
  return (<>
    <Hero k={`Sets that made the reps suggested · last ${rangeWords(range)}`}><b>{pctOf(r.hit, r.sets)}%</b> {r.hit} of {plural(r.sets, 'set')}</Hero>
    {r.jumps.sets > 0 && <p className="st-sub">After a weight step-up: <b>{pctOf(r.jumps.hit, r.jumps.sets)}%</b> · {r.jumps.hit} of {plural(r.jumps.sets, 'set')}</p>}
    <h3>Per lift</h3>
    <Bars label="Target hit rate per lift" rows={r.lifts.map((l) => ({ key: l.name, label: l.name, value: `${l.hit} of ${l.sets} · ${pctOf(l.hit, l.sets)}%`, frac: l.hit / l.sets }))} />
    <p className="muted small">A set counts when it was done at the weight the app suggested, and made it when its reps reached the suggestion. Tests and warm-ups don’t count. Mostly made: the targets could climb faster; often missed, after a step-up most of all: they climb too fast.</p>
    <ChartTable caption="Target hit rate per lift" head={['Lift', 'Made / sets']} rows={r.lifts.map((l) => [l.name, `${l.hit} / ${l.sets}`])} />
  </>);
}

// ---- How hard ----

export function EffortSheet({ r, range }: { r: Effort; range: Range }) {
  const max = Math.max(...r.bins, 1);
  return (<>
    <Hero k={`Logged RIR · last ${rangeWords(range)}`}><b>{f1(r.avg)}</b> average · {Math.round(r.hard * 100)}% at 0–2</Hero>
    <Bars label="Sets by RIR" rows={r.bins.map((n, i) => ({ key: RIR_BINS[i], label: `RIR ${RIR_BINS[i]}`, value: plural(n, 'set'), frac: n / max, accent: i <= 2 }))} />
    <h3>Per lift</h3>
    <Bars label="RIR per lift" rows={r.lifts.map((l) => ({ key: l.name, label: l.name, value: `avg ${f1(l.avg)} · ${Math.round(l.hard * 100)}% at 0–2`, frac: l.hard }))} />
    <p className="muted small">RIR: the reps you had left. 0–2 (in the accent) is close to failure, where sets do the most for growth. {r.logged} of {plural(r.sets, 'working set')} have one logged ({pctOf(r.logged, r.sets)}%); the bars per lift are the share at 0–2.</p>
    <ChartTable caption="Sets by RIR" head={['RIR', 'Sets']} rows={r.bins.map((n, i) => [RIR_BINS[i], String(n)])} />
  </>);
}

// ---- Rest between sets ----

const SHOW_SESSIONS = 10;
export function RestSheet({ r, range, today }: { r: Rests; range: Range; today: string }) {
  const max = Math.max(...r.lifts.flatMap((l) => [l.rest, l.timer]), 60) * 1.08;
  const at = (s: number) => `${n1((100 * s) / max)}%`;
  const newest = [...r.sessions].reverse();
  return (<>
    <Hero k={`Median rest · last ${rangeWords(range)}`}><b>{mss(r.rest)}</b> timer {mss(r.timer)} · {plural(r.n, 'rest')} timed</Hero>
    <h3>You against the timer, per lift</h3>
    <ul className="st-db" aria-label="Rest per lift against the timer">
      {r.lifts.map((l) => (
        <li key={l.name}>
          <span className="st-b-l">{l.name}</span><span className="st-b-v">you {mss(l.rest)} · timer {mss(l.timer)}</span>
          <span className="st-db-track" aria-hidden="true">
            <b style={{ left: at(Math.min(l.rest, l.timer)), width: `${n1((100 * Math.abs(l.rest - l.timer)) / max)}%` } as CSSProperties} />
            <i className="timer" style={{ left: at(l.timer) } as CSSProperties} /><i className="you" style={{ left: at(l.rest) } as CSSProperties} />
          </span>
        </li>
      ))}
    </ul>
    <p className="st-legend" aria-hidden="true"><span><i className="you" />you</span><span><i className="timer" />timer</span></p>
    <h3>Sessions</h3>
    <dl className="st-lines">
      {r.perHour != null && <div><dt>Density</dt><dd><b>{Math.round(r.perHour)}</b> working sets an hour</dd></div>}
      {r.over != null && Math.abs(r.over) >= 1 && <div><dt>At the timer</dt><dd>sessions about <b>{Math.round(Math.abs(r.over))} min {r.over > 0 ? 'shorter' : 'longer'}</b></dd></div>}
    </dl>
    <ul className="st-list" aria-label="Timed sessions">
      {newest.slice(0, SHOW_SESSIONS).map((s) => (
        <li key={s.date}><span className="st-list-d">{fmtDay(s.date, today)}</span><span className="st-list-m"><b>{Math.round(s.minutes)} min</b> · {plural(s.sets, 'set')} · {Math.round(s.perHour)} an hour</span><span className="st-list-s">{s.rest != null ? `rest ${mss(s.rest)}` : 'no rests timed'}</span></li>
      ))}
    </ul>
    {newest.length > SHOW_SESSIONS && <p className="muted small">and {plural(newest.length - SHOW_SESSIONS, 'session')} before those.</p>}
    <p className="muted small">Rest: from one set to the next of the same lift, as you logged them, less about 40 s for the set itself; over 10 minutes is a break. The timer: your setting for the lift, else the rest your sets have taught it, else 2:00 for a small lift and 3:00 for a big one. Density: working sets an hour from a session’s first set to its last.</p>
    <ChartTable caption="Median rest per lift (you / timer)" head={['Lift', 'You / timer']} rows={r.lifts.map((l) => [l.name, `${mss(l.rest)} / ${mss(l.timer)}`])} />
  </>);
}

// ---- Pull vs push ----

const KIND_ROWS = [['pull', 'Pull'], ['push', 'Push'], ['legs', 'Legs'], ['core', 'Arms & core']] as const;
export function BalanceSheet({ b, range, weeks }: { b: Balance; range: Range; weeks: string[] }) {
  const max = Math.max(b.pull, b.push, b.legs, b.core, 1);
  return (<>
    <Hero k={`Pull sets per push set · last ${rangeWords(range)}`}><b>{f1(b.ratio ?? 0)}</b> {balanceWord(b.ratio ?? 0)}</Hero>
    <Bars label="Working sets by kind" rows={KIND_ROWS.map(([k, l]) => ({ key: k, label: l, value: plural(b[k], 'set'), frac: b[k] / max, colour: `var(--kind-${k})` }))} />
    <p className="muted small">A set counts for what its lift trains most, as the calendar colours it. Pulling about as much as pressing keeps the front and back of the shoulders in balance: a rule of thumb, not a line to hit.</p>
    <ChartTable caption="Pull / push sets per week" head={['Week of', 'Pull / push']} rows={b.weekly.map((x, i) => [weeks[i], `${x.pull} / ${x.push}`])} />
  </>);
}
/** The balance in words: no colour, since neither way is wrong. */
export const balanceWord = (ratio: number) => (ratio > 1.25 ? 'more pull' : ratio < 0.8 ? 'more push' : '— about even');

// ---- Lifts in rotation ----

export function LiftsSheet({ r, range, today }: { r: LiftRotation; range: Range; today: string }) {
  return (<>
    <Hero k={`Lifts done · last ${rangeWords(range)}`}><b>{r.lifts.length}</b> {r.lifts.length === 1 ? 'lift' : 'lifts'}{r.fresh.length > 0 && ` · ${r.fresh.length} new`}{r.dropped.length > 0 && ` · ${r.dropped.length} dropped`}</Hero>
    {r.fresh.length > 0 && (<>
      <h3>New to you · {r.fresh.length}</h3>
      <ul className="st-list" aria-label="New lifts">{r.fresh.map((l) => <li key={l.name}><span className="st-list-d">{fmtDay(l.first, today)}</span><span className="st-list-m"><b>{l.name}</b></span><span className="st-list-s">first done · {plural(l.sessions, 'session')} so far</span></li>)}</ul>
    </>)}
    {r.dropped.length > 0 && (<>
      <h3>Not done since · {r.dropped.length}</h3>
      <ul className="st-list" aria-label="Dropped lifts">{r.dropped.map((l) => <li key={l.name}><span className="st-list-d">{fmtDay(l.last, today)}</span><span className="st-list-m"><b>{l.name}</b></span><span className="st-list-s">last done · {plural(l.sessions, 'session')} the {rangeWords(range)} before</span></li>)}</ul>
    </>)}
    <h3>Every lift · {r.lifts.length}</h3>
    <Bars label="Sessions per lift" rows={r.lifts.map((l) => ({ key: l.name, label: l.name, value: plural(l.sessions, 'session'), frac: l.sessions / Math.max(1, r.lifts[0].sessions) }))} />
    <p className="muted small">A lift counts with a working set; cardio machines aren’t lifts here. Dropped: done in the {rangeWords(range)} before these and not since.</p>
    <ChartTable caption="Sessions per lift" head={['Lift', 'Sessions']} rows={r.lifts.map((l) => [l.name, String(l.sessions)])} />
  </>);
}

// ---- Best days, usual start ----

export function DaysSheet({ w, range }: { w: When; range: Range }) {
  return (<>
    <Hero k={`Days trained · last ${rangeWords(range)}`}><b>{w.days}</b> over {plural(w.weeks, 'week')}</Hero>
    <Bars label="Days trained per weekday" rows={w.byDay.map((n, i) => ({ key: String(i), label: dayName(i, true), value: `${n} of ${w.weeks}`, frac: n / w.weeks, accent: w.top.includes(i) }))} />
    <p className="muted small">A day counts with any set but a warm-up. Your most trained weekdays are in the accent: the top two and any tied with them, three at most.</p>
    <ChartTable caption="Days trained per weekday" head={['Weekday', 'Days']} rows={w.byDay.map((n, i) => [dayName(i, true), String(n)])} />
  </>);
}

export function StartSheet({ w, range }: { w: When; range: Range }) {
  const hours = w.hours.map((n, h) => ({ n, h })).filter((x) => x.n > 0), max = Math.max(...w.hours, 1);
  return (<>
    <Hero k={`Usual start · last ${rangeWords(range)}`}><b>{hourLabel(w.start!)}</b> {spread(w)}</Hero>
    <Bars label="Days by the hour they started" rows={hours.map((x) => ({ key: String(x.h), label: hourLabel(x.h), value: plural(x.n, 'day'), frac: x.n / max, accent: x.h === Math.floor(w.start!) }))} />
    <h3>By weekday</h3>
    <dl className="st-lines">
      {w.startByDay.map((h, i) => (h == null ? null : <div key={i}><dt>{dayName(i, true)}</dt><dd><b>{hourLabel(h)}</b></dd></div>))}
    </dl>
    <p className="muted small">From the first set you timed each day, less the set itself; {plural(w.timed, 'day')} timed. Only the hour is shown.</p>
    <ChartTable caption="Days by starting hour" head={['Hour', 'Days']} rows={hours.map((x) => [hourLabel(x.h), String(x.n)])} />
  </>);
}
/** The middle half of the starts, as hours: "most 5 PM–7 PM", or nothing when it's one hour. */
export const spread = (w: When) => {
  const a = hourLabel(w.early!), b = hourLabel(w.late!);
  return a === b ? '' : `most ${a}–${b}`;
};

// ---- Energy ----

export function EnergySheet({ e, range, today }: { e: Energy; range: Range; today: string }) {
  return (<>
    <Hero k={`Energy, 1–5 · last ${rangeWords(range)}`}><b>{f1(e.avg)}</b> average · {plural(e.days.length, 'day')} logged</Hero>
    <h3>Lifting by energy</h3>
    <Diverging label="Lifting against its last sessions, by energy" rows={[...e.levels].reverse().filter((l) => l.days > 0).map((l) => ({
      key: String(l.level), label: <>Energy {l.level}<small> · {plural(l.days, 'day')}</small></>, value: l.vs == null ? 'no lifts to compare' : <Dir v={l.vs} up={`${signed(l.vs)}%`} down={`${signed(l.vs)}%`} />, v: l.vs,
    }))} />
    <h3>Days</h3>
    <ul className="st-list" aria-label="Energy days">
      {[...e.days].reverse().slice(0, SHOW_SESSIONS).map((d) => <li key={d.date}><span className="st-list-d">{fmtDay(d.date, today)}</span><span className="st-list-m"><b>Energy {d.energy}</b></span><span className="st-list-s">{d.vs == null ? 'no lifts to compare' : `lifts ${signed(d.vs)}% vs their last 3 sessions`}</span></li>)}
    </ul>
    <p className="muted small">Each day’s lifts against their own last 3 sessions (best e1RM), counting those in the 8 weeks before and only with 2 or more, averaged over the day. Not yet adjusted for fatigue, so a back-off day reads low.</p>
    <ChartTable caption="Lifting by energy (%)" head={['Energy', 'Change']} rows={e.levels.filter((l) => l.days > 0).map((l) => [String(l.level), l.vs == null ? '—' : signed(l.vs)])} />
  </>);
}
