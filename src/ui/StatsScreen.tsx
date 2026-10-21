import type { SetsStore } from '../state/useSets';
import type { FittedProfileStore } from '../state/useFittedProfile';
import type { ProgramStore } from '../state/useProgram';
import { adherence } from '../domain/program';
import { addDays, calendarDays, weekStart, weeklyMuscleSets, weeklySummary } from '../domain/analytics';
import { MUSCLES } from '../domain/muscles';
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
import { LastWeekCard } from './WeekDigest';
import { VolumeSteps } from './VolumeSteps';
import { Icon } from './icons';
import { goalLabel, Priorities } from './PrioritiesScreen';
import { thisWeekCardio } from '../domain/cardio';
import { BehindCard, PrCardView, Stronger, WeekRing } from './StatsCards';

const tons = (n: number) => (n >= 1000 ? `${fmtWeight(Math.round(n / 100) / 10)}k` : fmtWeight(Math.round(n)));
const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

/** A friend's Stats: no photos, and their priorities shown but not editable. */
export function StatsScreen({ store, profile, programs, body, photos, today, onOpenPhotos, readOnly, who, onOpenLift, onOpenPriorities }: {
  /** A friend's username: named wherever your own Stats says "your". */ who?: string;
  store: SetsStore; profile: FittedProfileStore; programs: ProgramStore; body: BodyStore; photos: PhotosStore | null; today: string; onOpenPhotos: () => void; readOnly?: boolean;
  /** A lift named on a card (Getting stronger, a muscle's fix): its screen. */ onOpenLift?: (name: string) => void;
  /** Priorities and the training goal live in settings (owner, 2026-10-20): a row here opens them. */ onOpenPriorities?: () => void;
}) {
  const p = profile.profile;
  const prioLink = !readOnly && onOpenPriorities && (
    <ul className="card more-list" aria-label="Settings">
      <li><button className="more-row" onClick={onOpenPriorities}><span>Priorities and goal</span><span className="more-note">{goalLabel(p)}</span><Icon name="chev-right" size={20} sw={2} className="more-chev" /></button></li>
    </ul>
  );
  // A friend's priorities stay on their Stats, read-only; your own are under More (owner, 2026-10-20).
  const friendPrio = (cardioMinutes: number) => readOnly && <Priorities profile={profile} readOnly who={who} cardioMinutes={cardioMinutes} entries={store.entries} today={today} />;
  // A new user sets priorities before the first workout, so they're here with an empty log too.
  const title = who ? `@${who}’s stats` : 'Stats';
  if (!store.entries.length) return (<><h1 className={who ? 'who-title' : undefined}>{title}</h1><p className="muted">{who ? `No sessions from @${who} yet.` : 'No sessions yet — log a workout or import your history under More.'}</p><BodyCard body={body} today={today} who={who} />{photos && <PhotosCard photos={photos} onOpen={onOpenPhotos} />}{prioLink}{friendPrio(0)}</>);
  const weeks = weeklySummary(store.entries, 12, today);
  const muscle = weeklyMuscleSets(store.entries, weekStart(today));
  const lastWeek = weeklyMuscleSets(store.entries, weeks.at(-2)!.week);
  // 12 whole Monday–Sunday columns, the last one running to today.
  const days = calendarDays(store.entries, 11 * 7 + 1 + (Date.parse(today) - Date.parse(weekStart(today))) / 864e5, today);
  const adh = programs.program ? adherence(programs.program, programs.plans, store.entries, addDays(today, -27), today) : null;
  return (
    <>
      <h1 className={who ? 'who-title' : undefined}>{title}</h1>
      <p className="st-sub">Week of <b>{new Date(`${weekStart(today)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b> · {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })}</p>
      <WeekRing entries={store.entries} profile={p} today={today} program={adh} who={who} />
      <PrCardView entries={store.entries} today={today} juice={!readOnly} who={who} />
      <Stronger entries={store.entries} today={today} onOpen={onOpenLift} />
      <BehindCard entries={store.entries} profile={p} today={today} onOpen={onOpenLift} who={who} />
      <LastWeekCard entries={store.entries} profile={p} today={today} />
      <section className="card">
        <h2>Muscle volume</h2>
        <p className="muted small">Fractional sets this week (direct 1, indirect ½; a chin-up’s biceps ¾), against each priority’s target range (outlined). “On pace” is short of the target but keeping up with the week so far.</p>
        <MuscleBars sets={muscle.sets} profile={p} pace={weekPace(today)} />
        {muscle.unmapped.length > 0 && <p className="muted small">Not counted (unknown muscles): {muscle.unmapped.join(', ')}</p>}
        {!readOnly && <VolumeSteps entries={store.entries} body={body.days} profile={p} today={today} />}
        <ChartTable caption="Fractional sets per muscle" head={['Muscle', 'This week / last week']}
          rows={MUSCLES.map((m) => [m, `${fmt(muscle.sets[m])} / ${fmt(lastWeek.sets[m])}`])} />
      </section>
      <section className="card">
        <h2>Sessions per week</h2>
        <BarChart label="Sessions per week, last 12 weeks" points={weeks.map((w) => ({ x: w.week, y: w.sessions }))} format={(n) => plural(n, 'session')} goal={p.weeklyGoal} />
        <p className="muted small">Dashed line: {who ? `@${who}’s` : 'your'} goal of {plural(p.weeklyGoal, 'session')}.</p>
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
      <BodyCard body={body} today={today} who={who} />
      {photos && <PhotosCard photos={photos} onOpen={onOpenPhotos} />}
      <CareCard entries={store.entries} today={today} who={who} />
      {prioLink}{friendPrio(thisWeekCardio(store.entries, today))}
    </>
  );
}
