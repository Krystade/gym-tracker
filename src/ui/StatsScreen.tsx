import { useEffect, useMemo, useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { FittedProfileStore } from '../state/useFittedProfile';
import type { ProgramStore } from '../state/useProgram';
import type { BodyStore } from '../state/useBody';
import type { SettingsStore } from '../state/useSettings';
import type { GymsStore } from '../state/useGyms';
import { tappedLight } from '../state/lightWeek';
import { availableSet } from '../domain/equipment';
import { PROGRAM_LIFTS } from '../domain/catalog';
import { kneePlan } from '../domain/learn/rest';
import { rotation } from '../domain/rotation';
import { exerciseNames } from '../domain/stats';
import { restSeconds } from '../domain/timing';
import { adherence } from '../domain/program';
import { addDays, weekStart } from '../domain/analytics';
import { plural } from '../domain/format';
import { liftKey } from '../domain/ids';
import { thisWeekCardio } from '../domain/cardio';
import { arrange, dayOrder, DEFAULT_RANGE, isRange, layoutOf, NO_LAYOUT, RANGES, rows, toggleHide, togglePin, WINDOW_RANGE, type LayoutPrefs, type Range } from '../domain/statsLayout';
import { MUSCLES, type Muscle } from '../domain/muscles';
import { defaultProfile } from '../domain/profile';
import type { SetEntry } from '../domain/types';
import { activeProfileDb } from '../db/db';
import { getPref, setPref } from '../state/prefs';
import { Priorities } from './PrioritiesScreen';
import { rotationDismissed } from './RotationSuggestion';
import { StatsSheet } from './StatsSheet';
import { StatsTile } from './StatsTile';
import { lastOf } from './StatsCoreSheets';
import { MuscleWeeks, SECTIONS, useTiles, WeekHero, WeekSheet, type TileModel } from './StatsTiles';
import { Icon } from './icons';
import { AchievementDetail } from './AchievementsSheet';
import { DEF } from '../domain/achievements';
import { useAchievements, useAchSince } from '../state/useAchievements';
import './stats.css';

// Stats v2 (plan §6): the week up top, one range for every tile, then sections of tiles two to a row. A tile opens its sheet.
// Your own Stats keeps what you pin and hide, and the day's news order, per profile; a friend's Stats shows theirs as it comes.

const SHEET_WEEK = '__week';
/** A muscle's weeks, opened from the Muscles sheet: `muscle:Chest`. */
const MUSCLE = 'muscle:';
const muscleOf = (open: string | null): Muscle | null => {
  const m = open?.startsWith(MUSCLE) ? open.slice(MUSCLE.length) : null;
  return m && (MUSCLES as readonly string[]).includes(m) ? (m as Muscle) : null;
};
/** An achievement family's levels, opened from the Achievements sheet: `ach:goal-weeks`. */
const ACH = 'ach:';
const achOf = (open: string | null): string | null => {
  const id = open?.startsWith(ACH) ? open.slice(ACH.length) : null;
  return id && DEF.has(id) ? id : null;
};

export function StatsScreen({ store, profile, programs, body, today, readOnly, who, settings, gyms, onOpenLift, onOpenPriorities, openAch, onOpenedAch }: {
  /** A friend's username: named wherever your own Stats says "your". */ who?: string;
  store: SetsStore; profile: FittedProfileStore; programs: ProgramStore; body: BodyStore; today: string; readOnly?: boolean;
  /** A lift named in a sheet: its screen. */ onOpenLift?: (name: string) => void;
  /** Priorities and the training goal live in settings (owner, 2026-10-20): the Muscles sheet's link opens them. */ onOpenPriorities?: () => void;
  /** Each lift's kept rest, for the rest tile's timer. */ settings?: SettingsStore;
  /** Your gyms: a flat lift's next variation is one this gym can do, as on the lift's page. */ gyms?: GymsStore;
  /** Opened at an achievement family's levels (a line tapped on Today); `onOpenedAch` once it is. */ openAch?: string | null; onOpenedAch?: () => void;
}) {
  const p = profile.profile, entries = store.entries;
  const [owner] = useState(() => (readOnly ? null : activeProfileDb()));
  const [range, setRangeState] = useState<Range>(() => { const r = owner ? getPref<string>(owner, 'stats:range') : undefined; return isRange(r) ? r : DEFAULT_RANGE; });
  const [layout, setLayoutState] = useState<LayoutPrefs>(() => (owner ? layoutOf({ pins: getPref(owner, 'stats:pins'), hidden: getPref(owner, 'stats:hidden') }) : NO_LAYOUT));
  const [editing, setEditing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<string | null>(() => (openAch && !readOnly ? `ach:${openAch}` : null));
  // Asked for while already here (it isn't, from Today, but a second tap could be): open it; either way, it's been taken.
  useEffect(() => { if (!openAch) return; if (!readOnly) setOpen(`ach:${openAch}`); onOpenedAch?.(); }, [openAch]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRange = (r: Range) => { setRangeState(r); if (owner) setPref(owner, 'stats:range', r); };
  const setLayout = (l: LayoutPrefs) => { setLayoutState(l); if (owner) { setPref(owner, 'stats:pins', l.pins); setPref(owner, 'stats:hidden', l.hidden); } };

  // Pinned lifts stay even when they fall out of the four followed.
  const alsoLifts = useMemo(() => {
    const keys = new Set(layout.pins.filter((id) => id.startsWith('lift:')).map((id) => id.slice(5)));
    if (!keys.size) return [];
    const names = new Map<string, string>();
    for (const e of entries) { const k = liftKey(e.exercise); if (keys.has(k)) names.set(k, e.exercise); }
    return [...names.values()];
  }, [layout.pins, entries]);
  // The rest timer as it would run for each lift, at his usual effort: his setting, else the rest his sets taught it, else the
  // research default (timing.restFor's base). The learned rests read the same fit the lift tiles do (the log up to today).
  const timer = useMemo(() => {
    let knee: ReturnType<typeof kneePlan> | undefined;
    return (ex: string) => {
      if (knee === undefined) knee = kneePlan(entries, addDays(today, 1));
      return restSeconds(ex, settings?.get(ex).rest, knee?.(ex, [{ exercise: ex, ago: 0 }]) ?? null);
    };
  }, [entries, today, settings]);
  // A flat lift's next variation, as its page would offer it (and not once dismissed there).
  const rotationOf = useMemo(() => {
    if (!owner || readOnly) return undefined;
    const g = gyms?.active;
    const available = g ? availableSet(g, [...PROGRAM_LIFTS, ...exerciseNames(entries), ...g.include]) : undefined;
    return (lift: string) => {
      const r = rotation(entries, lift, today, { available, include: g?.include, program: programs.program, body: body.days, light: tappedLight(owner) });
      return r && !rotationDismissed(owner, r) ? r : null;
    };
  }, [owner, readOnly, gyms?.active, entries, today, programs.program, body.days]);
  // His rest setting per lift, for the next session's timer (and none set: undefined).
  const kept = useMemo(() => (settings ? (ex: string) => settings.get(ex).rest : undefined), [settings]);
  // Your achievements: lifetime, from the day this profile started counting (never on a friend's Stats).
  const since = useAchSince();
  const achAll = useAchievements(entries, today);
  const ach = useMemo(() => (owner && since && achAll ? { a: achAll, since, onOpen: (id: string) => setOpen(`${ACH}${id}`) } : undefined), [owner, since, achAll]);
  const tiles = useTiles({
    entries, profile: p, today, range, who, owner: owner ?? undefined, alsoLifts, body: body.days, timer, rotationOf, onOpenLift, onOpenPriorities,
    program: programs.program, plans: programs.plans, kept, onOpenMuscle: (m) => setOpen(`${MUSCLE}${m}`), ach,
  });

  // News to the front of its section, worked out once a day on the first open (owner, 2026-10-20).
  const [front] = useState(() => {
    if (!owner) return tiles.filter((t) => t.news).map((t) => t.id);
    const o = dayOrder(getPref(owner, 'stats:order'), today, () => tiles.filter((t) => t.news).map((t) => t.id));
    setPref(owner, 'stats:order', o);
    return o.front;
  });
  const adh = useMemo(() => (programs.program ? adherence(programs.program, programs.plans, entries, addDays(today, -27), today) : null), [programs.program, programs.plans, entries, today]);

  // No rows at the foot (IA A5, owner 2026-10-21): progress photos live on More only, and Priorities is setup (More, and the
  // Muscles sheet's "Priorities ›"). Body weight is a tile in the Body section.
  // A friend's priorities stay on their Stats, read-only; your own are under More (owner, 2026-10-20).
  const friendPrio = readOnly && <Priorities profile={profile} readOnly who={who} cardioMinutes={entries.length ? thisWeekCardio(entries, today) : 0} entries={entries} today={today} />;
  const title = who ? `@${who}’s stats` : 'Stats';

  // No sets yet: only Body can have anything to say (weigh-ins come first for some).
  if (!entries.length) {
    const sheetOf = open ? tiles.find((t) => t.id === open) : undefined;
    return (<>
      <h1 className={who ? 'who-title' : undefined}>{title}</h1>
      <p className="muted">{who ? `No sessions from @${who} yet.` : 'No sessions yet — log a workout or import your history under More.'}</p>
      {tiles.length > 0 && <section className="st-sec" aria-label="Body"><h2>Body</h2>{rows(tiles).map((r) => <div key={r[0].id} className="st-row">{r.map((t) => <StatsTile key={t.id} t={t} onOpen={() => setOpen(t.id)} />)}</div>)}</section>}
      {friendPrio}
      {sheetOf && <StatsSheet title={sheetOf.title ?? sheetOf.label} link={sheetOf.link} onClose={() => setOpen(null)}>{sheetOf.sheet()}</StatsSheet>}
    </>);
  }

  const bySection = SECTIONS.map((s) => ({ id: s.id, tiles: tiles.filter((t) => t.section === s.id) }));
  const a = arrange(bySection, layout, front);
  const hiddenAll = a.sections.flatMap((s) => s.hidden);
  const opened = open && open !== SHEET_WEEK ? tiles.find((t) => t.id === open) : undefined;
  const muscle = muscleOf(open);
  const achId = ach ? achOf(open) : null;

  const tile = (t: TileModel) => (
    <StatsTile key={t.id} t={t} editing={editing} pinned={layout.pins.includes(t.id)} hidden={layout.hidden.includes(t.id)}
      onOpen={() => setOpen(t.id)} onPin={() => setLayout(togglePin(layout, t.id))} onHide={() => setLayout(toggleHide(layout, t.id))} extra={t.extra} />
  );
  const grid = (ts: TileModel[]) => rows(ts).map((r) => <div key={r[0].id} className="st-row">{r.map(tile)}</div>);

  return (
    <>
      <div className="st-title">
        <h1 className={who ? 'who-title' : undefined}>{title}</h1>
        {owner && <button type="button" className="st-edit" aria-pressed={editing} onClick={() => { setEditing(!editing); setShowHidden(false); }}>{editing ? 'Done' : 'Edit'}</button>}
      </div>
      {editing ? <p className="st-edit-hint">Pin a tile to keep it at the top. Hide one to tuck it away.</p> : (<>
        <WeekHero entries={entries} profile={p} today={today} who={who} onOpen={() => setOpen(SHEET_WEEK)} />
        <div className="st-range" role="group" aria-label="Range">
          {RANGES.map((r) => <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>
      </>)}
      {a.pinned.length > 0 && <section className="st-sec" aria-label="Pinned"><h2>Pinned</h2>{grid(a.pinned)}</section>}
      {SECTIONS.map((s, i) => {
        const sec = a.sections[i];
        const shown = editing || showHidden ? [...sec.shown, ...sec.hidden] : sec.shown;
        if (!shown.length) return null;
        return <section key={s.id} className="st-sec" aria-label={s.title}><h2>{s.title}</h2>{grid(shown)}</section>;
      })}
      {!editing && hiddenAll.length > 0 && (
        <p className="st-hidden-row">{plural(hiddenAll.length, 'tile')} hidden<button type="button" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Tuck away' : 'Show'}</button></p>
      )}
      {editing && (layout.pins.length > 0 || layout.hidden.length > 0) && <button type="button" className="st-reset" onClick={() => setLayout(NO_LAYOUT)}>Reset to default</button>}
      {friendPrio}
      {open === SHEET_WEEK && (
        <StatsSheet title="This week" onClose={() => setOpen(null)}>
          <p className="st-sub">Week of <b>{new Date(`${weekStart(today)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b></p>
          <WeekSheet entries={entries} profile={p} today={today} who={who} program={adh} />
        </StatsSheet>
      )}
      {opened && <StatsSheet title={opened.title ?? opened.label} link={opened.link} onClose={() => setOpen(null)}>{opened.sheet()}</StatsSheet>}
      {muscle && (
        <StatsSheet key={muscle} title={`${muscle} · ${lastOf(range)}`} onClose={() => setOpen(null)}
          link={<button type="button" className="st-link st-back" onClick={() => setOpen('muscles')}><Icon name="chev-left" size={18} sw={2} />Muscles</button>}>
          <MuscleWeeks entries={entries} profile={p} today={today} range={range} muscle={muscle} />
        </StatsSheet>
      )}
      {achId && ach && (
        <StatsSheet key={achId} title={DEF.get(achId)!.title} onClose={() => setOpen(null)}
          link={<button type="button" className="st-link st-back" onClick={() => setOpen('achievements')}><Icon name="chev-left" size={18} sw={2} />Achievements</button>}>
          <AchievementDetail a={ach.a} id={achId} today={today} since={ach.since} />
        </StatsSheet>
      )}
    </>
  );
}

/**
 * A friend's Stats on their page, shown without a tap (owner, 2026-10-20: "their whole stats page"): the same tiles and sheets as
 * yours, read-only and named for them, from the line Friends already keeps of them (8 weeks of sets, their goal, the PR ids their
 * phone wrote), so it reads nothing. One range, those 8 weeks. Their week is the page's own head (ring, streak, sessions, PRs),
 * so there's no week tile; tiles that line can't fill, and the owner's own (energy), are left out (statsLayout forViewer).
 */
export function FriendStats({ who, entries, goal, prs, today }: { who: string; entries: SetEntry[]; goal: number; prs: ReadonlySet<string>; today: string }) {
  const profile = useMemo(() => ({ ...defaultProfile(), weeklyGoal: goal }), [goal]);
  const win = useMemo(() => ({ prs }), [prs]);
  const tiles = useTiles({ entries, profile, today, range: WINDOW_RANGE, who, window: win });
  // News to the front of its section, as on yours: fixed while the page is open.
  const [front] = useState(() => tiles.filter((t) => t.news).map((t) => t.id));
  const [open, setOpen] = useState<string | null>(null);
  if (!tiles.length) return null;
  const a = arrange(SECTIONS.map((s) => ({ id: s.id, tiles: tiles.filter((t) => t.section === s.id) })), NO_LAYOUT, front);
  const opened = open ? tiles.find((t) => t.id === open) : undefined;
  return (
    <section className="fp-stats" aria-label={`@${who}’s stats`}>
      <h2>Stats <span>last 8 weeks</span></h2>
      {SECTIONS.map((s, i) => {
        const shown = a.sections[i].shown;
        if (!shown.length) return null;
        return (
          <section key={s.id} className="st-sec" aria-label={s.title}>
            <h3>{s.title}</h3>
            {rows(shown).map((r) => <div key={r[0].id} className="st-row">{r.map((t) => <StatsTile key={t.id} t={t} onOpen={() => setOpen(t.id)} extra={t.extra} />)}</div>)}
          </section>
        );
      })}
      {opened && <StatsSheet title={opened.title ?? opened.label} link={opened.link} onClose={() => setOpen(null)}>{opened.sheet()}</StatsSheet>}
    </section>
  );
}
