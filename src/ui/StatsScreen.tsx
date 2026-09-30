import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import type { ProgramStore } from '../state/useProgram';
import { adherence } from '../domain/program';
import { addDays, calendarDays, streak, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { MUSCLES } from '../domain/muscles';
import type { Tier } from '../domain/profile';
import { fmtWeight, plural } from '../domain/format';
import { BarChart } from './charts/BarChart';
import { MuscleBars } from './charts/MuscleBars';
import { Calendar } from './charts/Calendar';
import { ChartTable } from './charts/ChartTable';
import { CareCard } from './CareCard';

const tons = (n: number) => (n >= 1000 ? `${fmtWeight(Math.round(n / 100) / 10)}k` : fmtWeight(Math.round(n)));
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

function Priorities({ profile }: { profile: ProfileStore }) {
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
      <div className="prio-grid">
        {MUSCLES.map((m) => (
          <label key={m}>{m}
            <select aria-label={m} value={p.tiers[m]} onChange={(e) => void profile.save({ ...p, tiers: { ...p.tiers, [m]: Number(e.target.value) as Tier } })}>
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Priority {t}</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

export function StatsScreen({ store, profile, programs, today }: { store: SetsStore; profile: ProfileStore; programs: ProgramStore; today: string }) {
  const p = profile.profile;
  if (!store.entries.length) return (<><h1>Stats</h1><p className="muted">No sessions yet — log a workout or import your history on the Data tab.</p></>);
  const weeks = weeklySummary(store.entries, 12, today);
  const st = streak(weeklySummary(store.entries, 104, today), p.weeklyGoal);
  const thisWeek = weeks.at(-1)!;
  const muscle = weeklyMuscleSets(store.entries, weekStart(today));
  const lastWeek = weeklyMuscleSets(store.entries, weeks.at(-2)!.week);
  const days = calendarDays(store.entries, 16 * 7, today);
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
          <div className="tile"><span>Program sets, 4 weeks</span><b>{adh && adh.planned ? `${Math.round((100 * adh.done) / adh.planned)}%` : '—'}</b></div>
          <div className="tile"><span>Sets done / planned</span><b>{adh && adh.planned ? `${adh.done} / ${adh.planned}` : '—'}</b></div>
        </div>
      </section>
      <section className="card">
        <h2>Muscle volume</h2>
        <p className="muted small">Fractional sets this week (direct 1, indirect ½), against each priority’s target range (outlined).</p>
        <MuscleBars sets={muscle.sets} profile={p} />
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
        <BarChart label="Weekly tonnage in pounds, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.tonnage }))} format={(n) => `${tons(n)} lb`} tick={tons} />
        <ChartTable caption="Weekly tonnage (lb)" head={['Week of', 'Tonnage']} rows={weeks.map((w) => [w.week, String(Math.round(w.tonnage))])} />
      </section>
      <section className="card">
        <h2>Calendar</h2>
        <Calendar days={days} />
      </section>
      <CareCard entries={store.entries} today={today} />
      <Priorities profile={profile} />
    </>
  );
}
