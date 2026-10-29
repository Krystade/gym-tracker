import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import type { FittedProfileStore } from '../state/useFittedProfile';
import type { BodyStore } from '../state/useBody';
import type { SyncStore } from '../state/useSync';
import type { CloudStore } from '../state/useCloud';
import type { PeopleStore } from '../state/usePeople';
import type { Person } from '../db/db';
import { AccountScreen } from './AccountScreen';
import { BackupScreen } from './BackupScreen';
import { CycleCard } from './Cycle';
import { NotificationsCard } from './NotificationsCard';
import { PeopleCard } from './PeopleCard';
import { WeeklyGoal } from './PrioritiesScreen';
import { BoardReview } from './BoardReview';
import { PerSideReview } from './PerSideReview';
import { useProfileId } from '../state/profileDb';

// More's own screens (IA plan A3, owner 2026-10-21): each a row on More that opens it, with ‹ More back. The screens More opens
// that open from elsewhere too (Program, Priorities, Gym, Photos, Paste) stay where they were, over the tab.

/** `review`: the board's reports, the app's owner's alone (social S4). */
export type MoreAt = 'goal' | 'cycle' | 'people' | 'account' | 'notifications' | 'backup' | 'review' | 'perside';

/** Each screen's title, and the word a screen it opens (Paste, from Backup) names it by on its Back. */
export const MORE_TITLE: Record<MoreAt, { title: string; back: string }> = {
  goal: { title: 'Weekly goal', back: 'Weekly goal' },
  cycle: { title: 'Cycle tracking', back: 'Cycle' },
  people: { title: 'People on this phone', back: 'People' },
  account: { title: 'Account and sync', back: 'Account' },
  notifications: { title: 'Notifications', back: 'Notifications' },
  backup: { title: 'Backup, import and export', back: 'Backup' },
  review: { title: 'Board review', back: 'Review' },
  perside: { title: 'Bar sets logged per side', back: 'Per side' },
};

export function MoreSubScreen({ at, store, profile, rawProfile, body, sync, cloud, people, person, today, onBack, onOpen, onOpenPaste, onOpenFriends }: {
  at: MoreAt; store: SetsStore; profile: FittedProfileStore; rawProfile: ProfileStore; body: BodyStore; sync: SyncStore; cloud: CloudStore;
  people: PeopleStore; person: Person; today: string;
  onBack: () => void; /** Another of More's screens (Notifications' Sign in: Account). */ onOpen: (m: MoreAt) => void; onOpenPaste: () => void; onOpenFriends: () => void;
}) {
  const profileId = useProfileId();
  return (
    <>
      <button className="back" onClick={onBack}>‹ More</button>
      <h1>{MORE_TITLE[at].title}</h1>
      {at === 'goal' ? <WeeklyGoal profile={profile} entries={store.entries} today={today} />
        : at === 'cycle' ? <CycleCard name={person.name} />
        : at === 'people' ? <PeopleCard people={people} />
        : at === 'account' ? <AccountScreen cloud={cloud} people={people.people} store={store} body={body} onOpenFriends={onOpenFriends} />
        : at === 'perside' ? <PerSideReview store={store} profile={profileId} onBack={onBack} />
        : at === 'review' ? (cloud.link && cloud.mine ? <BoardReview uid={cloud.link.uid} /> : <p className="muted">Sign in as the app’s owner to review the board.</p>)
        : at === 'notifications' ? <NotificationsCard signedIn={cloud.mine} goal={rawProfile.profile.weeklyGoal} entries={store.entries} onSignIn={() => onOpen('account')} />
        : <BackupScreen store={store} profile={rawProfile} body={body} sync={sync} cloud={cloud} onOpenPaste={onOpenPaste} />}
    </>
  );
}
