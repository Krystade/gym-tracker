import type { CloudStore } from '../state/useCloud';
import type { Friend } from '../cloud/friends';
import type { Invite } from '../domain/invite';
import { FriendsCard } from './FriendsCard';
import type { GymsStore } from '../state/useGyms';

/** Friends need an account: signed out, this points to the Account card on More. It opens from More, so Back goes there. */
export function FriendsScreen({ cloud, gyms, pending, onPendingDone, onView, onRequests, onSignIn, onBack }: {
  cloud: CloudStore; gyms: GymsStore; pending: Invite | null; onPendingDone: () => void; onView: (f: Friend) => void; onRequests: (n: number) => void; onSignIn: () => void; onBack: () => void;
}) {
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
        : <FriendsCard uid={cloud.link.uid} gyms={gyms} pending={pending} onPendingDone={onPendingDone} onView={onView} onRequests={onRequests} />}
    </>
  );
}
