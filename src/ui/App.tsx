import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { useSettings } from '../state/useSettings';
import { useProfile } from '../state/useProfile';
import { useProgram } from '../state/useProgram';
import { ProgramScreen } from './ProgramScreen';
import { localDate } from '../domain/ids';
import { TodayScreen } from './TodayScreen';
import { HistoryScreen } from './HistoryScreen';
import { LiftsScreen } from './LiftsScreen';
import { ExerciseScreen } from './ExerciseScreen';
import { DataScreen } from './DataScreen';
import { StatsScreen } from './StatsScreen';

type Tab = 'today' | 'history' | 'lifts' | 'stats' | 'data';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['stats', 'Stats'], ['data', 'Data']];

export default function App() {
  const store = useSets();
  const settings = useSettings();
  const profile = useProfile();
  const programs = useProgram();
  const [programOpen, setProgramOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [exercise, setExercise] = useState<string | null>(null);
  const [date, setDate] = useState(() => localDate(new Date()));
  useEffect(() => {
    const onVis = () => setDate(localDate(new Date()));
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const open = (name: string) => { setExercise(name); window.scrollTo(0, 0); };

  return (
    <div className="app">
      {(store.error ?? programs.error) && <div role="alert" className="banner">{store.error ?? programs.error}</div>}
      <main className="screen">
        {store.loading ? <p className="muted">Loading…</p>
          : programOpen ? <ProgramScreen programs={programs} profile={profile} entries={store.entries} onBack={() => setProgramOpen(false)} />
          : exercise ? <ExerciseScreen name={exercise} store={store} settings={settings} onBack={() => setExercise(null)} />
          : tab === 'today' ? <TodayScreen store={store} settings={settings} programs={programs} date={date} onOpen={open} onOpenProgram={() => { setProgramOpen(true); window.scrollTo(0, 0); }} />
          : tab === 'history' ? <HistoryScreen store={store} onOpen={open} />
          : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
          : tab === 'stats' ? <StatsScreen store={store} profile={profile} programs={programs} today={date} />
          : <DataScreen store={store} profile={profile} />}
      </main>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} aria-current={tab === t && !exercise && !programOpen ? 'page' : undefined} onClick={() => { setTab(t); setExercise(null); setProgramOpen(false); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
