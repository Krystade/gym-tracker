import { useEffect, useState } from 'react';
import { useSets } from '../state/useSets';
import { useSettings } from '../state/useSettings';
import { useProfile } from '../state/useProfile';
import { useProgram } from '../state/useProgram';
import { useBody } from '../state/useBody';
import { usePhotos } from '../state/usePhotos';
import { useSync } from '../state/useSync';
import { useCloud } from '../state/useCloud';
import { useGyms, type GymsStore } from '../state/useGyms';
import { usePeople, type PeopleStore } from '../state/usePeople';
import type { Person } from '../db/db';
import { ProfileBar } from './ProfileBar';
import { ProfileDbProvider } from '../state/profileDb';
import { useFittedProfile } from '../state/useFittedProfile';
import { useStatus } from '../state/useStatus';
import { getDraft, saveDraft } from '../state/drafts';
import { exerciseNames, sameExercise } from '../domain/stats';
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
import { FriendsScreen } from './FriendsScreen';
import { FriendView, type FriendTab } from './FriendView';
import { CharactersScreen } from './CharactersScreen';
import { GymsScreen } from './GymsScreen';
import type { Friend } from '../cloud/friends';
import { parseInvite, type Invite } from '../domain/invite';
import { useOpenRoute, usePushSync } from '../push/usePush';
import { tabOf } from '../push/routes';

// An invite link opened in the app: kept until Friends can accept it, and gone from the address bar so a reload doesn't repeat it.
let launchInvite: Invite | null = typeof location !== 'undefined' ? parseInvite(location.hash) : null;
if (launchInvite) history.replaceState(null, '', location.pathname + location.search);

// Friends isn't on the bar: it opens from More and shows as More.
type Tab = 'today' | 'history' | 'lifts' | 'stats' | 'gym' | 'more' | 'friends';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['stats', 'Stats'], ['gym', 'Gym'], ['more', 'More']];
const FRIEND_TABS = TABS.filter(([t]) => t === 'history' || t === 'lifts' || t === 'stats');

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
  const [charsOpen, setCharsOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [tour, setTour] = useState(walkthroughPending);
  const [tab, setTab] = useState<Tab>(launchInvite ? 'friends' : 'today');
  const [pending, setPending] = useState(launchInvite);
  const [viewing, setViewing] = useState<Friend | null>(null);
  const [waiting, setWaiting] = useState(0);
  // A link opened in a tab where the app is already running changes only the hash.
  useEffect(() => {
    const on = () => {
      const i = parseInvite(location.hash);
      if (!i) return;
      history.replaceState(null, '', location.pathname + location.search);
      launchInvite = i; setPending(i); setViewing(null); setExercise(null); setTab('friends');
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [exercise, setExercise] = useState<string | null>(null);
  // A notification tap: its screen, with nothing on top.
  useOpenRoute((r) => {
    setViewing(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false);
    setTab(tabOf(r)); window.scrollTo(0, 0);
  });
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
  // The tab you're on. A screen opened over a tab (Program, Photos, Paste, Characters) keeps More lit when More opened it,
  // since its Back goes there; from Today or Stats it lights nothing. An exercise lights nothing.
  const overlay = programOpen || photosOpen || pasteOpen || charsOpen;
  const current = (t: Tab) => !exercise && (overlay ? t === 'more' && tab === 'more' : tab === t || (t === 'more' && tab === 'friends'));
  const nav = { tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, charsOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, setCharsOpen, open,
    // The walkthrough points at Today, so it opens there.
    pending, waiting, setWaiting, clearPending: () => { launchInvite = null; setPending(null); },
    view: (f: Friend) => { setViewing(f); setTab('stats'); setExercise(null); window.scrollTo(0, 0); },
    showTour: () => { setViewing(null); setTab('today'); setLogDay(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); window.scrollTo(0, 0); setTour(true); } };

  return (
    <div className="app">
      {/* Under the clock and battery: with no sticky bar on top, a scrolled card would show through the status bar. */}
      <div className="status-backdrop" aria-hidden="true" />
      {/* Your screens stay mounted while you look at a friend's, so your log keeps syncing and Back finds you where you were. */}
      <div hidden={!!viewing}>
        <ProfileDbProvider key={people.active!.id} id={people.active!.id}>
          <PersonScreens person={people.active!} people={people} gyms={gyms} nav={nav} />
        </ProfileDbProvider>
      </div>
      {viewing && <FriendView key={viewing.uid} friend={viewing} tab={tab as FriendTab} exercise={exercise} today={date} gyms={gyms} onOpen={open}
        onExerciseBack={() => setExercise(null)} onBack={() => { setViewing(null); setExercise(null); setTab('friends'); window.scrollTo(0, 0); }} />}
      {tour && <Walkthrough onClose={() => setTour(false)} />}
      <nav className="tabs" aria-label="Sections">
        {(viewing ? FRIEND_TABS : TABS).map(([t, label]) => (
          <button key={t} data-tour={t} aria-current={current(t) ? 'page' : undefined} onClick={() => { setTab(t); if (t === 'today') setLogDay(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); }}>
            {label}{t === 'more' && waiting > 0 && <span className="tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

interface Nav {
  tab: Tab; exercise: string | null; date: string; logDay: string | null; setLogDay: (d: string | null) => void; programOpen: boolean; photosOpen: boolean; pasteOpen: boolean; charsOpen: boolean;
  setTab: (t: Tab) => void; setExercise: (x: string | null) => void; setProgramOpen: (b: boolean) => void; setPhotosOpen: (b: boolean) => void; setPasteOpen: (b: boolean) => void; setCharsOpen: (b: boolean) => void;
  open: (name: string) => void; showTour: () => void;
  pending: Invite | null; clearPending: () => void; waiting: number; setWaiting: (n: number) => void; view: (f: Friend) => void;
}

function PersonScreens({ person, people, gyms, nav }: { person: Person; people: PeopleStore; gyms: GymsStore; nav: Nav }) {
  const store = useSets();
  const settings = useSettings();
  const rawProfile = useProfile();
  const programs = useProgram();
  const body = useBody();
  const photos = usePhotos();
  const status = useStatus();
  const sync = useSync(store, body, person);
  // Settings pulled from the account are saved on the phone, then every screen reads them again.
  const cloud = useCloud(store, body, person, {
    reload: () => { void rawProfile.reload(); void programs.reload(); void settings.reload(); void gyms.reload(); void status.reload(); },
    onRequests: nav.setWaiting,
    rev: [rawProfile.profile, programs.program, programs.plans, settings.get, settings.tags, gyms.gyms, status.status],
  });
  const { tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, charsOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, setCharsOpen, open, showTour } = nav;
  // A screen opened from More goes back to it by name; from anywhere else it's plain Back.
  const back = tab === 'more' ? '‹ More' : '‹ Back';
  const top = (fn: () => void) => () => { fn(); window.scrollTo(0, 0); };
  const uid = cloud.mine ? cloud.link?.uid : null;
  // Push: the reminder and recap numbers, for the person whose account this is (signed out: this phone's subscription goes).
  usePushSync(store.entries, programs.program, programs.plans, date, cloud.link === null ? false : cloud.mine ? true : null);
  // Past midnight a workout stays on its day until its last set is 3 hours old; "Today" on the banner ends that for the day.
  const [carryOff, setCarryOff] = useState<string | null>(null);
  const day = carryOff === date ? date : sessionDay(store.entries, date, new Date());
  // Every screen reads targets fitted to your week; More imports and exports the stored profile as it is.
  const profile = useFittedProfile(rawProfile, programs.program, store.entries, day);
  const error = store.error ?? programs.error ?? body.error ?? photos.error ?? gyms.error ?? people.error;

  return (
    <>
      {error && <div role="alert" className="banner">{error}</div>}
      <main className="screen">
        <ProfileBar people={people} />
        {store.loading ? <p className="muted">Loading…</p>
          : pasteOpen ? <PasteScreen store={store} today={date} backLabel={back} onBack={() => setPasteOpen(false)} onDone={() => { setPasteOpen(false); setTab('history'); window.scrollTo(0, 0); }} />
          : charsOpen ? <CharactersScreen backLabel={back} onBack={() => setCharsOpen(false)} />
          : photosOpen ? <PhotosScreen photos={photos} body={body} today={date} backLabel={back} onBack={() => setPhotosOpen(false)} />
          : programOpen ? <ProgramScreen programs={programs} profile={profile} entries={store.entries} gyms={gyms} uid={uid} backLabel={back} onBack={() => setProgramOpen(false)}
            onOpenPriorities={() => { setProgramOpen(false); setTab('stats'); requestAnimationFrame(() => document.getElementById('priorities')?.scrollIntoView({ block: 'start' })); }} />
          : exercise ? <ExerciseScreen name={exercise} store={store} settings={settings} gyms={gyms} programs={programs} date={day} onBack={() => setExercise(null)}
            onRenamed={(to) => { renameToday(person.id, day, exercise, to); setExercise(to); window.scrollTo(0, 0); }}
            onLog={() => { logToday(person.id, day, exercise); setLogDay(null); setExercise(null); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'today' ? <TodayScreen key={logDay ?? day} who={people.people.length > 1 ? person.name : undefined} store={store} settings={settings} programs={programs} body={body} gyms={gyms} profile={profile.profile} date={logDay ?? day} today={day}
            carried={day !== date && !logDay} onSplit={() => setCarryOff(date)}
            onDay={(d) => { setLogDay(d === day ? null : d); window.scrollTo(0, 0); }} onOpen={open} onOpenProgram={top(() => setProgramOpen(true))} onOpenGym={top(() => setTab('gym'))} />
          : tab === 'history' ? <HistoryScreen store={store} onOpen={open} onAddTo={(d) => { setLogDay(d === day ? null : d); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
          : tab === 'friends' ? <FriendsScreen cloud={cloud} gyms={gyms} pending={nav.pending} entries={store.entries} status={status} today={date} onPendingDone={nav.clearPending} onView={nav.view} onRequests={nav.setWaiting}
            onSignIn={top(() => setTab('more'))} onBack={top(() => setTab('more'))} onOpenMine={top(() => setTab('history'))} />
          : tab === 'gym' ? <GymsScreen gyms={gyms} logged={exerciseNames(store.entries)} uid={uid} />
          : tab === 'stats' ? <StatsScreen store={store} profile={profile} programs={programs} body={body} photos={photos} today={date} onOpenPhotos={() => { setPhotosOpen(true); window.scrollTo(0, 0); }} />
          : <DataScreen store={store} profile={rawProfile} body={body} sync={sync} cloud={cloud} people={people} requests={nav.waiting} onOpenPaste={top(() => setPasteOpen(true))} onShowWalkthrough={showTour}
            onOpenCharacters={top(() => setCharsOpen(true))} onOpenFriends={top(() => setTab('friends'))} onOpenProgram={top(() => setProgramOpen(true))} onOpenPhotos={top(() => setPhotosOpen(true))} />}
      </main>
    </>
  );
}
