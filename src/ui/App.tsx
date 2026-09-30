import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { localDate } from '../domain/ids';
import { TodayScreen } from './TodayScreen';

type Tab = 'today' | 'history' | 'lifts' | 'data';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['data', 'Data']];

export default function App() {
  const store = useSets();
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
      {store.error && <div role="alert" className="banner">{store.error}</div>}
      <main className="screen">
        {store.loading ? <p className="muted">Loading…</p>
          : tab === 'today' ? <TodayScreen store={store} date={date} onOpen={open} />
          : <p className="muted">Coming in the next task.</p>}
      </main>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} aria-current={tab === t && !exercise ? 'page' : undefined} onClick={() => { setTab(t); setExercise(null); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
