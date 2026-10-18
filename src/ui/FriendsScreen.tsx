import { useRef, useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { Friend, FriendNews } from '../cloud/friends';
import type { ThreadWith } from './ThreadSheet';
import type { Invite } from '../domain/invite';
import type { SetEntry } from '../domain/types';
import type { StatusStore } from '../state/useStatus';
import { FriendsCard } from './FriendsCard';
import { Crew } from './Crew';
import type { GymsStore } from '../state/useGyms';
import { loadCloud } from '../cloud/firebase';
import { refreshLists, refreshNews, useFriendCache } from '../state/friendCache';
import { Icon } from './icons';

const PULL = 70; // px down from the top of the page that reads everything again

/**
 * Friends need an account: signed out, this points to the Account card on More. A tab of its own, so no Back.
 * Everything here shows from what the phone kept (state/friendCache) and is read again quietly behind it. A pull down at the
 * top reads it all again at once; so does a Refresh button a screen reader or keyboard finds (it shows when focused).
 */
export function FriendsScreen({ cloud, gyms, pending, entries, status, today, news, newsRev, onPendingDone, onView, onChanged, onMessage, onSignIn, onOpenMine, myName }: {
  cloud: CloudStore; gyms: GymsStore; pending: Invite | null; entries: SetEntry[]; status: StatusStore; today: string;
  /** Requests, gyms and unread messages; `newsRev` moves whenever they're read again. */ news: FriendNews | null; newsRev: number;
  onPendingDone: () => void; onView: (f: Friend) => void; onChanged: () => void; onMessage: (f: ThreadWith) => void; onSignIn: () => void; onOpenMine: () => void;
  /** This phone's person, for your own avatar. */ myName?: string;
}) {
  const uid = cloud.link && cloud.mine ? cloud.link.uid : null;
  const friends = useFriendCache(uid)?.lists?.friends ?? null;
  // Each pull or Refresh moves this: Crew reads every line again.
  const [pulled, setPulled] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const refresh = async () => {
    if (!uid || refreshing) return;
    setRefreshing(true); setNote(null); setPulled((n) => n + 1);
    try { const c = await loadCloud(); await Promise.all([refreshLists(c, uid), refreshNews(c, uid)]); onChanged(); }
    catch { setNote('Couldn’t refresh: showing what this phone saved.'); }
    finally { setRefreshing(false); }
  };
  // Pull down at the top of the page: mostly down, so a sideways drag on Crew's lines never counts.
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // The invite controls sit in the list below; Crew's Invite button brings them up.
  const invite = () => document.getElementById('add-friend')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <div className="friends-page"
      onTouchStart={(e) => { start.current = uid && window.scrollY <= 0 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
      onTouchMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dy = e.touches[0].clientY - s.y, dx = Math.abs(e.touches[0].clientX - s.x);
        setPull(dy > dx ? Math.max(0, dy) : 0);
      }}
      onTouchEnd={() => { if (pull > PULL) void refresh(); start.current = null; setPull(0); }}>
      <div className="page-head">
        <h1>Friends</h1>
        {/* The same place Invite a friend goes: the add form at the foot of the page. */}
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
          <Crew uid={cloud.link.uid} myName={myName} friends={friends} entries={entries} today={today} status={status} news={news} pulled={pulled} onOpenFriend={onView} onOpenMine={onOpenMine} onInvite={invite} onMessage={onMessage} />
          <FriendsCard uid={cloud.link.uid} gyms={gyms} pending={pending} newsRev={newsRev} onPendingDone={onPendingDone} onChanged={onChanged} />
        </>)}
    </div>
  );
}
