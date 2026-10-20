import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
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
import { useBox, useOwnBox, type Box } from '../state/box';
import { onMinute } from '../state/clock';
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
import { FriendPage } from './FriendPage';
import { CharactersScreen } from './CharactersScreen';
import { GymsScreen } from './GymsScreen';
import type { Friend, FriendNews } from '../cloud/friends';
import { loadCloud } from '../cloud/firebase';
import { prefetchSoon, readAfterPush, refreshChangedThreads, refreshNews, useFriendNews } from '../state/friendCache';
import { syncBadge, syncMuted } from '../push/client';
import { ThreadSheet, type ThreadWith } from './ThreadSheet';
import { parseInvite, type Invite } from '../domain/invite';
import { useOpenRoute, usePushSync } from '../push/usePush';
import { tabOf } from '../push/routes';
import { Icon, type IconName } from './icons';

// An invite link opened in the app: kept until Friends can accept it, and gone from the address bar so a reload doesn't repeat it.
let launchInvite: Invite | null = typeof location !== 'undefined' ? parseInvite(location.hash) : null;
if (launchInvite) history.replaceState(null, '', location.pathname + location.search);

// Gym isn't on the bar: it opens from More (or Today's gym line) over the tab, like Program.
type Tab = 'today' | 'history' | 'lifts' | 'stats' | 'friends' | 'more';
const TABS: [Tab, string][] = [['today', 'Today'], ['history', 'History'], ['lifts', 'Lifts'], ['stats', 'Stats'], ['friends', 'Friends'], ['more', 'More']];
/** Each tab's icon, and the filled one it shows while it's the current tab. */
const TAB_ICON: Record<Tab, [IconName, IconName]> = {
  today: ['today', 'today-on'], history: ['history', 'history-on'], lifts: ['lifts', 'lifts-on'], stats: ['stats', 'stats-on'], friends: ['friends', 'friends-on'], more: ['more', 'more'],
};

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
  const [gymOpen, setGymOpen] = useState(false);
  const [tour, setTour] = useState(walkthroughPending);
  const [tab, setTab] = useState<Tab>(launchInvite ? 'friends' : 'today');
  const [pending, setPending] = useState(launchInvite);
  const [viewing, setViewing] = useState<Friend | null>(null);
  // The signed-in account's uid (set by the person whose account it is), and the thread open over everything.
  const [me, setMe] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadWith | null>(null);
  // Friends' news (requests, gyms, unread pings and messages), as kept on the phone (state/friendCache): shown at once,
  // read again after a sync, a push, or anything done in Friends. Only the news: everything renders under here, so a Crew
  // line, a thread or the same news read again in the background doesn't take every screen through a render.
  const kept = useFriendNews(me);
  const news: FriendNews | null = (me && kept) || null;
  // Moves whenever the news should be read again; in a box, so a push or a sync moving it renders only what reads it.
  const newsRev = useOwnBox(0);
  const bumpNews = useCallback(() => newsRev.set((n) => n + 1), [newsRev]);
  const waiting = news?.total ?? 0;
  const meNow = useRef(me);
  meNow.current = me;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; kind?: string | null; route?: string | null } | null;
      if (d?.type !== 'push') return;
      bumpNews();
      // The friend it's about: their thread is read again now, so it's there when you open it.
      if (meNow.current) void readAfterPush(meNow.current, d.kind, d.route).catch(() => {});
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [bumpNews]);
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
  const [recapAt, setRecapAt] = useState(0);
  // A notification tap: its screen, with nothing on top.
  useOpenRoute((r) => {
    setViewing(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); setGymOpen(false);
    setTab(tabOf(r)); window.scrollTo(0, 0);
    // The recap opens today's Today at the week's digest.
    if (r === 'recap') { setChosen(null); setRecapAt(Date.now()); }
    // A friend's push opens their thread: one tap to answer with a ping.
    setThread(r.startsWith('friend.') ? { uid: r.slice('friend.'.length) } : null);
  });
  const [date, setDate] = useState(() => localDate(new Date()));
  // The day Today logs to, when it isn't today (a forgotten set); cleared on any profile switch, so a past day never resurfaces.
  const pid = people.active!.id;
  const [chosen, setChosen] = useState<{ id: string; day: string } | null>(null);
  const [seenPid, setSeenPid] = useState(pid);
  if (seenPid !== pid) { setSeenPid(pid); setChosen(null); }
  const logDay = chosen?.id === pid ? chosen.day : null;
  const setLogDay = (d: string | null) => setChosen(d ? { id: pid, day: d } : null);
  // An app left open across midnight gets no event, so look again every minute (and on coming back): the same date renders nothing.
  useEffect(() => onMinute(() => setDate(localDate(new Date()))), []);
  const open = (name: string) => { setExercise(name); window.scrollTo(0, 0); };
  // The tab you're on. A screen opened over a tab (Program, Photos, Paste, Characters, Gym) keeps More lit when More opened it,
  // since its Back goes there; from Today or Stats it lights nothing. An exercise lights nothing.
  const overlay = programOpen || photosOpen || pasteOpen || charsOpen || gymOpen;
  const current = (t: Tab) => !exercise && (overlay ? t === 'more' && tab === 'more' : tab === t);
  const nav = { recapAt, tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, charsOpen, gymOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, setCharsOpen, setGymOpen, open,
    // The walkthrough points at Today, so it opens there.
    pending, waiting, news, newsRev, bumpNews, setMe, openThread: (f: ThreadWith) => setThread(f), clearPending: () => { launchInvite = null; setPending(null); },
    viewing, view: (f: Friend) => { setViewing(f); setTab('friends'); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); setGymOpen(false); window.scrollTo(0, 0); },
    unview: () => { setViewing(null); window.scrollTo(0, 0); },
    showTour: () => { setViewing(null); setTab('today'); setLogDay(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); setGymOpen(false); window.scrollTo(0, 0); setTour(true); } };

  return (
    <div className="app">
      {/* Under the clock and battery: with no sticky bar on top, a scrolled card would show through the status bar. */}
      <div className="status-backdrop" aria-hidden="true" />
      {/* A friend's page opens inside Friends (FriendPage), on the same tab bar. */}
      <ProfileDbProvider key={people.active!.id} id={people.active!.id}>
        <PersonScreens person={people.active!} people={people} gyms={gyms} nav={nav} />
      </ProfileDbProvider>
      {thread && me && <ThreadSheet key={thread.uid} me={me} friend={thread} gyms={gyms} onClose={() => setThread(null)} onChanged={bumpNews}
        onViewLog={(f) => { setThread(null); nav.view(f); }} />}
      {tour && <Walkthrough onClose={() => setTour(false)} />}
      <nav className="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <button key={t} data-tour={t} aria-current={current(t) ? 'page' : undefined} onClick={() => { setTab(t); setViewing(null); if (t === 'today') setLogDay(null); setExercise(null); setProgramOpen(false); setPhotosOpen(false); setPasteOpen(false); setCharsOpen(false); setGymOpen(false); }}>
            <Icon name={TAB_ICON[t][current(t) ? 1 : 0]} size={26} />
            {label}{t === 'friends' && waiting > 0 && <span className="tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>
    </div>
  );
}

interface Nav {
  recapAt: number; tab: Tab; exercise: string | null; date: string; logDay: string | null; setLogDay: (d: string | null) => void; programOpen: boolean; photosOpen: boolean; pasteOpen: boolean; charsOpen: boolean; gymOpen: boolean;
  setTab: (t: Tab) => void; setExercise: (x: string | null) => void; setProgramOpen: (b: boolean) => void; setPhotosOpen: (b: boolean) => void; setPasteOpen: (b: boolean) => void; setCharsOpen: (b: boolean) => void; setGymOpen: (b: boolean) => void;
  open: (name: string) => void; showTour: () => void;
  pending: Invite | null; clearPending: () => void; waiting: number; viewing: Friend | null; view: (f: Friend) => void; unview: () => void;
  news: FriendNews | null; newsRev: Box<number>; bumpNews: () => void; setMe: (uid: string | null) => void; openThread: (f: ThreadWith) => void;
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
  // Friends' news after a sync, at most once a minute (a workout syncs after every set); anything done in Friends reads it at once.
  // And everything Friends shows, read in the background when the phone is idle after a sync, at most every 5 minutes.
  const newsAt = useRef(0);
  const account = useRef<{ uid: string | null; date: string }>({ uid: null, date: nav.date });
  const cloud = useCloud(store, body, person, {
    reload: () => { void rawProfile.reload(); void programs.reload(); void settings.reload(); void gyms.reload(); void status.reload(); },
    onSynced: () => {
      if (Date.now() - newsAt.current > 60_000) nav.bumpNews();
      const { uid: u, date: d } = account.current;
      if (u) prefetchSoon(u, d);
    },
    rev: [rawProfile.profile, programs.program, programs.plans, settings.get, settings.tags, gyms.gyms, status.status],
  });
  const { tab, exercise, date, logDay, setLogDay, programOpen, photosOpen, pasteOpen, charsOpen, gymOpen, setTab, setExercise, setProgramOpen, setPhotosOpen, setPasteOpen, setCharsOpen, setGymOpen, open, showTour } = nav;
  // A screen opened from More goes back to it by name; from anywhere else it's plain Back.
  const back = tab === 'more' ? '‹ More' : '‹ Back';
  const top = (fn: () => void) => () => { fn(); window.scrollTo(0, 0); };
  const uid = cloud.mine ? cloud.link?.uid : null;
  account.current = { uid: uid ?? null, date };
  const { setMe } = nav;
  useEffect(() => { setMe(uid ?? null); }, [uid, setMe]);
  // Push: the reminder and recap numbers, for the person whose account this is (signed out: this phone's subscription goes).
  usePushSync(store.entries, programs.program, programs.plans, date, cloud.link === null ? false : cloud.mine ? true : null);
  // A record tapped on a lift's screen: History opens at its day.
  const [historyAt, setHistoryAt] = useState<string | null>(null);
  // Past midnight a workout stays on its day until its last set is 3 hours old; "Today" on the banner ends that for the day.
  const [carryOff, setCarryOff] = useState<string | null>(null);
  const dayAt = (now: Date) => (carryOff === date ? date : sessionDay(store.entries, date, now));
  const day = dayAt(new Date());
  // That can end with the date unchanged, so each minute the day is looked at again; only a different day renders.
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const moved = useRef<() => boolean>(() => false);
  moved.current = () => dayAt(new Date()) !== day;
  useEffect(() => onMinute(() => { if (moved.current()) recheck(); }), []);
  // Every screen reads targets fitted to your week; More imports and exports the stored profile as it is.
  const profile = useFittedProfile(rawProfile, programs.program, store.entries, day);
  const error = store.error ?? programs.error ?? body.error ?? photos.error ?? gyms.error ?? people.error;

  return (
    <>
      {uid && <NewsReader uid={uid} rev={nav.newsRev} newsAt={newsAt} />}
      {error && <div role="alert" className="banner">{error}</div>}
      <main className="screen">
        <ProfileBar people={people} />
        {store.loading ? <p className="muted">Loading…</p>
          : pasteOpen ? <PasteScreen store={store} today={date} backLabel={back} onBack={() => setPasteOpen(false)} onDone={() => { setPasteOpen(false); setTab('history'); window.scrollTo(0, 0); }} />
          : charsOpen ? <CharactersScreen backLabel={back} onBack={() => setCharsOpen(false)} />
          : gymOpen ? <GymsScreen gyms={gyms} logged={exerciseNames(store.entries)} uid={uid} backLabel={back} onBack={top(() => setGymOpen(false))} />
          : photosOpen ? <PhotosScreen photos={photos} body={body} today={date} backLabel={back} onBack={() => setPhotosOpen(false)} />
          : programOpen ? <ProgramScreen programs={programs} profile={profile} entries={store.entries} gyms={gyms} uid={uid} backLabel={back} keptRest={(ex) => settings.get(ex).rest} onBack={() => setProgramOpen(false)}
            onOpenPriorities={() => { setProgramOpen(false); setTab('stats'); requestAnimationFrame(() => document.getElementById('priorities')?.scrollIntoView({ block: 'start' })); }} />
          : exercise ? <ExerciseScreen name={exercise} store={store} settings={settings} gyms={gyms} programs={programs} date={day} bodyDays={body.days} onBack={() => setExercise(null)}
            onRenamed={(to) => { renameToday(person.id, day, exercise, to); setExercise(to); window.scrollTo(0, 0); }}
            onDay={(d) => { setHistoryAt(d); setExercise(null); setTab('history'); }}
            onLog={() => { logToday(person.id, day, exercise); setLogDay(null); setExercise(null); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'today' ? <TodayScreen key={logDay ?? day} me={uid} who={people.people.length > 1 ? person.name : undefined} news={uid ? nav.news?.top ?? null : null}
            onOpenNews={(f) => nav.openThread(f)} store={store} settings={settings} programs={programs} body={body} gyms={gyms} profile={profile.profile} date={logDay ?? day} today={day}
            carried={day !== date && !logDay} recap={nav.recapAt || undefined} onSplit={() => setCarryOff(date)}
            onDay={(d) => { setLogDay(d === day ? null : d); window.scrollTo(0, 0); }} onOpen={open} onOpenProgram={top(() => setProgramOpen(true))} onOpenGym={top(() => setGymOpen(true))} />
          : tab === 'history' ? <HistoryScreen store={store} onOpen={open} focus={historyAt} onFocused={() => setHistoryAt(null)} onAddTo={(d) => { setLogDay(d === day ? null : d); setTab('today'); window.scrollTo(0, 0); }} />
          : tab === 'lifts' ? <LiftsScreen store={store} onOpen={open} />
          : tab === 'friends' && nav.viewing && uid ? <FriendPage key={nav.viewing.uid} uid={uid} friend={nav.viewing} entries={store.entries} today={date} gyms={gyms} news={nav.news}
            onBack={nav.unview} onMessage={() => nav.openThread(nav.viewing!)} />
          : tab === 'friends' ? <FriendsScreen cloud={cloud} gyms={gyms} pending={nav.pending} entries={store.entries} status={status} today={date} onPendingDone={nav.clearPending} onView={nav.view}
            news={nav.news} newsRev={nav.newsRev} onChanged={nav.bumpNews} onMessage={nav.openThread}
            onSignIn={top(() => setTab('more'))} onOpenMine={top(() => setTab('history'))} myName={person.name} goal={profile.profile.weeklyGoal} />
          : tab === 'stats' ? <StatsScreen store={store} profile={profile} programs={programs} body={body} photos={photos} today={date} onOpenPhotos={() => { setPhotosOpen(true); window.scrollTo(0, 0); }} onOpenLift={open} />
          : <DataScreen store={store} profile={rawProfile} body={body} sync={sync} cloud={cloud} people={people} onOpenPaste={top(() => setPasteOpen(true))} onShowWalkthrough={showTour}
            onOpenCharacters={top(() => setCharsOpen(true))} onOpenGym={top(() => setGymOpen(true))} onOpenProgram={top(() => setProgramOpen(true))} onOpenPhotos={top(() => setPhotosOpen(true))} />}
      </main>
    </>
  );
}

/** Reads friends' news again each time `rev` moves (and on signing in): on its own, so that renders nothing else. */
function NewsReader({ uid, rev, newsAt }: { uid: string; rev: Box<number>; newsAt: { current: number } }) {
  const n = useBox(rev);
  useEffect(() => {
    let live = true;
    newsAt.current = Date.now();
    void loadCloud().then(async (c) => {
      const news = await refreshNews(c, uid);
      if (!live) return;
      syncBadge(news.total); syncMuted(news.muted);
      // A friend sent something since their thread was read (a push while the app was away): read it now.
      await refreshChangedThreads(c, uid);
    }).catch(() => {});
    return () => { live = false; };
  }, [uid, n, newsAt]);
  return null;
}
