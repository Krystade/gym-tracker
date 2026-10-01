import { useEffect, useState } from 'react';
import { planToRecord } from '../domain/program';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import type { ProgramStore } from '../state/useProgram';
import { exerciseNames, sameExercise } from '../domain/stats';
import { fmtDate } from '../domain/format';
import { ExerciseCard } from './ExerciseCard';
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

export function TodayScreen({ store, settings, programs, body, gyms, date, onOpen, onOpenProgram }: {
  store: SetsStore; settings: SettingsStore; programs: ProgramStore; body: BodyStore; gyms: GymsStore; date: string; onOpen: (name: string) => void; onOpenProgram: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  // Cards added but not logged yet: kept per profile for the day, so leaving the tab or switching profile keeps them.
  const [owner] = useState(activeProfileDb);
  const [extra, setExtra] = useState<string[]>(() => getDraft<string[]>(owner, CARDS, date) ?? []);
  useEffect(() => { saveDraft(owner, CARDS, date, extra); }, [owner, date, extra]);
  const logged = exerciseNames(store.entries.filter((e) => e.date === date)).reverse();
  const cards = [...logged, ...extra.filter((x) => !logged.some((l) => sameExercise(l, x)))];
  const plan = todayPlanFor(programs, store.entries, date);
  // Record the day once a working set is logged, so rotation and adherence don't depend on tapping the plan.
  useEffect(() => {
    if (!programs.program) return;
    const r = planToRecord(programs.program, programs.plans, store.entries, date);
    if (r) void programs.savePlan(r);
  }, [programs.program, programs.plans, programs.savePlan, store.entries, date]);
  const addCard = (n: string) => setExtra((xs) => (xs.some((x) => sameExercise(x, n)) ? xs : [...xs, n]));

  const available = gyms.active ? availableSet(gyms.active, [...CATALOG, ...exerciseNames(store.entries), ...gyms.active.include]) : undefined;
  if (picking) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} onCancel={() => setPicking(false)}
    onPick={(n) => { addCard(n); setPicking(false); }} />;
  if (swapFor && plan) return <ExercisePicker recent={exerciseNames(store.entries)} gym={gyms.active} suggested={swapSuggestions(swapFor, store.entries, date, 5, available)} onCancel={() => setSwapFor(null)}
    onPick={(n) => { void programs.savePlan({ ...plan, swaps: { ...plan.swaps, [swapFor]: n } }); addCard(n); setSwapFor(null); }} />;

  return (
    <>
      <div className="today-head">
        <h1>{fmtDate(date)}</h1>
        <button onClick={onOpenProgram}>Program</button>
      </div>
      <WeighIn body={body} date={date} />
      {programs.program && plan && (
        <TodayPlan program={programs.program} plan={plan} entries={store.entries}
          onChange={(p) => void programs.savePlan(p)} onOpen={addCard} onSwap={setSwapFor} />
      )}
      {cards.length === 0 && <p className="muted">Nothing logged yet today.</p>}
      {cards.map((n) => <ExerciseCard key={n.toLowerCase()} exercise={n} date={date} store={store} settings={settings} onOpen={onOpen} />)}
      <button className="primary wide" onClick={() => setPicking(true)}>Add exercise</button>
    </>
  );
}
