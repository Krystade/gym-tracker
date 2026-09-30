import { useState } from 'react';
import type { SetsStore } from '../state/useSets';
import type { SettingsStore } from '../state/useSettings';
import { exerciseNames, sameExercise } from '../domain/stats';
import { fmtDate } from '../domain/format';
import { ExerciseCard } from './ExerciseCard';
import { ExercisePicker } from './ExercisePicker';

export function TodayScreen({ store, settings, date, onOpen }: { store: SetsStore; settings: SettingsStore; date: string; onOpen: (name: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const logged = exerciseNames(store.entries.filter((e) => e.date === date)).reverse();
  const cards = [...logged, ...extra.filter((x) => !logged.some((l) => sameExercise(l, x)))];

  if (picking) return <ExercisePicker recent={exerciseNames(store.entries)} onCancel={() => setPicking(false)}
    onPick={(n) => { setExtra((xs) => [...xs, n]); setPicking(false); }} />;

  return (
    <>
      <h1>{fmtDate(date)}</h1>
      {cards.length === 0 && <p className="muted">Nothing logged yet today.</p>}
      {cards.map((n) => <ExerciseCard key={n.toLowerCase()} exercise={n} date={date} store={store} settings={settings} onOpen={onOpen} />)}
      <button className="primary wide" onClick={() => setPicking(true)}>Add exercise</button>
    </>
  );
}
