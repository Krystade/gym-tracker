import { useEffect, useMemo, useState } from 'react';
import type { SetEntry } from '../domain/types';
import type { ProfileStore } from '../state/useProfile';
import type { ProgramStore } from '../state/useProgram';
import { addSlot, cardioSlot, MAX_SETS_PER_DAY, programVolume, rebuildLike, type Program } from '../domain/program';
import { isCardio } from '../domain/cardio';
import { defaultSettings } from '../domain/progression';
import { exerciseNames } from '../domain/stats';
import { MuscleBars } from './charts/MuscleBars';
import { ExercisePicker } from './ExercisePicker';
import { BACK_BLOCK, isHoldLift } from '../domain/care';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { PROGRAM_LIFTS } from '../domain/catalog';
import { DEFAULT_LOW_SHARE, goalOf, type Profile } from '../domain/profile';
import { GymsScreen } from './GymsScreen';
import { sessionLengths, sizing } from '../domain/learn/session';
import { atPace, sizedHow, sizedSeconds } from './TodayPlan';
import { aimsOn, dayEstimate } from './ProgramUpdate';
import type { BodyDay } from '../domain/body';
import { activeProfileDb } from '../db/db';
import { MUSCLES, type Muscle } from '../domain/muscles';
import { warmupCount } from '../domain/suggest';
import { localDate } from '../domain/ids';
import type { ProgramDay } from '../domain/program';
import { Input } from './Field';

export function ProgramScreen({ programs, profile, entries, body = [], gyms, uid, backLabel = '‹ Back', keptRest, onBack, onOpenPriorities }: { programs: ProgramStore; profile: ProfileStore; entries: SetEntry[]; /** His energy, for the volume steps' holds. */ body?: readonly BodyDay[]; gyms: GymsStore; uid?: string | null; backLabel?: string; /** His rest setting for a lift, if any: the plan's rests. */ keptRest?: (exercise: string) => number | undefined; onBack: () => void; onOpenPriorities: () => void }) {
  const p = programs.program;
  const [days, setDays] = useState(String(p?.days.length ?? profile.profile.weeklyGoal));
  const [per, setPer] = useState(String(p?.perSession ?? 14));
  const [addTo, setAddTo] = useState<number | null>(null);
  // A program built by minutes reopens sized by minutes.
  const [mode, setMode] = useState<'sets' | 'minutes'>(p?.minutes != null ? 'minutes' : 'sets');
  const [mins, setMins] = useState(String(p?.minutes ?? 60));
  const [gymsOpen, setGymsOpen] = useState(false);
  // The last lift removed, so one tap puts it back where it was.
  const [removed, setRemoved] = useState<{ day: number; at: number; slot: ProgramDay['slots'][number] } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 8000);
    return () => clearTimeout(t);
  }, [removed]);
  const share = profile.profile.lowShare ?? DEFAULT_LOW_SHARE;
  const setShare = (v: number) => void profile.save({ ...profile.profile, lowShare: Math.round(Math.min(0.5, Math.max(0, v)) * 100) / 100 });
  const unset = Object.values(profile.profile.tiers).every((t) => t === 3);
  const gym = gyms.active;
  // A gym saved before any gear was ticked: say that, rather than list every muscle it can't train.
  const bare = !!gym && gym.equipment.length === 0 && gym.include.length === 0;
  const d = Number(days), s = Number(per), m = Number(mins);
  const valid = Number.isInteger(d) && d >= 1 && d <= 6 && (mode === 'sets' ? Number.isInteger(s) && s >= 8 && s <= 20 : Number.isInteger(m) && m >= 20 && m <= 150);
  const today = localDate(new Date());
  // Warm-up counts per lift, worked out once per log change: the builder estimates many candidate programs.
  const warm = useMemo(() => {
    const cache = new Map<string, number>();
    return (ex: string) => {
      const k = ex.toLowerCase();
      if (!cache.has(k)) cache.set(k, warmupCount(entries, ex, today));
      return cache.get(k)!;
    };
  }, [entries, today]);
  // A day's plan length (the timer's rests, warm-ups, his switch overhead), and his recent pace for it.
  const lengths = (day: ProgramDay) => sessionLengths(entries, today, day.slots, { warmups: warm, kept: keptRest, fresh: true });
  // Built by minutes, a day is sized at his own pace once 2 days are timed (owner, 2026-10-20), else at the timer's rests.
  const est = useMemo(() => dayEstimate(entries, today, keptRest), [entries, today, keptRest]);
  const sizedBy = useMemo(() => sizing(entries, today).by, [entries, today]);
  const dayMinutes = (day: ProgramDay) => est(day);
  // Each muscle planned at item 07's aim: a +20 % step from his last 3 weeks, never the band at once (owner, 2026-10-20).
  const [owner] = useState(activeProfileDb);
  const aims = useMemo(() => aimsOn(entries, body, profile.profile, today, owner), [entries, body, profile.profile, today, owner]);

  // What the program was built for, not the input: the minutes box can change without a rebuild. Only at the 8-set floor is it a miss the builder couldn't fix.
  const budget = p?.minutes;
  const over = p && budget != null && p.perSession <= 8 ? p.days.filter((x) => dayMinutes(x) > budget) : [];

  // The program a rebuild replaced, until you undo it or change the new one.
  const [prev, setPrev] = useState<Program | null>(null);
  const edit = (fn: (x: Program) => void) => { if (!p) return; const next: Program = structuredClone(p); fn(next); next.edited = true; setRemoved(null); setPrev(null); void programs.save(next); };

  if (gymsOpen) return <GymsScreen gyms={gyms} logged={exerciseNames(entries)} fresh={!gym} uid={uid} onBack={() => { setGymsOpen(false); window.scrollTo(0, 0); }} />;
  if (addTo != null) return <ExercisePicker recent={exerciseNames(entries)} gym={gym} onCancel={() => setAddTo(null)} onPick={(name) => {
    const st = defaultSettings(name, undefined, goalOf(profile.profile));
    // A cardio machine goes in as a 15-minute slot, after the lifts; a lift goes before the day's cardio.
    edit((x) => { if (!x.days[addTo].slots.some((sl) => sl.exercise === name)) addSlot(x.days[addTo], isCardio(name) ? cardioSlot(name, 15) : { exercise: name, sets: 3, repMin: st.repMin, repMax: st.repMax }); });
    setAddTo(null);
  }} />;

  // With a program, the builder folds into "Rebuild program" below the days, so its cards lose their own frame.
  const frame = p ? 'sub' : 'card';
  // Above the days, not in the fold: which gym the plan is for is worth seeing without rebuilding. Once there are days, it's one line.
  const gymLine = p ? (
    <div className="today-head gym-head">
      <span>{gym ? <>Gym: <b className="pname">{gym.name}</b></> : <span className="muted">No gym: any lift can be picked</span>}</span>
      <button className="mini" onClick={() => setGymsOpen(true)}>{gym ? 'Change' : 'Set up your gym'}</button>
    </div>
  ) : (
    <section className="card">
      {gym ? (
        <div className="today-head"><span>Gym: <b>{gym.name}</b></span><button className="mini" onClick={() => setGymsOpen(true)}>Change</button></div>
      ) : (
        <button className="wide" onClick={() => setGymsOpen(true)}>Set up your gym</button>
      )}
      <p className="muted small">{gym ? 'Only lifts this gym can do are used.' : 'Without a gym, any lift can be picked.'}</p>
    </section>
  );
  const builder = (
    <>
      <section className={frame}>
        <p className="muted small">Built from your priorities: each set goes to the priority muscle furthest below this block’s aim, then toward its range, using the lifts you actually do. Full-body days: every day trains your priority muscles, with a different lift for a muscle where you have one.</p>
        {mode === 'minutes' && <p className="muted small" aria-label="How minutes are sized">{sizedBy === 'pace' ? 'Minutes are at your own pace: a day takes you about that long.' : 'Minutes are at the timer’s rests until 2 days are timed; then at your own pace.'}</p>}
        <div className="settings-grid two">
          <label>Days per week<Input aria-label="Days per week" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          {mode === 'sets'
            ? <label>Sets per session<Input aria-label="Sets per session" inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} /></label>
            : <label>Minutes per session<Input aria-label="Minutes per session" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></label>}
        </div>
        <div className="chips" role="group" aria-label="Session size">
          <span className="chip-label">Size by</span>
          <button type="button" className="chip" aria-pressed={mode === 'sets'} onClick={() => setMode('sets')}>Sets</button>
          <button type="button" className="chip" aria-pressed={mode === 'minutes'} onClick={() => setMode('minutes')}>Minutes</button>
        </div>
        <div className="share-row">
          <span>Low-priority share {Math.round(share * 100)}%</span>
          <button className="mini" aria-label="Less low-priority share" disabled={share <= 0} onClick={() => setShare(share - 0.05)}>−</button>
          <button className="mini" aria-label="More low-priority share" disabled={share >= 0.5} onClick={() => setShare(share + 0.05)}>+</button>
        </div>
        <p className="muted small">The most of each week spent on priority 3–4 muscles while priority 1–2 still need sets.</p>
        <button className="primary wide" disabled={!valid} onClick={() => {
          const ctx = gym ? { available: availableSet(gym, [...PROGRAM_LIFTS, ...exerciseNames(entries), ...gym.include]), include: gym.include } : {};
          setRemoved(null); // an undo for the old program must not land in the new one
          setPrev(p); // no confirm: the old program, edits and all, is one tap away
          // By minutes: the most sets per session whose every day fits, at your own pace.
          void programs.save(rebuildLike({ days: d, perSession: s, minutes: mode === 'minutes' ? m : undefined }, profile.profile, entries, new Date(), ctx, aims.ranges, dayMinutes, aims.held));
        }}>{p ? 'Rebuild program' : 'Build program'}</button>
        {prev && <p className="undo-note" role="status">Program rebuilt. <button className="mini" onClick={() => { void programs.save(prev); setPrev(null); }}>Undo</button></p>}
      </section>
    </>
  );

  return (
    <>
      <button className="back" onClick={onBack}>{backLabel}</button>
      <h1>Program</h1>
      {unset && (
        <section className="card note-card">
          <p><b>Priorities aren’t set.</b> Every muscle is priority 3, so the plan spreads sets evenly over all of them. Set them under More › Priorities and goal, or import your profile file under Backup, then build.</p>
          <button className="mini" onClick={onOpenPriorities}>Set priorities</button>
        </section>
      )}
      {gymLine}
      {!p && builder}
      {over.length > 0 && <p className="warn small" role="status">{over.map((x) => `${x.name} ≈ ${dayMinutes(x)} min`).join(', ')}: over your {budget}. Train fewer days a week or allow more minutes, then rebuild.</p>}
      {bare ? <p className="warn small">No gear ticked at {gym.name}: only bodyweight lifts are used.</p>
        : p?.unavailable?.length ? <p className="warn small">Nothing at this gym trains: {p.unavailable.join(', ')}.</p> : null}
      {p?.short && !p.edited && <p className="warn small" role="status" aria-label="Fewer sets than asked">{shortLine(p)}</p>}
      {p?.cardioUnavailable && <p className="warn small">Cardio has a weekly goal, but no cardio machine is ticked at this gym.</p>}
      {p && p.days.map((day, di) => { const L = lengths(day); return (
        <section className="card" key={day.name}>
          <h2>{day.name} · {day.slots.reduce((a, x) => a + (x.minutes == null ? x.sets : 0), 0)} sets{p.minutes != null
            ? <> · ≈ {Math.round(sizedSeconds(L, sizedBy) / 60)} min<span className="muted small day-pace">{sizedHow(L, sizedBy)}</span></>
            : <> · ≈ {Math.round(L.plan / 60)} min{L.both && <span className="muted small day-pace">{atPace(L.pace!)}</span>}</>}</h2>
          <ol className="prog-slots" aria-label={`${day.name} exercises`}>
            {day.slots.map((slot, si) => slot.minutes != null ? (
              <li key={slot.exercise}>
                <span className="prog-name"><b>{slot.exercise}</b><span className="muted small">cardio</span></span>
                <button aria-label={`Less time on ${slot.exercise}`} disabled={slot.minutes <= 5} onClick={() => edit((x) => { x.days[di].slots[si].minutes! -= 5; })}>−</button>
                <span className="prog-sets">{slot.minutes}<span className="muted small"> min</span></span>
                <button aria-label={`More time on ${slot.exercise}`} disabled={slot.minutes >= 90} onClick={() => edit((x) => { x.days[di].slots[si].minutes! += 5; })}>+</button>
                <button aria-label={`Remove ${slot.exercise}`} onClick={() => { const gone = slot; edit((x) => { x.days[di].slots.splice(si, 1); }); setRemoved({ day: di, at: si, slot: gone }); }}>×</button>
              </li>
            ) : (
              <li key={slot.exercise}>
                <span className="prog-name"><b>{slot.exercise}</b>{p.newToYou?.includes(slot.exercise) && <span className="tag">new to you</span>}<span className="muted small">{slot.repMin}–{slot.repMax}{isHoldLift(slot.exercise, entries) ? ' s hold' : ' reps'}</span></span>
                <button aria-label={`Fewer sets of ${slot.exercise}`} disabled={slot.sets <= 1} onClick={() => edit((x) => { x.days[di].slots[si].sets--; })}>−</button>
                <span className="prog-sets">{slot.sets}</span>
                <button aria-label={`More sets of ${slot.exercise}`} disabled={slot.sets >= MAX_SETS_PER_DAY + 2} onClick={() => edit((x) => { x.days[di].slots[si].sets++; })}>+</button>
                <button aria-label={`Remove ${slot.exercise}`} onClick={() => { const gone = slot; edit((x) => { x.days[di].slots.splice(si, 1); }); setRemoved({ day: di, at: si, slot: gone }); }}>×</button>
              </li>
            ))}
          </ol>
          {removed?.day === di && (
            <p className="undo-note" role="status">Removed {removed.slot.exercise}. <button className="mini" onClick={() => edit((x) => { x.days[di].slots.splice(removed.at, 0, removed.slot); })}>Undo</button></p>
          )}
          <button className="wide" onClick={() => setAddTo(di)}>Add exercise to {day.name}</button>
        </section>
      ); })}
      {p && (
        <section className="card">
          <h2>Back resilience</h2>
          <p className="muted small">McGill’s big 3 (bird dog, side plank, curl-up) as timed holds, 2 sets of 20–40 s on every day. Core endurance work helps with non-specific low back pain.</p>
          <button className="wide" disabled={p.days.every((dd) => BACK_BLOCK.every((b) => dd.slots.some((sl) => sl.exercise === b.exercise)))}
            onClick={() => edit((x) => { for (const dd of x.days) for (const b of BACK_BLOCK) if (!dd.slots.some((sl) => sl.exercise === b.exercise)) addSlot(dd, { ...b }); })}>Add back-resilience block</button>
        </section>
      )}
      {p && (
        <section className="card">
          <h2>Weekly volume</h2>
          <p className="muted small">Fractional sets per week if you run every day once, against your priority targets.</p>
          <MuscleBars sets={programVolume(p)} profile={profile.profile} />
          <AimGaps p={p} profile={profile.profile} />
        </section>
      )}
      {p && <details className="card builder"><summary>Rebuild program</summary>{builder}</details>}
    </>
  );
}

/** "18 of 20 sets a session: every priority muscle is at the top of its range" (round 28: why a build stopped short). */
export function shortLine(p: Program): string {
  const lifted = p.days.map((d) => d.slots.reduce((a, x) => a + (x.minutes == null ? x.sets : 0), 0));
  const lo = Math.min(...lifted), hi = Math.max(...lifted);
  const head = p.minutes != null ? `Days are under your ${p.minutes} min` : `${lo === hi ? lo : `${lo}–${hi}`} of ${p.perSession} sets a session`;
  const why = p.short!.why === 'tops' ? 'every priority muscle is at the top of its range'
    : `every other priority muscle is at the top of its range, and no lift here has room for more ${p.short!.muscles.join(', ')}`;
  return `${head}: ${why}.`;
}

const fmtN = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
/**
 * The muscles planned at a step short of their range (owner, 2026-10-20): this block's aim and the sets still to go. Each 3-week
 * block steps up to 20 % on his own volume (a: Scarpelli 2022; more added nothing, Barsuhn 2025).
 */
function AimGaps({ p, profile }: { p: Program; profile: Profile }) {
  if (!p.aims) return null;
  // What the days plan, which can run a little past the aim (whole pairs of sets).
  const vol = programVolume(p), planned = (m: Muscle) => Math.max(p.aims![m]!, vol[m]);
  const rows = MUSCLES.filter((m) => p.aims![m] != null && profile.targets[profile.tiers[m]][0] - planned(m) >= 0.5)
    .sort((a, b) => profile.tiers[a] - profile.tiers[b]);
  if (!rows.length) return null;
  return (
    <div className="aim-gaps" role="group" aria-label="Short of the range">
      <p className="small"><b>Planned at this block’s step</b> · up to 20 % more each 3 weeks, toward each range. An update is offered on Today when a block ends.</p>
      <ul className="target-suggest-changes">
        {rows.map((m) => { const [lo, hi] = profile.targets[profile.tiers[m]]; const aim = planned(m); return (
          <li key={m} aria-label={`${m}: ${fmtN(aim)} a week planned, ${fmtN(lo - aim)} short of ${fmtN(lo)}–${fmtN(hi)}`}>
            <span>{m}</span><span>{fmtN(aim)}/wk</span><span><b>{fmtN(lo - aim)}</b> to {fmtN(lo)}–{fmtN(hi)}</span>
          </li>); })}
      </ul>
    </div>
  );
}
