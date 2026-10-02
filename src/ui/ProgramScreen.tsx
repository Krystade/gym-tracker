import { useState } from 'react';
import type { SetEntry } from '../domain/types';
import type { ProfileStore } from '../state/useProfile';
import type { ProgramStore } from '../state/useProgram';
import { buildProgram, MAX_SETS_PER_DAY, programVolume, type Program } from '../domain/program';
import { defaultSettings } from '../domain/progression';
import { exerciseNames } from '../domain/stats';
import { MuscleBars } from './charts/MuscleBars';
import { ExercisePicker } from './ExercisePicker';
import { BACK_BLOCK, isHold } from '../domain/care';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { DEFAULT_LOW_SHARE } from '../domain/profile';
import { GymsScreen } from './GymsScreen';
import { estimateSeconds, paces, perSessionForMinutes } from '../domain/timing';
import { warmupCount } from '../domain/suggest';
import { localDate } from '../domain/ids';
import type { ProgramDay } from '../domain/program';

export function ProgramScreen({ programs, profile, entries, gyms, onBack }: { programs: ProgramStore; profile: ProfileStore; entries: SetEntry[]; gyms: GymsStore; onBack: () => void }) {
  const p = programs.program;
  const [days, setDays] = useState(String(p?.days.length ?? profile.profile.weeklyGoal));
  const [per, setPer] = useState(String(p?.perSession ?? 14));
  const [addTo, setAddTo] = useState<number | null>(null);
  const [mode, setMode] = useState<'sets' | 'minutes'>('sets');
  const [mins, setMins] = useState('60');
  const [gymsOpen, setGymsOpen] = useState(false);
  const share = profile.profile.lowShare ?? DEFAULT_LOW_SHARE;
  const setShare = (v: number) => void profile.save({ ...profile.profile, lowShare: Math.round(Math.min(0.5, Math.max(0, v)) * 100) / 100 });
  const unset = Object.values(profile.profile.tiers).every((t) => t === 3);
  const gym = gyms.active;
  const d = Number(days), s = Number(per), m = Number(mins);
  const valid = Number.isInteger(d) && d >= 1 && d <= 6 && (mode === 'sets' ? Number.isInteger(s) && s >= 8 && s <= 20 : Number.isInteger(m) && m >= 20 && m <= 150);
  const today = localDate(new Date());
  const pace = paces(entries);
  const dayMinutes = (day: ProgramDay) => Math.round(estimateSeconds(day.slots, pace, (ex) => warmupCount(entries, ex, today)) / 60);

  const edit = (fn: (x: Program) => void) => { if (!p) return; const next: Program = structuredClone(p); fn(next); void programs.save(next); };

  if (gymsOpen) return <GymsScreen gyms={gyms} logged={exerciseNames(entries)} onBack={() => { setGymsOpen(false); window.scrollTo(0, 0); }} />;
  if (addTo != null) return <ExercisePicker recent={exerciseNames(entries)} gym={gym} onCancel={() => setAddTo(null)} onPick={(name) => {
    const st = defaultSettings(name);
    edit((x) => { if (!x.days[addTo].slots.some((sl) => sl.exercise === name)) x.days[addTo].slots.push({ exercise: name, sets: 3, repMin: st.repMin, repMax: st.repMax }); });
    setAddTo(null);
  }} />;

  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Program</h1>
      {unset && (
        <section className="card note-card">
          <p><b>Priorities aren’t set.</b> Every muscle is priority 3, so the plan spreads sets evenly over all of them. Set priorities on Stats, or import your profile file on Data, then build.</p>
        </section>
      )}
      <section className="card">
        {gym ? (
          <div className="today-head"><span>Gym: <b>{gym.name}</b></span><button className="mini" onClick={() => setGymsOpen(true)}>Change</button></div>
        ) : (
          <button className="wide" onClick={() => { const n = { id: `g${Date.now().toString(36)}`, name: 'My gym', equipment: [], exclude: [], include: [] }; void gyms.save([...gyms.gyms, n], n.id); setGymsOpen(true); }}>Set up your gym</button>
        )}
        <p className="muted small">{gym ? 'Only lifts this gym can do are used.' : 'Without a gym, any lift can be picked.'}</p>
      </section>
      <section className="card">
        <p className="muted small">Built from your priorities: each set goes to the priority muscle furthest below its weekly target, using the lifts you actually do. Full-body days: an exercise with enough weekly sets repeats on every day, so priority muscles are trained each session.</p>
        <div className="settings-grid two">
          <label>Days per week<input aria-label="Days per week" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          {mode === 'sets'
            ? <label>Sets per session<input aria-label="Sets per session" inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value)} /></label>
            : <label>Minutes per session<input aria-label="Minutes per session" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} /></label>}
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
          if (p && !confirm('Replace the current program?')) return;
          const ctx = gym ? { available: availableSet(gym, [...CATALOG, ...exerciseNames(entries), ...gym.include]), include: gym.include } : {};
          const build = (perSession: number) => buildProgram(profile.profile, entries, { days: d, perSession }, new Date(), ctx);
          // By minutes: the most sets per session whose every day fits, estimated from your own pace.
          void programs.save(build(mode === 'minutes' ? perSessionForMinutes(m, build, dayMinutes) : s));
        }}>{p ? 'Rebuild program' : 'Build program'}</button>
        {p?.unavailable?.length ? <p className="warn small">Nothing at this gym trains: {p.unavailable.join(', ')}.</p> : null}
      </section>
      {p && p.days.map((day, di) => (
        <section className="card" key={day.name}>
          <h2>{day.name} · {day.slots.reduce((a, x) => a + x.sets, 0)} sets · ≈ {dayMinutes(day)} min</h2>
          <ol className="prog-slots" aria-label={`${day.name} exercises`}>
            {day.slots.map((slot, si) => (
              <li key={slot.exercise}>
                <span className="prog-name"><b>{slot.exercise}</b>{p.newToYou?.includes(slot.exercise) && <span className="tag">new to you</span>}<span className="muted small">{slot.repMin}–{slot.repMax}{isHold(slot.exercise) ? ' s hold' : ' reps'}</span></span>
                <button aria-label={`Fewer sets of ${slot.exercise}`} disabled={slot.sets <= 1} onClick={() => edit((x) => { x.days[di].slots[si].sets--; })}>−</button>
                <span className="prog-sets">{slot.sets}</span>
                <button aria-label={`More sets of ${slot.exercise}`} disabled={slot.sets >= MAX_SETS_PER_DAY + 2} onClick={() => edit((x) => { x.days[di].slots[si].sets++; })}>+</button>
                <button aria-label={`Remove ${slot.exercise}`} onClick={() => edit((x) => { x.days[di].slots.splice(si, 1); })}>×</button>
              </li>
            ))}
          </ol>
          <button className="wide" onClick={() => setAddTo(di)}>Add exercise to {day.name}</button>
        </section>
      ))}
      {p && (
        <section className="card">
          <h2>Back resilience</h2>
          <p className="muted small">McGill’s big 3 (bird dog, side plank, curl-up) as timed holds, 2 sets of 20–40 s on every day. Core endurance work helps with non-specific low back pain.</p>
          <button className="wide" disabled={p.days.every((dd) => BACK_BLOCK.every((b) => dd.slots.some((sl) => sl.exercise === b.exercise)))}
            onClick={() => edit((x) => { for (const dd of x.days) for (const b of BACK_BLOCK) if (!dd.slots.some((sl) => sl.exercise === b.exercise)) dd.slots.push({ ...b }); })}>Add back-resilience block</button>
        </section>
      )}
      {p && (
        <section className="card">
          <h2>Weekly volume</h2>
          <p className="muted small">Fractional sets per week if you run every day once, against your priority targets.</p>
          <MuscleBars sets={programVolume(p)} profile={profile.profile} />
        </section>
      )}
    </>
  );
}
