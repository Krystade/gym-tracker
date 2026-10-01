import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { useSettings } from '../state/useSettings';
import { useProfile } from '../state/useProfile';
import { useProgram } from '../state/useProgram';
import { useBody } from '../state/useBody';
import { usePhotos } from '../state/usePhotos';
import { useSync } from '../state/useSync';
import { useGyms } from '../state/useGyms';
import { PhotosScreen } from './PhotosScreen';
import { PasteScreen } from './PasteScreen';
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
  const body = useBody();
  const photos = usePhotos();
  const sync = useSync(store, body);
  const gyms = useGyms();
  const [programOpen, setProgramOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
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
      {(store.error ?? programs.error ?? body.error ?? photos.error ?? gyms.error) && <div role="alert" className="banner">{store.error ?? programs.error ?? body.error ?? photos.error ?? gyms.error}</div>}
      <main className="screen">
        {store.loading ? <p className="muted">Loading…</p>
          : pasteOpen ? <PasteScreen store={store} today={date} onBack={() => setPasteOpen(false)} onDone={() => { setPasteOpen(false); setTab('history'); window.scrollTo(0, 0); }} />
          : photosOpen ? <PhotosScreen photos={photos} body={body} today={date} onBack={() => setPhotosOpen(false)} />
          : programOpen ? <ProgramScreen programs={programs} profile={profile} entries={store.entries} gyms={gyms} onBack={() => setProgramOpen(false)} />
          : exercise ? <ExerciseScreen name={exercise} store={store} settings={settings} gyms={gyms} onBack={() => setExercise(null)} />
          : tab === 'today' ? <TodayScreen store={store} settings={settings} programs={programs} body={body} gyms={gyms} date={date} onOpen={open} onOpenProgram={() => { setProgramOpen(true); window.scrollTo(0, 0); }} />
          : tab === 'history' ? <HistoryScreen store={store} onOpen={open} />
          : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
          : tab === 'stats' ? <StatsScreen store={store} profile={profile} programs={programs} body={body} photos={photos} today={date} onOpenPhotos={() => { setPhotosOpen(true); window.scrollTo(0, 0); }} />
          : <DataScreen store={store} profile={profile} body={body} sync={sync} onOpenPaste={() => { setPasteOpen(true); window.scrollTo(0, 0); }} />}
      </main>
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} aria-current={tab === t && !exercise && !programOpen && !photosOpen && !pasteOpen ? 'page' : undefined} onClick={() => { setTab(t); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}
