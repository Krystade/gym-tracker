import type { ReactNode } from 'react';
import { plural } from '../domain/format';
import type { Muscle } from '../domain/muscles';
import { rangeWords, type Range } from '../domain/statsLayout';
import { SESSION_CAP } from '../domain/analytics';
import { CARRY, FATIGUE_GATE, REL_STALE, type BestRest, type CarryPair, type Fatigue, type MuscleSource, type MuscleSpan, type NextSession, type RelRow } from '../domain/statsCore';
import { BarChart } from './charts/BarChart';
import { ChartTable } from './charts/ChartTable';
import { Bars, Hero, mss, signed } from './StatsSheets';
import { EvChip, type Evidence } from './StatsTile';

// The sheets of Stats v2's last tiles (plan §4 S4/S5): relative strength, a muscle's weeks against its band, and the learning
// core's tiles (fatigue per set, the best rest, the next session, carry-over). Each says where its number comes from, (a)
// research, (b) learned or (c) a neutral default, in a line under it, and holds its Table.

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const toMin = (s: number) => Math.round(s / 60);
const pct = (ln: number) => Math.round(100 * (Math.exp(ln) - 1));
/** "last 12 weeks", "past year": the range in a phrase. */
export const lastOf = (r: Range) => (r === '1y' ? 'past year' : `last ${rangeWords(r)}`);

/** Where a sheet's number comes from: its chip, then the method in words. */
export function EvLine({ ev, children }: { ev: Evidence; children: ReactNode }) {
  return <p className="st-ev"><EvChip ev={ev} /><span>{children}</span></p>;
}

// ---- Relative strength ----

/** A ratio's change in an arrow and words as well as a colour; one that rounds to 0.00 is level. */
export function RelDir({ change }: { change: number }) {
  if (Math.abs(change) < 0.005) return <span>— level</span>;
  return change > 0 ? <span className="up">↑ {signed(change, 2)}</span> : <span className="down">↓ {signed(change, 2)}</span>;
}

export function RelStrengthSheet({ rows, range }: { rows: RelRow[]; range: Range }) {
  const top = rows[0], max = Math.max(...rows.map((r) => r.now.ratio));
  return (<>
    <Hero k={`${top.name} · e1RM over body weight`}><b>{f2(top.now.ratio)}</b>× body weight{top.change != null && <RelDir change={top.change} />}</Hero>
    <Bars label="Relative strength per lift" rows={rows.map((r) => ({
      key: r.name, label: r.name, frac: r.now.ratio / max,
      value: <>{f2(r.now.ratio)}×{r.change != null && <> · {signed(r.change, 2)}</>}</>,
    }))} />
    <p className="muted small">The change is over the {lastOf(range)}: up is stronger for your weight, whether the lift rose or your weight fell.</p>
    <EvLine ev="b">Each lift’s e1RM as its tile reads it (fatigue put back, learned from your sets), over your trended body weight that day: your weigh-ins smoothed, so one heavy morning doesn’t move it. A session more than {REL_STALE} days after your last weigh-in isn’t read, and lifts where your body is the load are left out.</EvLine>
    <ChartTable caption="e1RM ÷ body weight, latest" head={['Lift', '× body weight']} rows={rows.map((r) => [r.name, `${f2(r.now.ratio)} (${Math.round(r.now.e1rm)} ÷ ${f1(r.now.bw)} lb)`])} />
  </>);
}

// ---- A muscle's weeks against its band ----

export function MuscleWeeksSheet({ muscle, weeks, values, band, span, range, own, sources }: {
  muscle: Muscle; weeks: readonly string[]; values: readonly number[]; /** Its target, or null for a muscle not planned. */ band: readonly [number, number] | null;
  span: MuscleSpan; range: Range; /** The target was set by hand. */ own?: boolean;
  /** Where the weeks' sets came from (muscleSources over the same weeks): each lift's part adds to the bars. */ sources?: { total: number; rows: MuscleSource[] };
}) {
  return (<>
    <Hero k={`Sets a week · ${lastOf(range)}`}><b>{span.avg == null ? '—' : f1(span.avg)}</b>{band ? `target ${band[0]}–${band[1]}` : 'not a priority'}</Hero>
    <BarChart label={`${muscle}, fractional sets per week, ${lastOf(range)}`} points={weeks.map((x, i) => ({ x, y: values[i] }))}
      format={(n) => `${f1(n)} sets`} tick={(n) => String(Math.round(n))} band={band ?? undefined} />
    {band && <p className="st-legend st-legend-band" aria-hidden="true"><span><i className="band" />target band</span></p>}
    {band && span.weeks > 0 && (
      <dl className="st-lines">
        <div><dt>In the band</dt><dd><b>{span.within} of {plural(span.weeks, 'week')}</b></dd></div>
        <div><dt>Under</dt><dd><b>{span.under}</b></dd></div>
        <div><dt>Over</dt><dd><b>{span.over}</b></dd></div>
      </dl>
    )}
    {sources && sources.rows.length > 0 && <MuscleSources muscle={muscle} weeks={weeks.length} {...sources} />}
    <p className="muted small">Fractional sets each Monday-to-Sunday week (direct 1, indirect ½), the week under way last. The average and the counts read the whole weeks since your first logged set; this week joins them once it’s done.</p>
    {band && (own
      ? <EvLine ev="c">The band is the range you set for this priority.</EvLine>
      : <EvLine ev="a">The band is this priority’s weekly sets: priorities 1–2 grow with more sets, at least 10 a week (Pelland 2026; Currier 2026, ACSM), priority 3 holds with about a third of that (Bickel 2011; Spiering 2021).</EvLine>)}
    <ChartTable caption={`${muscle}, fractional sets per week`} head={['Week of', 'Sets']} rows={weeks.map((w, i) => [w, f1(values[i])])} />
  </>);
}

const SHARE: Record<string, string> = { '1': '1', '0.5': '½', '0.25': '¼', '0.75': '¾' };
const share = (f: number) => SHARE[String(f)] ?? f.toFixed(2);

/** Each lift's part of a muscle's sets over the weeks of its sheet (owner, 2026-10-29): its working sets, its share, what it gave. */
function MuscleSources({ muscle, weeks, total, rows }: { muscle: Muscle; weeks: number; total: number; rows: MuscleSource[] }) {
  const max = rows[0].contrib || 1, cut = rows.some((r) => r.contrib < r.sets * r.factor - 1e-9);
  return (
    <section className="st-src" aria-label={`${muscle}, sets from each lift`}>
      <h3>From each lift · {f1(total)} sets in {plural(weeks, 'week')}</h3>
      <Bars label={`${muscle}: sets from each lift`} rows={rows.map((r) => ({
        key: r.exercise, label: r.exercise, frac: r.contrib / max,
        value: <>{r.sets} × {share(r.factor)} = <b>{f1(r.contrib)}</b></>,
      }))} />
      <p className="muted small">Each lift’s working sets in these weeks, times its share for the {muscle.toLowerCase()} (direct 1, indirect ½): together, the bars above.{cut && ` A session over ${SESSION_CAP} sets for one muscle counts ${SESSION_CAP}, each lift’s part cut to match.`}</p>
    </section>
  );
}

// ---- Fatigue per set ----

const ORD = ['2nd', '3rd', '4th'];
export function FatigueSheet({ f, whose }: { f: Fatigue; whose: string }) {
  const top = f.lifts[0], max = Math.max(...f.lifts.map((l) => l.loss[1] + FATIGUE_GATE.z * l.sd[1]));
  return (<>
    <Hero k={`${top.name} · 3rd set in a row`}><b>−{f1(top.loss[1])}</b>reps to the 2 sets before it</Hero>
    <p className="st-sub">{whose === 'your' ? 'Your' : `${whose[0].toUpperCase()}${whose.slice(1)}`} 3rd {top.name} set loses about <b>{f1(top.loss[1])} reps</b>, at {whose} usual {mss(f.gap)} from one set to the next.</p>
    <h3>The 3rd set, per lift</h3>
    <Bars label="Reps the 3rd set loses, per lift" rows={f.lifts.map((l) => ({
      key: l.key, label: l.name, frac: l.loss[1] / max,
      value: `−${f1(l.loss[1])} (${f1(Math.max(0, l.loss[1] - FATIGUE_GATE.z * l.sd[1]))}–${f1(l.loss[1] + FATIGUE_GATE.z * l.sd[1])})`,
    }))} />
    {f.cross && <p className="st-sub">A set of another lift for the same muscles just before costs about <b>{f1(f.cross.mean)} {f.cross.mean.toFixed(1) === '1.0' ? 'rep' : 'reps'}</b>.</p>}
    <EvLine ev="b">Learned from {whose} sets: how many reps a set gives up to the sets before it in a session, and how much comes back with rest. Shown once there are {FATIGUE_GATE.sessions} sessions (where it recovers synthetic lifters’ fatigue within its error), and for a lift once its own sets show it and the 3rd set’s loss is above zero 9 times in 10 (the range in brackets). From the whole log, not the range.</EvLine>
    <ChartTable caption="Reps lost to the sets before" head={['Lift', ORD.join(' / ')]} rows={f.lifts.map((l) => [l.name, l.loss.map((x) => `−${f1(x)}`).join(' / ')])} />
  </>);
}

// ---- The best rest ----

export function BestRestSheet({ rows, whose }: { rows: BestRest[]; whose: string }) {
  const top = rows[0];
  return (<>
    <Hero k={`${top.name} · rest after a set`}><b>{mss(top.seconds)}</b>learned · default {mss(top.research)}</Hero>
    <ul className="st-bars st-rows" aria-label="Best rest per lift">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="st-b-l">{r.name}</span><span className="st-b-v"><b>{mss(r.seconds)}</b> · default {mss(r.research)}</span>
          <span className="st-b-sub">9 in 10: {mss(r.lo)} to {mss(r.hi)}</span>
        </li>
      ))}
    </ul>
    <EvLine ev="b">The rest past which 30 s more buys back less than a rounding error of a rep, from how {whose} sets recovered on timed days, at {whose} usual effort. Shown for a lift once it is known to within ±45 s and sits inside the rests {whose === 'your' ? 'you have' : 'they have'} timed; the timer uses it then. From the whole log.</EvLine>
    <EvLine ev="a">The default: what the timer runs without a learned rest or a setting of {whose === 'your' ? 'yours' : 'theirs'}, 2:00 for a small lift and 3:00 for a big one.</EvLine>
    <ChartTable caption="Rest after a set (learned / default)" head={['Lift', 'Learned / default']} rows={rows.map((r) => [r.name, `${mss(r.seconds)} / ${mss(r.research)}`])} />
  </>);
}

// ---- The next session ----

/** Two durations as bars from zero, the learned one (accent) over the other (grey): the session at his pace over it at the timer's rests, or a learned rest over the default. */
export function PaceBars({ pace, plan, w, h = 24 }: { pace: number; plan: number; w: number; h?: number }) {
  const max = Math.max(pace, plan, 1), bar = (v: number) => Math.max(3, (w * v) / max);
  return (
    <svg width={w} height={h} className="st-pacebars">
      <rect x="0" y="3" width={bar(pace).toFixed(1)} height="8" rx="4" fill="var(--accent)" />
      <rect x="0" y="14" width={bar(plan).toFixed(1)} height="8" rx="4" fill="var(--col)" />
    </svg>
  );
}

const FROM: Record<NextSession['rests'][number]['from'], string> = { kept: 'setting', knee: 'learned', default: 'default' };
export function ForecastSheet({ n, today, whose }: { n: NextSession; today: string; whose: string }) {
  const when = n.date === today ? 'today' : new Date(`${n.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
  const d = toMin(n.pace.seconds) - toMin(n.plan);
  return (<>
    <Hero k={`${n.name} · next up, ${when}`}><b>{toMin(n.pace.seconds)}</b>min at {whose} pace</Hero>
    <dl className="st-lines">
      <div><dt>At {whose} pace</dt><dd><b>{toMin(n.pace.seconds)} min</b> · 8 in 10: {toMin(n.pace.lo)}–{toMin(n.pace.hi)}</dd></div>
      <div><dt>At the timer</dt><dd><b>{toMin(n.plan)} min</b>{d !== 0 && ` · ${Math.abs(d)} min ${d > 0 ? 'shorter' : 'longer'}`}</dd></div>
      <div><dt>The plan</dt><dd>{plural(n.lifts, 'lift')} · {plural(n.sets, 'working set')}</dd></div>
    </dl>
    <h3>The timer’s rests</h3>
    <ul className="st-bars st-rows" aria-label="The timer’s rest per lift">
      {n.rests.map((r) => <li key={r.exercise}><span className="st-b-l">{r.exercise}</span><span className="st-b-v"><b>{mss(r.seconds)}</b> · {FROM[r.from]}</span></li>)}
    </ul>
    <EvLine ev="b">At {whose} pace: how long {whose} timed sessions took from one set to the next, learned from the log, for this day’s sets and warm-ups.</EvLine>
    <EvLine ev="a">At the timer: the same sets at the timer’s rests (a setting, else a learned rest, else the research default) and about 40 s a set.</EvLine>
    <ChartTable caption="The timer’s rest after each set" head={['Lift', 'Rest']} rows={n.rests.map((r) => [r.exercise, `${mss(r.seconds)} (${FROM[r.from]})`])} />
  </>);
}

// ---- Carry-over ----

export function CarrySheet({ pairs, range }: { pairs: CarryPair[]; range: Range }) {
  const top = pairs[0];
  return (<>
    <Hero k={`${top.other} against ${top.base}`}><b>{f2(top.ratio)}×</b>{top.base}’s e1RM · held ±{pct(top.spread)}%</Hero>
    <ul className="st-bars st-rows" aria-label="Carry-over per pair">
      {pairs.map((p) => (
        <li key={`${p.base}|${p.other}`}>
          <span className="st-b-l">{p.other}<small> against {p.base}</small></span><span className="st-b-v"><b>{f2(p.ratio)}×</b> · ±{pct(p.spread)}%</span>
          <span className="st-b-sub">{p.family} · {plural(p.weeks, 'week')} with both</span>
        </li>
      ))}
    </ul>
    <p className="muted small">The ± is how far the ratio wandered week to week over the {lastOf(range)}, 9 weeks in 10. A steady ratio is two lifts that climbed and fell together: a gain on one shows on the other.</p>
    <EvLine ev="b">One lift’s e1RM over the other’s (their fatigue-adjusted levels, learned from your sets) in the last week you did both: within about ±{Math.round(100 * CARRY.accuracy)}% of the truth on synthetic lifters. Pairs are lifts of one movement, shown once both were done in {CARRY.min} of the same weeks.</EvLine>
    <ChartTable caption="e1RM ratio and how steady it held" head={['Pair', 'Ratio · ±']} rows={pairs.map((p) => [`${p.other} / ${p.base}`, `${f2(p.ratio)} · ±${pct(p.spread)}%`])} />
  </>);
}
