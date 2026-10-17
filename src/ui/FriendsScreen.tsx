import { useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { Friend } from '../cloud/friends';
import type { Invite } from '../domain/invite';
import type { SetEntry } from '../domain/types';
import type { StatusStore } from '../state/useStatus';
import { FriendsCard } from './FriendsCard';
import { Orbit } from './Orbit';
import type { GymsStore } from '../state/useGyms';

/** Friends need an account: signed out, this points to the Account card on More. It opens from More, so Back goes there. */
export function FriendsScreen({ cloud, gyms, pending, entries, status, today, onPendingDone, onView, onRequests, onSignIn, onBack, onOpenMine }: {
  cloud: CloudStore; gyms: GymsStore; pending: Invite | null; entries: SetEntry[]; status: StatusStore; today: string;
  onPendingDone: () => void; onView: (f: Friend) => void; onRequests: (n: number) => void; onSignIn: () => void; onBack: () => void; onOpenMine: () => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  // The invite controls sit in the list below; Orbit's Invite button brings them up.
  const invite = () => document.getElementById('add-friend')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <>
      <button className="back" onClick={onBack}>‹ More</button>
      <h1>Friends</h1>
      {cloud.link === undefined ? <p className="muted">Loading…</p>
        : !cloud.link ? (
          <section className="card">
            <p>{pending ? 'Someone invited you. Sign in or create an account, then come back here to accept.' : 'Friends see each other’s log, body weight, priorities and program. Never photos. You need an account first.'}</p>
            <button className="primary wide" onClick={onSignIn}>Sign in or create an account</button>
          </section>
        ) : !cloud.mine ? <p className="muted">The account on this phone belongs to another person here; switch to them to see friends.</p>
        : (<>
          <Orbit uid={cloud.link.uid} friends={friends} entries={entries} today={today} status={status} onOpenFriend={onView} onOpenMine={onOpenMine} onInvite={invite} />
          <FriendsCard uid={cloud.link.uid} gyms={gyms} pending={pending} onPendingDone={onPendingDone} onView={onView} onRequests={onRequests} onFriends={setFriends} />
        </>)}
    </>
  );
}
