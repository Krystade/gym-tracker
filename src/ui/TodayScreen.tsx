import { useEffect, useState } from 'react';
import { planToRecord } from '../domain/program';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import type { ProgramStore } from '../state/useProgram';
import { exerciseNames, sameExercise } from '../domain/stats';
import { fmtDay } from '../domain/format';
import { ExerciseCard } from './ExerciseCard';
import { Energy } from './Energy';
import { plannedSets } from '../domain/suggest';
import { activeProfileDb } from '../db/db';
import { getDraft, saveDraft } from '../state/drafts';

const CARDS = '#cards';
import { ExercisePicker } from './ExercisePicker';
import { swapSuggestions } from '../domain/care';
import { TodayPlan, todayPlanFor } from './TodayPlan';
import { WeighIn } from './WeighIn';
import type { BodyStore } from '../state/useBody';
import type { GymsStore } from '../state/useGyms';
import { availableSet } from '../domain/equipment';
import { CATALOG } from '../domain/catalog';
import { addDays } from '../domain/analytics';

export function TodayScreen({ store, settings, programs, body, gyms, date, today, carried, onSplit, onDay, onOpen, onOpenProgram }: {
  store: SetsStore; settings: SettingsStore; programs: ProgramStore; body: BodyStore; gyms: GymsStore; date: string; today: string;
  carried?: boolean; onSplit?: () => void; onDay: (d: string) => void; onOpen: (name: string) => void; onOpenProgram: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  // Cards added but not logged yet: kept per profile for the day, so leaving the tab or switching profile keeps them.
  const [owner] = useState(activeProfileDb);
  // One list per day, so opening a past day doesn't overwrite today's.
  const [extra, setExtra] = useState<string[]>(() => getDraft<string[]>(owner, `${CARDS}:${date}`, date) ?? []);
  useEffect(() => { saveDraft(owner, `${CARDS}:${date}`, date, extra); }, [owner, date, extra]);
  const logged = exerciseNames(store.entries.filter((e) => e.date === date)).reverse();
  const cards = [...logged, ...extra.filter((x) => !logged.some((l) => sameExercise(l, x)))];
  const plan = todayPlanFor(programs, store.entries, date);
  // Record the day once a working set is logged, so rotation and adherence don't depend on tapping the plan.
  // Only today: looking back at an older day must not record it and move today's rotation.
  useEffect(() => {
    if (!programs.program || date !== today) return;
    const r = planToRecord(programs.program, programs.plans, store.entries, date);
    if (r) void programs.savePlan(r);
  }, [programs.program, programs.plans, programs.savePlan, store.entries, date, today]);
  const addCard = (n: string) => setExtra((xs) => (xs.some((x) => sameExercise(x, n)) ? xs : [...xs, n]));
  // A new card lands at the bottom, off-screen: bring it up. Null = automatic (folded once any card is on screen).
  const [planOpen, setPlanOpen] = useState<boolean | null>(null);
  const open = planOpen ?? cards.length === 0;
  const [jump, setJump] = useState<string | null>(null);
  const goTo = (n: string) => { addCard(n); setPlanOpen(false); setJump(n); };
  useEffect(() => {
    if (!jump || picking || swapFor) return;
    document.querySelector(`[data-card="${CSS.escape(jump.toLowerCase())}"]`)?.scrollIntoView({ block: 'start' });
    setJump(null);
  }, [jump, picking, swapFor]);
  const hasPlan = date >= today || programs.plans.some((p) => p.date === date) || logged.length > 0;

  const available = gyms.active ? availableSet(gyms.active, [...CATALOG, ...exerciseNames(store.entries), ...gyms.active.include]) : undefined;
  if (picking) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} onCancel={() => setPicking(false)}
    onPick={(n) => { goTo(n); setPicking(false); }} />;
  if (swapFor && plan) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} suggested={swapSuggestions(swapFor, store.entries, date, 5, available)} onCancel={() => setSwapFor(null)}
    onPick={(n) => { void programs.savePlan({ ...plan, swaps: { ...plan.swaps, [swapFor]: n } }); goTo(n); setSwapFor(null); }} />;

  return (
    <>
      <div className="today-head">
        <div className="day-switch">
          <button className="mini" aria-label="Previous day" onClick={() => onDay(addDays(date, -1))}>‹</button>
          <h1>{fmtDay(date, today)}</h1>
          <button className="mini" aria-label="Next day" disabled={date >= today} onClick={() => onDay(addDays(date, 1))}>›</button>
        </div>
        <button onClick={onOpenProgram}>Program</button>
      </div>
      {date < today && <p className="card note-card past-day"><span>Logging to a past day</span><button className="mini" style={{ whiteSpace: 'nowrap' }} onClick={() => onDay(today)}>Back to today</button></p>}
      {carried && <p className="card note-card past-day"><span>Still logging {fmtDay(today, today)}’s workout</span><button className="mini" style={{ whiteSpace: 'nowrap' }} onClick={onSplit}>Today</button></p>}
      <WeighIn body={body} date={date} />
      <Energy body={body} date={date} />
      {programs.program && plan && hasPlan && (
        <TodayPlan program={programs.program} plan={plan} entries={store.entries} past={date < today} open={open} onToggle={() => setPlanOpen(!open)}
          onChange={(p) => void programs.savePlan(p)} onOpen={goTo} onSwap={setSwapFor} />
      )}
      {cards.length === 0 && <p className="muted">{date < today ? 'Nothing logged that day.' : 'Nothing logged yet today.'}</p>}
      {cards.map((n) => <ExerciseCard key={n.toLowerCase()} exercise={n} date={date} today={today} store={store} settings={settings} onOpen={onOpen}
        plannedSets={plannedSets(programs.program, plan, n)} gym={gyms.active?.name} />)}
      <button className="primary wide" onClick={() => setPicking(true)}>Add exercise</button>
    </>
  );
}
