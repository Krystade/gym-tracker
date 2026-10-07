import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { useSettings } from '../state/useSettings';
import { useProfile } from '../state/useProfile';
import { useProgram } from '../state/useProgram';
import { useBody } from '../state/useBody';
import { usePhotos } from '../state/usePhotos';
import { useSync } from '../state/useSync';
import { useGyms, type GymsStore } from '../state/useGyms';
import { usePeople, type PeopleStore } from '../state/usePeople';
import type { Person } from '../db/db';
import { ProfileBar } from './ProfileBar';
import { ProfileDbProvider } from '../state/profileDb';
import { useFittedProfile } from '../state/useFittedProfile';
import { getDraft, saveDraft } from '../state/drafts';
import { sameExercise } from '../domain/stats';
import { sessionDay } from '../domain/timing';

/** Puts an exercise on Today's cards (the same list Today keeps for cards not logged yet). */
function logToday(profile: string, date: string, exercise: string) {
  const cards = getDraft<string[]>(profile, `#cards:${date}`, date) ?? [];
  if (!cards.some((c) => sameExercise(c, exercise))) saveDraft(profile, `#cards:${date}`, date, [...cards, exercise]);
}
/** A renamed lift's card on Today follows it to the new name. */
function renameToday(profile: string, date: string, from: string, to: string) {
  const cards = getDraft<string[]>(profile, `#cards:${date}`, date);
  if (cards?.some((c) => sameExercise(c, from))) saveDraft(profile, `#cards:${date}`, date, [...new Set(cards.map((c) => (sameExercise(c, from) ? to : c)))]);
}
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
import { Walkthrough, walkthroughPending } from './Walkthrough';

type Tab = 'today' | 'history' | 'lifts' | 'stats' | 'data';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['stats', 'Stats'], ['data', 'Data']];

export default function App() {
  const people = usePeople();
  const gyms = useGyms();
  if (!people.active) return <div className="app"><main className="screen"><p className="muted">Loading…</p></main></div>;
  // Everything personal remounts on a switch, reading the new profile's database; where you are in the app stays.
  return <Shell people={people} gyms={gyms} />;
}

function Shell({ people, gyms }: { people: PeopleStore; gyms: GymsStore }) {
  const [programOpen, setProgramOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [tour, setTour] = useState(walkthroughPending);
  const [tab, setTab] = useState<Tab>('today');
  const [exercise, setExercise] = useState<string | null>(null);
  const [date, setDate] = useState(() => localDate(new Date()));
  const [, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  // The day Today logs to, when it isn't today (a forgotten set); cleared on any profile switch, so a past day never resurfaces.
  const pid = people.active!.id;
  const [chosen, setChosen] = useState<{ id: string; day: string } | null>(null);
  const [seenPid, setSeenPid] = useState(pid);
  if (seenPid !== pid) { setSeenPid(pid); setChosen(null); }
  const logDay = chosen?.id === pid ? chosen.day : null;
  const setLogDay = (d: string | null) => setChosen(d ? { id: pid, day: d } : null);
  useEffect(() => {
    // The minute ticks too: past midnight the day a workout carries to can end with the date unchanged.
    const onVis = () => { setDate(localDate(new Date())); setMinute(Math.floor(Date.now() / 60_000)); };
    document.addEventListener('visibilitychange', onVis);
    // An app left open across midnight gets no event, so look again every minute.
    const id = setInterval(onVis, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
  }, []);
  const open = (name: string) => { setExercise(name); window.scrollTo(0, 0); };
  const nav = { tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, open, showTour: () => setTour(true) };

  return (
    <div className="app">
      <ProfileDbProvider key={people.active!.id} id={people.active!.id}>
        <PersonScreens person={people.active!} people={people} gyms={gyms} nav={nav} />
      </ProfileDbProvider>
      {tour && <Walkthrough onClose={() => setTour(false)} />}
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} aria-current={tab === t && !exercise && !programOpen && !photosOpen && !pasteOpen ? 'page' : undefined} onClick={() => { setTab(t); if (t === 'today') setLogDay(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); }}>{label}</button>
        ))}
      </nav>
    </div>
  );
}

interface Nav {
  tab: Tab; exercise: string | null; date: string; logDay: string | null; setLogDay: (d: string | null) => void; programOpen: boolean; photosOpen: boolean; pasteOpen: boolean;
  setTab: (t: Tab) => void; setExercise: (x: string | null) => void; setProgramOpen: (b: boolean) => void; setPhotosOpen: (b: boolean) => void; setPasteOpen: (b: boolean) => void;
  open: (name: string) => void; showTour: () => void;
}

function PersonScreens({ person, people, gyms, nav }: { person: Person; people: PeopleStore; gyms: GymsStore; nav: Nav }) {
  const store = useSets();
  const settings = useSettings();
  const rawProfile = useProfile();
  const programs = useProgram();
  const body = useBody();
  const photos = usePhotos();
  const sync = useSync(store, body, person);
  const { tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, open, showTour } = nav;
  // Past midnight a workout stays on its day until its last set is 3 hours old; "Today" on the banner ends that for the day.
  const [carryOff, setCarryOff] = useState<string | null>(null);
  const day = carryOff === date ? date : sessionDay(store.entries, date, new Date());
  // Every screen reads targets fitted to your week; the Data tab imports and exports the stored profile as it is.
  const profile = useFittedProfile(rawProfile, programs.program, store.entries, day);
  const error = store.error ?? programs.error ?? body.error ?? photos.error ?? gyms.error ?? people.error;

  return (
    <>
      {error && <div role="alert" className="banner">{error}</div>}
      <main className="screen">
        <ProfileBar people={people} />
        {store.loading ? <p className="muted">Loading…</p>
          : pasteOpen ? <PasteScreen store={store} today={date} onBack={() => setPasteOpen(false)} onDone={() => { setPasteOpen(false); setTab('history'); window.scrollTo(0, 0); }} />
          : photosOpen ? <PhotosScreen photos={photos} body={body} today={date} onBack={() => setPhotosOpen(false)} />
          : programOpen ? <ProgramScreen programs={programs} profile={profile} entries={store.entries} gyms={gyms} onBack={() => setProgramOpen(false)} />
          : exercise ? <ExerciseScreen name={exercise} store={store} settings={settings} gyms={gyms} programs={programs} date={day} onBack={() => setExercise(null)}
            onRenamed={(to) => { renameToday(person.id, day, exercise, to); setExercise(to); window.scrollTo(0, 0); }}
            onLog={() => { logToday(person.id, day, exercise); setLogDay(null); setExercise(null); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'today' ? <TodayScreen key={logDay ?? day} who={people.people.length > 1 ? person.name : undefined} store={store} settings={settings} programs={programs} body={body} gyms={gyms} profile={profile.profile} date={logDay ?? day} today={day}
            carried={day !== date && !logDay} onSplit={() => setCarryOff(date)}
            onDay={(d) => { setLogDay(d === day ? null : d); window.scrollTo(0, 0); }} onOpen={open} onOpenProgram={() => { setProgramOpen(true); window.scrollTo(0, 0); }} />
          : tab === 'history' ? <HistoryScreen store={store} onOpen={open} onAddTo={(d) => { setLogDay(d === day ? null : d); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
          : tab === 'stats' ? <StatsScreen store={store} profile={profile} programs={programs} body={body} photos={photos} today={date} onOpenPhotos={() => { setPhotosOpen(true); window.scrollTo(0, 0); }} />
          : <DataScreen store={store} profile={rawProfile} body={body} sync={sync} people={people} onOpenPaste={() => { setPasteOpen(true); window.scrollTo(0, 0); }} onShowWalkthrough={showTour} />}
      </main>
    </>
  );
}
