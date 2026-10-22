import { useRef, useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { Friend, FriendNews } from '../cloud/friends';
import type { ThreadWith } from './ThreadSheet';
import type { Invite } from '../domain/invite';
import type { SetEntry } from '../domain/types';
import type { StatusStore } from '../state/useStatus';
import { FriendsCard } from './FriendsCard';
import { Feed } from './Feed';
import type { GymsStore } from '../state/useGyms';
import type { Box } from '../state/box';
import { loadCloud } from '../cloud/firebase';
import { refreshLists, refreshNews, useFriendCache } from '../state/friendCache';
import { Icon } from './icons';
import { Board } from './Board';

type Seg = 'friends' | 'board';
const SEG_KEY = 'friends:seg';
/** Friends or Board, as last left on this phone (storage can be missing or throw: Friends then). */
const keptSeg = (): Seg => { try { return localStorage.getItem(SEG_KEY) === 'board' ? 'board' : 'friends'; } catch { return 'friends'; } };

const PULL = 70; // px down from the top of the page that reads everything again

/**
 * Friends need an account: signed out, this points to More › Account and sync. A tab of its own, so no Back.
 * Everything here shows from what the phone kept (state/friendCache) and is read again quietly behind it. A pull down at the
 * top reads it all again at once; so does a Refresh button a screen reader or keyboard finds (it shows when focused).
 */
export function FriendsScreen({ cloud, gyms, pending, entries, status, today, news, newsRev, onPendingDone, onView, onChanged, onMessage, onSignIn, onOpenMine, onCompare, myName, goal }: {
  cloud: CloudStore; gyms: GymsStore; pending: Invite | null; entries: SetEntry[]; status: StatusStore; today: string;
  /** Requests, gyms and unread messages; `newsRev` moves whenever they're read again. */ news: FriendNews | null; newsRev: Box<number>;
  onPendingDone: () => void; onView: (f: Friend) => void; onChanged: () => void; onMessage: (f: ThreadWith) => void; onSignIn: () => void; onOpenMine: () => void;
  /** This phone's person, for your own avatar. */ myName?: string; /** Your sessions-a-week goal, for your ring. */ goal: number;
  /** Compare: everyone side by side. */ onCompare?: () => void;
}) {
  const uid = cloud.link && cloud.mine ? cloud.link.uid : null;
  const friends = useFriendCache(uid)?.lists?.friends ?? null;
  // Each pull or Refresh moves this: Crew reads every line again.
  const [pulled, setPulled] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Friends | Board (social S3): the board is a page of its own beside your friends, never mixed into their feed.
  const [seg, setSegState] = useState<Seg>(() => (pending ? 'friends' : keptSeg()));
  const setSeg = (v: Seg) => { setSegState(v); try { localStorage.setItem(SEG_KEY, v); } catch { /* kept for this visit only */ } };
  const refresh = async () => {
    if (!uid || refreshing) return;
    // The board reads itself again whole (Board, on `pulled`).
    if (seg === 'board') { setPulled((n) => n + 1); return; }
    setRefreshing(true); setNote(null); setPulled((n) => n + 1);
    try { const c = await loadCloud(); await Promise.all([refreshLists(c, uid), refreshNews(c, uid)]); onChanged(); }
    catch { setNote('Couldn’t refresh: showing what this phone saved.'); }
    finally { setRefreshing(false); }
  };
  // Pull down at the top of the page: mostly down, so a sideways drag on Crew's lines never counts.
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Add a friend: a sheet over the page, from the person+ icon or Crew's Invite (IA plan A4).
  const [adding, setAdding] = useState(false);
  const invite = () => { setSeg('friends'); setAdding(true); };
  return (
    <div className="friends-page"
      // The sheet is portalled but its touches still bubble here through React: a drag in it is no pull.
      onTouchStart={(e) => { start.current = uid && !adding && window.scrollY <= 0 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
      onTouchMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dy = e.touches[0].clientY - s.y, dx = Math.abs(e.touches[0].clientX - s.x);
        setPull(dy > dx ? Math.max(0, dy) : 0);
      }}
      onTouchEnd={() => { if (pull > PULL) void refresh(); start.current = null; setPull(0); }}>
      <div className="page-head">
        <h1>Friends</h1>
        {/* The same sheet Crew's Invite a friend opens. */}
        {uid && <button className="mini icon" aria-label="Add a friend" onClick={invite}><Icon name="person-plus" size={26} /></button>}
      </div>
      {uid && (<>
        <button className="sr-only focus-show mini" onClick={() => void refresh()}>Refresh friends</button>
        <p className="friends-pull muted small" role="status">
          {pull > 0 ? (pull > PULL ? 'Release to refresh' : 'Pull to refresh') : refreshing ? 'Refreshing…' : note}
        </p>
      </>)}
      {cloud.link === undefined ? <p className="muted">Loading…</p>
        : !cloud.link ? (
          <section className="card">
            <p>{pending ? 'Someone invited you. Sign in or create an account, then come back here to accept.' : 'Friends see each other’s log, body weight, priorities and program. Never photos. You need an account first.'}</p>
            <button className="primary wide" onClick={onSignIn}>Sign in or create an account</button>
          </section>
        ) : !cloud.mine ? <p className="muted">The account on this phone belongs to another person here; switch to them to see friends.</p>
        : (<>
          <div className="fr-seg" role="tablist" aria-label="Friends or the board">
            <button type="button" role="tab" aria-selected={seg === 'friends'} onClick={() => setSeg('friends')}>Friends</button>
            <button type="button" role="tab" aria-selected={seg === 'board'} onClick={() => setSeg('board')}>Board</button>
          </div>
          {seg === 'board' ? <Board uid={cloud.link.uid} email={cloud.link.email} pulled={pulled} onAccount={() => setSeg('friends')} /> : (<>
          <Feed uid={cloud.link.uid} myName={myName} friends={friends} entries={entries} goal={goal} today={today} status={status} news={news} pulled={pulled} onOpenFriend={onView} onOpenMine={onOpenMine} onInvite={invite} onMessage={onMessage} onCompare={onCompare} />
          <FriendsCard uid={cloud.link.uid} gyms={gyms} pending={pending} newsRev={newsRev} adding={adding} onAdding={setAdding} onPendingDone={onPendingDone} onChanged={onChanged} />
          </>)}
        </>)}
    </div>
  );
}
