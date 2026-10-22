import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { loadCloud } from '../cloud/firebase';
import type { Friend } from '../cloud/friends';
import { activeProfileDb } from '../db/db';
import {
  axisTicks, COMPARE_RANGES, heatStep, isMetric, LINE_METRICS, personColours, POINTS, ranked, ranks, samples, sharedLifts, spread, summarize, values,
  YOU_COLOUR, type CompareRange, type Metric, type Summary, type Value,
} from '../domain/compare';
import type { SetEntry } from '../domain/types';
import { addDays } from '../domain/analytics';
import { peekFriendCache, refreshLists, refreshSummaries, staleSummaries, useFriendCache, useFriendTags } from '../state/friendCache';
import { getPref, setPref } from '../state/prefs';
import { Formerly, Glued, useFriendLabel, useVerified, Verified } from './FriendName';
import { Icon, initials } from './icons';
import { StatsSheet } from './StatsSheet';
import './compare.css';

// Compare (round 22, owner answers 2026-10-21): you and your friends side by side, each against their own start and their own goal,
// never load against load. Three views of the same numbers: Ranks (one metric, ranked), Table (every metric, shaded by place) and
// Chart (each person's line from their own 0). Each friend costs one read, of the summary their phone publishes (cloud/summary),
// and never their sets. Who's shown, the view, the range and the metric are kept per profile on this phone.

type View = 'ranks' | 'table' | 'chart';
const VIEWS: readonly [View, string][] = [['ranks', 'Ranks'], ['table', 'Table'], ['chart', 'Chart']];
const RANGE_LABEL: Record<CompareRange, string> = { '4w': '4 wk', '12w': '12 wk', '1y': '1 yr' };
const WEEKS: Record<CompareRange, number> = { '4w': 4, '12w': 12, '1y': 52 };
const LABEL: Record<Metric, string> = { str: 'Strength', goal: 'Goal', vol: 'Volume', pr: 'PRs', streak: 'Streak' };
const isView = (x: unknown): x is View => VIEWS.some(([v]) => v === x);
const isRange = (x: unknown): x is CompareRange => COMPARE_RANGES.includes(x as CompareRange);
const isLine = (x: unknown): x is Metric => LINE_METRICS.includes(x as Metric);
const isUids = (x: unknown): x is string[] => Array.isArray(x) && x.every((u) => typeof u === 'string');

const MINUS = '−';
const signed = (x: number, dp: number) => `${x > 0 ? '+' : x < 0 ? MINUS : ''}${Math.abs(x).toFixed(dp)}`;
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** A metric's number as a row shows it: "+5.1%", "9", "−3%". */
function fmt(m: Metric, v: number | null): string {
  if (v == null) return '–';
  return m === 'str' ? `${signed(v, 1)}%` : m === 'vol' ? `${signed(v, 0)}%` : String(v);
}
/** A heat-table cell: the number without its unit (the column says it). */
const cell = (m: Metric, v: number | null) => (v == null ? '–' : m === 'str' ? signed(v, 1) : m === 'vol' ? signed(v, 0) : String(v));
/** A short name for a chart's line end: you, your tag for them, else their @username; long ones cut (the legend has them whole). */
const short = (s: string) => { const g = Array.from(s); return g.length > 11 ? `${g.slice(0, 10).join('')}…` : s; };

interface Row {
  uid: string; me: boolean; friend?: Friend; /** For sorting and reading out. */ name: string; /** For a line's end. */ tag: string;
  colour: string; s: Summary | null; state: 'ok' | 'none' | 'loading'; /** Their summary's day, when it's days old. */ asOf?: string;
}

export function ComparePage({ uid, myName, entries, today, goal, onBack, onView, onOpenMine }: {
  uid: string; /** This phone's person, for your avatar. */ myName?: string; /** Your whole log: your summary is worked out here, not read. */ entries: SetEntry[];
  today: string; /** Your sessions-a-week goal. */ goal: number; onBack: () => void; onView: (f: Friend) => void; onOpenMine: () => void;
}) {
  const [owner] = useState(activeProfileDb);
  const kept = <T,>(name: string, ok: (x: unknown) => x is T, dflt: T): T => { const v = getPref<unknown>(owner, name); return ok(v) ? v : dflt; };
  const [view, setView] = useState<View>(() => kept('compare:view', isView, 'ranks'));
  const [range, setRange] = useState<CompareRange>(() => kept('compare:range', isRange, '12w'));
  const [metric, setMetric] = useState<Metric>(() => kept('compare:metric', isMetric, 'str'));
  const [lineM, setLineM] = useState<Metric>(() => kept('compare:line', isLine, 'str'));
  const [sort, setSort] = useState<Metric>(() => kept('compare:sort', isMetric, 'str'));
  const [hidden, setHidden] = useState<string[]>(() => kept('compare:hidden', isUids, []));
  const save = <T,>(name: string, set: (v: T) => void) => (v: T) => { set(v); setPref(owner, name, v); };
  const [picking, setPicking] = useState(false);

  const cache = useFriendCache(uid);
  const friends = cache?.lists?.friends ?? null;
  const tags = useFriendTags(uid);
  const label = useFriendLabel(uid);
  const shown = useMemo(() => (friends ?? []).filter((f) => !hidden.includes(f.uid)), [friends, hidden]);
  const shownKey = shown.map((f) => f.uid).join();

  // One read a friend shown, of their summary, when it's not kept or 5 minutes old; never their sets. Friends hidden aren't read.
  useEffect(() => {
    if (!friends) { void loadCloud().then((c) => refreshLists(c, uid, true)).catch(() => {}); return; }
    const need = staleSummaries(peekFriendCache(uid), shown.map((f) => f.uid), Date.now());
    if (need.length) void loadCloud().then((c) => refreshSummaries(c, uid, need)).catch(() => {});
  }, [uid, shownKey, friends === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => summarize(entries, today, goal), [entries, today, goal]);
  const colours = useMemo(() => personColours(friends ?? []), [friends]);
  const rows = useMemo((): Row[] => [
    { uid: 'me', me: true, name: 'You', tag: 'You', colour: YOU_COLOUR, s: mine, state: 'ok' },
    ...shown.map((f): Row => {
      const k = cache?.summaries?.[f.uid];
      const doc = k?.doc ?? null;
      return {
        uid: f.uid, me: false, friend: f, name: label(f.uid, f.name, f.dn), tag: tags[f.uid] || f.dn || `@${f.name}`, colour: colours.get(f.uid) ?? YOU_COLOUR,
        s: doc, state: !k ? 'loading' : doc ? 'ok' : 'none', ...(doc && doc.day < addDays(today, -2) && { asOf: doc.day }),
      };
    }),
  ], [mine, shown, cache?.summaries, label, tags, colours, today]);
  const people = useMemo(() => rows.map((r) => ({ uid: r.uid, me: r.me, s: r.s })), [rows]);
  const missing = rows.filter((r) => r.state !== 'ok');
  const open = (r: Row) => (r.friend ? onView(r.friend) : onOpenMine());

  const from = samples(range, today)[0];
  return (
    <section className="cmp" aria-label="Compare">
      <div className="fp-top"><button className="quiet-btn fp-back" onClick={onBack}><Icon name="chev-left" size={24} />Friends</button></div>
      <div className="page-head cmp-head">
        <h1>Compare</h1>
        {!!friends?.length && (
          <button className="cmp-people" onClick={() => setPicking(true)} aria-label={`People: ${shown.length} of ${friends.length} friends shown`}>
            <Icon name="friends" size={20} />{shown.length}/{friends.length}
          </button>
        )}
      </div>
      <p className="cmp-sub">Everyone against <b>their own start</b> and <b>their own goal</b>. Never load against load.</p>
      <div className="cmp-views" role="tablist" aria-label="View">
        {VIEWS.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} onClick={() => save('compare:view', setView)(v)}>{l}</button>)}
      </div>
      <div className="st-range cmp-range" role="group" aria-label="Range">
        {COMPARE_RANGES.map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => save('compare:range', setRange)(r)}>{RANGE_LABEL[r]}</button>)}
      </div>
      {friends && !friends.length && <p className="muted cmp-empty">No friends yet. Invite one from Friends, and you’ll be side by side here.</p>}
      {view === 'ranks' && <Ranks rows={rows} people={people} metric={metric} range={range} from={from} onMetric={save('compare:metric', setMetric)} onOpen={open} me={uid} />}
      {view === 'table' && <Table rows={rows} people={people} range={range} sort={sort} onSort={save('compare:sort', setSort)} onOpen={open} me={uid} />}
      {view === 'chart' && <Chart rows={rows} people={people} metric={lineM} range={range} today={today} onMetric={save('compare:line', setLineM)} />}
      {missing.length > 0 && view !== 'table' && (
        <ul className="cmp-missing" aria-label="Not updated yet">
          {missing.map((r) => (
            <li key={r.uid}>
              <button onClick={() => open(r)}>
                <Avatar r={r} myName={myName} />
                <span className="cmp-nm"><Name r={r} me={uid} /><span className="cmp-why">{r.state === 'loading' ? 'Loading…' : 'Not updated yet. Their numbers show once their phone has this version and syncs.'}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Firsts rows={rows} today={today} />
      {picking && friends && (
        <StatsSheet title="People" onClose={() => setPicking(false)}
          link={hidden.length > 0 ? <button className="st-link" onClick={() => save('compare:hidden', setHidden)([])}>Show all</button> : undefined}>
          <p className="cmp-pick-note">Who Compare sets you beside. Hidden friends aren’t read, and stay hidden on this phone.</p>
          <ul className="cmp-picks">
            {friends.map((f) => {
              const on = !hidden.includes(f.uid);
              return (
                <li key={f.uid}>
                  <button className="cmp-pick" aria-pressed={on} onClick={() => save('compare:hidden', setHidden)(on ? [...hidden, f.uid] : hidden.filter((x) => x !== f.uid))}>
                    <span className="avatar cmp-av" style={{ '--pc': colours.get(f.uid) } as CSSProperties} aria-hidden="true">{initials(f.dn || f.name)}</span>
                    <span className="cmp-nm"><Name r={{ uid: f.uid, me: false, friend: f }} me={uid} /></span>
                    <span className="cmp-check" aria-hidden="true">{on && <Icon name="check" size={18} sw={2.25} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </StatsSheet>
      )}
    </section>
  );
}

function Avatar({ r, myName }: { r: Row; myName?: string }) {
  return <span className={`avatar cmp-av${r.me ? ' me' : ''}`} style={{ '--pc': r.colour } as CSSProperties} aria-hidden="true">{initials(r.me ? myName || 'You' : r.friend!.dn || r.friend!.name)}</span>;
}

/**
 * Your tag for them, else their display name, over their @username (the @username alone when neither), the ✓ after it when
 * verified (drawn only: every name here is inside a button), and "formerly" for 30 days; "You" for you.
 */
function Name({ r, me }: { r: Pick<Row, 'uid' | 'me' | 'friend'>; me: string }) {
  const lead = useFriendTags(me)[r.uid] || r.friend?.dn;
  const v = useVerified(me)[r.uid] != null;
  if (r.me || !r.friend) return <span className="cmp-tg">You</span>;
  return (<>
    <span className="cmp-tg"><Glued text={lead || `@${r.friend.name}`} after={v && <Verified name={r.friend.name} tap={false} />} /></span>
    {lead && <span className="cmp-us">@{r.friend.name}</span>}
    <span className="cmp-was"><Formerly friend={r.friend} /></span>
  </>);
}

// ---- Ranks: one metric, everyone ranked by it ----

/** Under the board: why the ranking is fair, metric by metric. */
const FAIR: Record<Metric, string> = {
  str: 'Ranked by change only, so starting stronger never helps or hurts.',
  goal: 'Ranked by weeks at each person’s own goal, so a bigger goal never helps or hurts.',
  vol: 'Ranked against each person’s own usual, so training more than someone else never counts.',
  pr: 'Each PR is against only that person’s own history, so lifting heavier never counts.',
  streak: 'Weeks in a row at each person’s own goal, so a bigger goal never helps or hurts.',
};

const EXPLAIN: Record<Metric, (from: string, range: CompareRange) => ReactNode> = {
  str: (from) => <><b>Strength</b>: the average e1RM change since {shortDay(from)} on the lifts each person shares with someone here. Everyone’s start is 0.</>,
  goal: () => <><b>Goal</b>: weeks each person met <b>their own</b> weekly goal, so 3-a-week and 5-a-week race fairly.</>,
  vol: (_f, r) => <><b>Volume</b>: working sets a week against each person’s own usual (the {r === '1y' ? 'year' : `${WEEKS[r]} weeks`} before this).</>,
  pr: () => <><b>PRs</b>: new personal bests, each against only their own history.</>,
  streak: () => <><b>Streak</b>: weeks in a row at their own goal.</>,
};

function MetricChips({ list, on, onPick }: { list: readonly Metric[]; on: Metric; onPick: (m: Metric) => void }) {
  return (
    <div className="cmp-chips" role="group" aria-label="Compare by">
      {list.map((m) => <button key={m} aria-pressed={m === on} onClick={() => onPick(m)}>{LABEL[m]}</button>)}
    </div>
  );
}

function Ranks({ rows, people, metric, range, from, onMetric, onOpen, me }: {
  rows: Row[]; people: { uid: string; me: boolean; s: Summary | null }[]; metric: Metric; range: CompareRange; from: string;
  onMetric: (m: Metric) => void; onOpen: (r: Row) => void; me: string;
}) {
  const vals = useMemo(() => values(people, metric, range), [people, metric, range]);
  const rk = ranks(vals);
  const shared = useMemo(() => (metric === 'str' ? sharedLifts(people, range) : null), [people, metric, range]);
  const ok = rows.filter((r) => r.state === 'ok');
  const order = ranked(ok, vals);
  // Every line on one scale, so a small change looks small.
  let lo = 0, hi = 0;
  for (const r of ok) for (const v of vals.get(r.uid)?.line ?? []) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const weeks = WEEKS[range];
  const sub = (r: Row, v: Value) => {
    if (metric === 'str') { const n = shared?.get(r.uid)?.length ?? 0; return v.v == null ? 'no shared lift' : `${n} lift${n === 1 ? '' : 's'}`; }
    if (metric === 'goal') return `of ${weeks} · ${r.s!.goal}/wk`;
    if (metric === 'streak') return `weeks · ${r.s!.goal}/wk`;
    if (metric === 'vol') return v.v == null ? 'no usual yet' : 'vs usual';
    return v.v === 1 ? 'PR' : 'PRs';
  };
  return (<>
    <MetricChips list={['str', 'goal', 'vol', 'pr', 'streak']} on={metric} onPick={onMetric} />
    <p className="cmp-exp">{EXPLAIN[metric](from, range)}</p>
    <ol className="cmp-board" aria-label={`Ranked by ${LABEL[metric]}`}>
      {order.map((r) => {
        const v = vals.get(r.uid)!, n = rk.get(r.uid);
        const dots = metric === 'goal' || metric === 'streak' ? r.s!.r[range].met.slice(-12) : null;
        return (
          <li key={r.uid}>
            <button className={`cmp-row${r.me ? ' me' : ''}`} onClick={() => onOpen(r)}
              aria-label={`${n ? `${n}. ` : ''}${r.name}: ${LABEL[metric]} ${fmt(metric, v.v)}${metric === 'goal' ? ` of ${weeks} weeks` : ''}`}>
              <span className="cmp-rk" aria-hidden="true">{n ?? '–'}</span>
              <Avatar r={r} />
              <span className="cmp-nm"><Name r={r} me={me} />{r.asOf && <span className="cmp-asof">as of {shortDay(r.asOf)}</span>}</span>
              <span className="cmp-vz" aria-hidden="true">
                {dots ? <span className="cmp-dots">{[...dots].map((c, i) => <i key={i} className={c === '1' ? 'y' : undefined} />)}</span>
                  : v.line ? <Spark vals={v.line} lo={lo} hi={hi} colour={r.colour} zero={metric !== 'pr'} /> : null}
              </span>
              <span className="cmp-val" aria-hidden="true">{fmt(metric, v.v)}<small>{sub(r, v)}</small></span>
            </button>
          </li>
        );
      })}
    </ol>
    <p className="cmp-foot">{FAIR[metric]} Tap anyone for their page.</p>
  </>);
}

/** A line on a scale the whole list shares, with the zero line where 0 is in range. */
function Spark({ vals, lo, hi, colour, zero }: { vals: readonly (number | null)[]; lo: number; hi: number; colour: string; zero: boolean }) {
  const w = 62, h = 26;
  const X = (i: number) => 2 + (i * (w - 4)) / (vals.length - 1), Y = (v: number) => h - 3 - ((v - lo) / (hi - lo || 1)) * (h - 6);
  let d = '', last: [number, number] | null = null;
  vals.forEach((v, i) => { if (v == null) return; d += `${last ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; last = [X(i), Y(v)]; });
  const end = last as [number, number] | null;
  return (
    <svg className="cmp-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {zero && lo <= 0 && hi >= 0 && <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} className="cmp-zero" />}
      {d && <path d={d} fill="none" stroke={colour} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />}
      {end && <circle cx={end[0]} cy={end[1]} r={2.5} fill={colour} />}
    </svg>
  );
}

// ---- Table: every metric, shaded by where each sits among those shown ----

function Table({ rows, people, range, sort, onSort, onOpen, me }: {
  rows: Row[]; people: { uid: string; me: boolean; s: Summary | null }[]; range: CompareRange; sort: Metric; onSort: (m: Metric) => void; onOpen: (r: Row) => void; me: string;
}) {
  const cols: [Metric, string, string][] = [['str', 'Strength', 'e1RM %'], ['goal', 'Goal', `of ${WEEKS[range]}`], ['vol', 'Volume', '% usual'], ['pr', 'PRs', 'set'], ['streak', 'Streak', 'weeks']];
  const all = useMemo(() => new Map(cols.map(([m]) => [m, values(people, m, range)])), [people, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = rows.filter((r) => r.state === 'ok');
  const order = ranked(ok, all.get(sort)!);
  const missing = rows.filter((r) => r.state !== 'ok');
  return (<>
    <div className="cmp-heat" role="table" aria-label="Everyone by every metric">
      <div className="cmp-hrow cmp-hhead" role="row">
        <span className="cmp-hn" role="columnheader">Tap to sort</span>
        {cols.map(([m, l, u]) => (
          <span key={m} role="columnheader" aria-sort={sort === m ? 'descending' : 'none'}>
            <button className={`cmp-hcol${sort === m ? ' sort' : ''}`} onClick={() => onSort(m)} aria-label={`Sort by ${l}`}>{l}<span>{u}</span></button>
          </span>
        ))}
      </div>
      {order.map((r) => (
        <div key={r.uid} className={`cmp-hrow${r.me ? ' me' : ''}`} role="row">
          <button className="cmp-hname" role="rowheader" onClick={() => onOpen(r)}>
            <span className="cmp-nm"><Name r={r} me={me} />{r.asOf && <span className="cmp-asof">as of {shortDay(r.asOf)}</span>}</span>
          </button>
          {cols.map(([m]) => {
            const vs = all.get(m)!, v = vs.get(r.uid)!.v;
            const step = heatStep(v, ok.map((o) => vs.get(o.uid)!.v));
            return <span key={m} role="cell" className={`cmp-hc s${step}`}>{cell(m, v)}</span>;
          })}
        </div>
      ))}
      {missing.map((r) => (
        <div key={r.uid} className="cmp-hrow away" role="row">
          <button className="cmp-hname" role="rowheader" onClick={() => onOpen(r)}><span className="cmp-nm"><Name r={r} me={me} /></span></button>
          <span className="cmp-hnote" role="cell">{r.state === 'loading' ? 'Loading…' : 'Not updated yet · not shaded'}</span>
        </div>
      ))}
    </div>
    <div className="cmp-legend" aria-hidden="true"><span>Less change</span><span className="cmp-sw"><i className="s1" /><i className="s2" /><i className="s3" /><i className="s4" /></span><span>More change</span></div>
    <p className="cmp-foot">Shades compare change this range, never strength. The lightest steel isn’t a warning: it only means others moved more this time. Tap a name for their page.</p>
  </>);
}

// ---- Chart: each person's line from their own 0 ----

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setW(el.clientWidth));
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return [ref, w];
}

function Chart({ rows, people, metric, range, today, onMetric }: {
  rows: Row[]; people: { uid: string; me: boolean; s: Summary | null }[]; metric: Metric; range: CompareRange; today: string; onMetric: (m: Metric) => void;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const vals = useMemo(() => values(people, metric, range), [people, metric, range]);
  const at = samples(range, today);
  const lines = rows.filter((r) => r.state === 'ok' && vals.get(r.uid)?.line);
  const none = rows.filter((r) => r.state === 'ok' && !vals.get(r.uid)?.line);
  const f = focus && lines.some((r) => r.uid === focus) ? focus : null;

  const all = lines.flatMap((r) => vals.get(r.uid)!.line!.filter((v): v is number => v != null));
  const whole = metric === 'pr';
  const tk = axisTicks(Math.min(0, ...all), Math.max(0, ...all), whole);
  const lo = tk[0], hi = tk[tk.length - 1];
  const labelW = Math.min(84, 16 + 6.6 * Math.max(3, ...lines.map((r) => Array.from(short(r.tag)).length)));
  const w = Math.max(240, width), padL = 38, padR = labelW + 6, padT = 10, padB = 22;
  const h = Math.max(200, padT + padB + 15 * lines.length + 8);
  const X = (k: number) => padL + (k * (w - padL - padR)) / (POINTS - 1);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (h - padT - padB);
  const unit = (t: number) => (metric === 'pr' ? String(t) : t === 0 ? 'start' : `${signed(t, 0)}%`);

  // Each line's end, and its label nudged so none overlap.
  const ends = lines.map((r) => {
    const line = vals.get(r.uid)!.line!;
    let k = line.length - 1;
    while (k > 0 && line[k] == null) k--;
    return { r, k, v: line[k] as number };
  });
  const labY = spread(ends.map((e) => Y(e.v) + 4), 15, padT + 8, h - padB);
  const path = (line: readonly (number | null)[]) => {
    let d = '', pen = false;
    line.forEach((v, k) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const drawOrder = [...ends].sort((a, b) => Number(a.r.uid === f) - Number(b.r.uid === f) || Number(a.r.me) - Number(b.r.me));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setScrub(Math.max(0, Math.min(POINTS - 1, Math.round(((x - padL) / (w - padL - padR)) * (POINTS - 1)))));
  };
  const lead = (f ? lines.find((r) => r.uid === f) : null) ?? lines.find((r) => r.me) ?? lines[0];
  const valueAt = (r: Row, k: number) => vals.get(r.uid)!.line![k];
  const readout = (r: Row, k: number | null) => {
    const v = k == null ? vals.get(r.uid)!.v : valueAt(r, k);
    return `${r.me ? 'You' : r.tag} ${fmt(metric, v ?? null)}`;
  };
  const what = metric === 'str' ? 'Strength change from each person’s own start' : metric === 'vol' ? 'Weekly sets against each person’s usual' : 'PRs so far';

  return (<>
    <MetricChips list={LINE_METRICS} on={metric} onPick={(m) => { setScrub(null); onMetric(m); }} />
    <p className="cmp-exp">{metric === 'str' ? <>Each line starts at <b>their own</b> 0, so the steepest climb wins, not the heaviest bar.</>
      : metric === 'vol' ? <>Working sets a week so far against <b>their own</b> usual; each line starts once a quarter of the range is in.</>
      : <>PRs so far this range, each against <b>their own</b> history.</>}</p>
    <div className="cmp-ovl" ref={box}>
      {lead && (
        <p className="cmp-readout" aria-live="polite">
          {scrub != null ? <><b>{shortDay(at[scrub])}</b> · {readout(lead, scrub)}{!lead.me && lines.some((r) => r.me) && <> · {readout(lines.find((r) => r.me)!, scrub)}</>}</>
            : <><b>{readout(lead, null)}</b>{!lead.me && lines.some((r) => r.me) && <> · {readout(lines.find((r) => r.me)!, null)}</>} · since {shortDay(at[0])}</>}
        </p>
      )}
      {width > 0 && lines.length > 0 && (
        <svg className="cmp-chart" width={w} height={h} role="img" aria-label={`${what}, ${RANGE_LABEL[range]}: ${ends.map((e) => readout(e.r, null)).join(', ')}`}
          onPointerDown={pick} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); }} onPointerLeave={() => setScrub(null)}>
          {tk.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className={t === 0 ? 'cmp-base' : 'cmp-grid'} />
              <text x={padL - 6} y={Y(t) + 4} textAnchor="end">{unit(t)}</text>
            </g>
          ))}
          {scrub != null && <line x1={X(scrub)} x2={X(scrub)} y1={padT} y2={h - padB} className="cmp-scrub" />}
          {drawOrder.map(({ r }) => {
            const on = !f || r.uid === f;
            return <path key={r.uid} d={path(vals.get(r.uid)!.line!)} fill="none" stroke={r.colour} strokeWidth={r.uid === f ? 2.75 : r.me ? 2.25 : 1.75}
              strokeLinejoin="round" strokeLinecap="round" opacity={on ? 1 : 0.3} />;
          })}
          {ends.map((e, i) => {
            const on = !f || e.r.uid === f, y = labY[i];
            return (
              <g key={e.r.uid} opacity={on ? 1 : 0.45}>
                <circle cx={X(e.k)} cy={Y(e.v)} r={3} fill={e.r.colour} />
                {Math.abs(y - 4 - Y(e.v)) > 3 && <line x1={X(e.k) + 3} y1={Y(e.v)} x2={X(POINTS - 1) + 9} y2={y - 4} stroke={e.r.colour} strokeWidth={1} opacity={0.7} />}
                <circle cx={X(POINTS - 1) + 12} cy={y - 4} r={3} fill={e.r.colour} />
                <text className={`cmp-lab${e.r.me ? ' me' : ''}${e.r.uid === f ? ' on' : ''}`} x={X(POINTS - 1) + 18} y={y}>{short(e.r.tag)}</text>
              </g>
            );
          })}
          {scrub != null && ends.map((e) => { const v = valueAt(e.r, scrub); return v == null ? null : <circle key={e.r.uid} cx={X(scrub)} cy={Y(v)} r={3.5} fill={e.r.colour} className="cmp-ring" opacity={!f || e.r.uid === f ? 1 : 0.4} />; })}
          <text x={padL} y={h - 4} textAnchor="start">{shortDay(at[0])}</text>
          <text x={X(POINTS - 1)} y={h - 4} textAnchor="end">{shortDay(at[POINTS - 1])}</text>
        </svg>
      )}
    </div>
    {lines.length > 0 && (
      <div className="cmp-who" role="group" aria-label="Lines: tap one to pick it out">
        {ends.map(({ r }) => (
          <button key={r.uid} className={`cmp-wchip${r.me ? ' me' : ''}`} aria-pressed={r.uid === f} onClick={() => { setFocus(r.uid === f ? null : r.uid); }}>
            <span className="cmp-k" style={{ background: r.colour }} aria-hidden="true" />
            <span className="cmp-wn">{r.me ? 'You' : r.name}</span>
            <span className="cmp-wv">{fmt(metric, vals.get(r.uid)!.v)}</span>
          </button>
        ))}
      </div>
    )}
    {none.length > 0 && <p className="cmp-foot">No line yet: {none.map((r) => (r.me ? 'you' : r.tag)).join(', ')} ({metric === 'str' ? 'no lift shared with anyone here' : 'no usual before this range'}).</p>}
    <p className="cmp-foot">Tap a name to pick out their line. Every line has its name at its end.</p>
  </>);
}

// ---- Firsts: raw loads only here, as each person's own milestone; by date, never ranked ----

function Firsts({ rows, today }: { rows: Row[]; today: string }) {
  const [all, setAll] = useState(false);
  const since = addDays(today, -364);
  const list = rows.flatMap((r) => (r.s?.firsts ?? []).filter((x) => x.d >= since).map((x) => ({ ...x, r })))
    .sort((a, b) => b.d.localeCompare(a.d) || b.w - a.w);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 10);
  const who = (r: Row) => (r.me ? 'You' : r.tag);
  return (
    <section className="cmp-firsts" aria-label="Firsts">
      <div className="fd-sec"><h2>Firsts</h2><span>milestones · by date, never ranked</span></div>
      <ol>
        {shown.map((x, i) => (
          <li key={`${x.r.uid}|${x.n}|${x.d}|${i}`}>
            <span className="cmp-tro" aria-hidden="true"><Icon name="trophy" size={22} /></span>
            <span className="cmp-what"><b>{who(x.r)}</b> · first {x.w > 0 ? <b>{x.w} lb {x.n}</b> : <>bodyweight <b>{x.n}</b></>}</span>
            <span className="cmp-when">{shortDay(x.d)}</span>
          </li>
        ))}
      </ol>
      {list.length > 10 && <button className="quiet-btn cmp-more" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </section>
  );
}
