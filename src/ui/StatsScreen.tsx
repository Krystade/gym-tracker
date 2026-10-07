import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { FittedProfileStore } from '../state/useFittedProfile';
import type { ProgramStore } from '../state/useProgram';
import { adherence } from '../domain/program';
import { addDays, calendarDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { MUSCLES } from '../domain/muscles';
import type { Tier } from '../domain/profile';
import { fmtWeight, plural } from '../domain/format';
import { BarChart } from './charts/BarChart';
import { MuscleBars, weekPace } from './charts/MuscleBars';
import { Calendar } from './charts/Calendar';
import { ChartTable } from './charts/ChartTable';
import { CareCard } from './CareCard';
import { BodyCard } from './BodyCard';
import type { BodyStore } from '../state/useBody';
import type { PhotosStore } from '../state/usePhotos';
import { PhotosCard } from './PhotosScreen';

const tons = (n: number) => (n >= 1000 ? `${fmtWeight(Math.round(n / 100) / 10)}k` : fmtWeight(Math.round(n)));
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

const fmtN = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** One priority's weekly range: fitted to the week, or yours, with a way to set it or hand it back. */
function TierTarget({ t, profile }: { t: Tier; profile: FittedProfileStore }) {
  const [lo, hi] = profile.profile.targets[t];
  const mine = profile.fit.custom.includes(t);
  const [edit, setEdit] = useState<[string, string] | null>(null);
  const v = edit && [Number(edit[0]), Number(edit[1])] as [number, number];
  const ok = !!v && v.every((n) => Number.isFinite(n) && n >= 0 && n <= 40) && v[0] <= v[1] && edit!.every((x) => x.trim() !== '');
  return (
    <li className="tier-target">
      <span>{t} · {fmtN(lo)}–{fmtN(hi)} sets · <span className="muted">{mine ? 'yours' : 'auto'}</span></span>
      {edit ? (
        <span className="tier-edit">
          <label>Min<input aria-label="Min" inputMode="decimal" value={edit[0]} onChange={(e) => setEdit([e.target.value, edit[1]])} /></label>
          <label>Max<input aria-label="Max" inputMode="decimal" value={edit[1]} onChange={(e) => setEdit([edit[0], e.target.value])} /></label>
          <button className="mini" disabled={!ok} onClick={async () => { await profile.setTarget(t, v); setEdit(null); }}>Save</button>
        </span>
      ) : mine
        ? <button className="mini" onClick={() => void profile.setTarget(t, null)}>Use auto</button>
        : <button className="mini" onClick={() => setEdit([fmtN(lo), fmtN(hi)])}>Edit</button>}
    </li>
  );
}

function Priorities({ profile }: { profile: FittedProfileStore }) {
  const p = profile.profile;
  const [goal, setGoal] = useState(String(p.weeklyGoal));
  return (
    <section className="card">
      <h2>Priorities</h2>
      <label className="goal-row">Sessions per week goal
        <input aria-label="Sessions per week goal" inputMode="numeric" value={goal}
          onChange={(e) => {
            setGoal(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 7) void profile.save({ ...p, weeklyGoal: n });
          }} />
      </label>
      <section className="sub" role="group" aria-label="Weekly sets">
        <p className="muted small">Weekly sets per muscle, fitted to {profile.budget.sessions} sessions × {profile.budget.perSession} sets. 1 gets the most, 4 the least.</p>
        <ol className="tier-targets">{([1, 2, 3, 4] as Tier[]).map((t) => <TierTarget key={t} t={t} profile={profile} />)}</ol>
      </section>
      <div className="prio-grid">
        {MUSCLES.map((m) => (
          <label key={m}>{m}
            <select aria-label={m} value={p.tiers[m]} onChange={(e) => void profile.save({ ...p, tiers: { ...p.tiers, [m]: Number(e.target.value) as Tier } })}>
              {([1, 2, 3, 4] as Tier[]).map((t) => <option key={t} value={t}>{t} · {p.targets[t][0]}–{p.targets[t][1]} sets</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

export function StatsScreen({ store, profile, programs, body, photos, today, onOpenPhotos }: {
  store: SetsStore; profile: FittedProfileStore; programs: ProgramStore; body: BodyStore; photos: PhotosStore; today: string; onOpenPhotos: () => void;
}) {
  const p = profile.profile;
  if (!store.entries.length) return (<><h1>Stats</h1><p className="muted">No sessions yet — log a workout or import your history on the Data tab.</p><BodyCard body={body} today={today} /><PhotosCard photos={photos} onOpen={onOpenPhotos} /></>);
  const weeks = weeklySummary(store.entries, 12, today);
  const st = streak(weeklySummary(store.entries, 104, today), p.weeklyGoal);
  const thisWeek = weeks.at(-1)!;
  const muscle = weeklyMuscleSets(store.entries, weekStart(today));
  const lastWeek = weeklyMuscleSets(store.entries, weeks.at(-2)!.week);
  // 12 whole Monday–Sunday columns, the last one running to today.
  const days = calendarDays(store.entries, 11 * 7 + 1 + (Date.parse(today) - Date.parse(weekStart(today))) / 864e5, today);
  const adh = programs.program ? adherence(programs.program, programs.plans, store.entries, addDays(today, -27), today) : null;
  return (
    <>
      <h1>Stats</h1>
      <section className="card">
        <h2>This week</h2>
        <div className="tiles">
          <div className="tile"><span>Sessions</span><b>{thisWeek.sessions} of {p.weeklyGoal}</b></div>
          <div className="tile"><span>Weekly streak</span><b>{plural(st.current, 'week')}</b></div>
          <div className="tile"><span>Sets</span><b>{thisWeek.sets}</b></div>
          <div className="tile"><span>Best streak</span><b>{plural(st.best, 'week')}</b></div>
          {adh && adh.planned > 0 && <div className="tile wide"><span>Program, 4 weeks</span><b>{Math.round((100 * adh.done) / adh.planned)}% · {adh.done} / {adh.planned} sets</b></div>}
        </div>
      </section>
      <section className="card">
        <h2>Muscle volume</h2>
        <p className="muted small">Fractional sets this week (direct 1, indirect ½), against each priority’s target range (outlined). “On pace” is short of the target but keeping up with the week so far.</p>
        <MuscleBars sets={muscle.sets} profile={p} pace={weekPace(today)} />
        {muscle.unmapped.length > 0 && <p className="muted small">Not counted (unknown muscles): {muscle.unmapped.join(', ')}</p>}
        <ChartTable caption="Fractional sets per muscle" head={['Muscle', 'This week / last week']}
          rows={MUSCLES.map((m) => [m, `${fmt(muscle.sets[m])} / ${fmt(lastWeek.sets[m])}`])} />
      </section>
      <section className="card">
        <h2>Sessions per week</h2>
        <BarChart label="Sessions per week, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.sessions }))} format={(n) => plural(n, 'session')} goal={p.weeklyGoal} />
        <p className="muted small">Dashed line: your goal of {plural(p.weeklyGoal, 'session')}.</p>
        <ChartTable caption="Sessions per week" head={['Week of', 'Sessions']} rows={weeks.map((w) => [w.week, String(w.sessions)])} />
      </section>
      <section className="card">
        <h2>Weekly tonnage</h2>
        <BarChart label="Weekly tonnage in pounds, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.tonnage }))} format={(n) => `${tons(n)} lb`} tick={tons} unit="lb" />
        <ChartTable caption="Weekly tonnage (lb)" head={['Week of', 'Tonnage']} rows={weeks.map((w) => [w.week, String(Math.round(w.tonnage))])} />
      </section>
      <section className="card">
        <h2>Calendar</h2>
        <Calendar days={days} today={today} />
      </section>
      <BodyCard body={body} today={today} />
      <PhotosCard photos={photos} onOpen={onOpenPhotos} />
      <CareCard entries={store.entries} today={today} />
      <Priorities profile={profile} />
    </>
  );
}
