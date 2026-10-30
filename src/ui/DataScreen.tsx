import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SetsStore } from '../state/useSets';
import type { ProfileStore } from '../state/useProfile';
import type { ProgramStore } from '../state/useProgram';
import type { GymsStore } from '../state/useGyms';
import type { PhotosStore } from '../state/usePhotos';
import type { BackupStore } from '../state/useBackup';
import { useCloudStatus, type CloudStore } from '../state/useCloud';
import type { PeopleStore } from '../state/usePeople';
import { useCycle } from '../state/useCycle';
import { useFriendCacheSelect } from '../state/friendCache';
import { knownStoragePersistence, storagePersistence } from '../db/db';
import { plural } from '../domain/format';
import { PUSH_ON } from '../push/config';
import { Icon } from './icons';
import { goalLabel } from './PrioritiesScreen';
import type { MoreAt } from './MoreScreens';
import { isOwner } from '../cloud/owner';
import { useProfileId } from '../state/profileDb';
import { perSideOffered } from './PerSideReview';

/**
 * The More tab (IA plan A3, owner 2026-10-21): rows in four groups, each opening its screen, so the whole tab is one screen.
 * Training setup (Program, Weekly goal, Priorities and goal, Gym); You (Progress photos, Cycle tracking, People);
 * Account and data (Account and sync, Notifications, Backup, import and export); Help.
 */
export function DataScreen({ store, profile, programs, gyms, photos, backup, cloud, people, onShowWalkthrough, onOpen, onOpenGym, onOpenProgram, onOpenPhotos, onOpenPriorities, onOpenAchievements }: {
  store: SetsStore; profile: ProfileStore; programs: ProgramStore; gyms: GymsStore; photos: PhotosStore; backup: BackupStore; cloud: CloudStore; people: PeopleStore;
  onShowWalkthrough: () => void; /** One of More's own screens. */ onOpen: (m: MoreAt) => void;
  onOpenGym: () => void; onOpenProgram: () => void; onOpenPhotos: () => void; onOpenPriorities: () => void; /** The Achievements page, on Stats. */ onOpenAchievements: () => void;
}) {
  const [persisted, setPersisted] = useState<boolean | null | undefined>(knownStoragePersistence);
  useEffect(() => { if (persisted === undefined) void storagePersistence().then(setPersisted); }, []);
  const cycle = useCycle();
  const p = programs.program, goal = profile.profile.weeklyGoal;
  const shots = photos.metas.length;
  const profileId = useProfileId();
  const perSide = useMemo(() => perSideOffered(store.entries, profileId), [store.entries, profileId]);
  return (
    <>
      <h1>More</h1>
      {perSide && (
        <Group name="To review">
          <Row name="Bar sets logged per side" sub="Old bar sets to turn into totals · once" onClick={() => onOpen('perside')} />
        </Group>
      )}
      <Group name="Training setup">
        <Row name="Program" sub={p ? `${plural(p.days.length, 'day')}${p.days.length <= 3 ? ` · ${p.days.map((d) => d.name).join(', ')}` : ''}` : 'Not built yet'} onClick={onOpenProgram} />
        <Row name="Weekly goal" sub="Drives the week plan, rings and Compare" note={plural(goal, 'session')} onClick={() => onOpen('goal')} />
        <Row name="Priorities and goal" sub="Muscle priorities · training goal" note={goalLabel(profile.profile)} onClick={onOpenPriorities} />
        <Row name="Gym" sub="Equipment the plan uses" note={gyms.active?.name ?? 'None'} onClick={onOpenGym} />
      </Group>
      <Group name="You">
        <Row name="Achievements" sub="Medals earned and what’s next" onClick={onOpenAchievements} />
        <Row name="Progress photos" sub="On this phone only" note={shots ? plural(shots, 'photo') : undefined} onClick={onOpenPhotos} />
        <Row name="Cycle tracking" sub="Private, this profile only" note={cycle.loaded ? (cycle.tracking ? 'On' : 'Off') : undefined} onClick={() => onOpen('cycle')} />
        <Row name="People on this phone" note={people.people.length > 1 ? `${people.people.length} people` : people.active?.name} onClick={() => onOpen('people')} />
      </Group>
      <Group name="Account and data">
        <AccountRow cloud={cloud} people={people} onClick={() => onOpen('account')} />
        {PUSH_ON && <Row name="Notifications" sub="Reminders, friends and the weekly recap" onClick={() => onOpen('notifications')} />}
        <Row name="Backup, import and export" sub={[plural(store.entries.length, 'set'), backup.mark === undefined ? null : backup.mark?.at ? `backed up ${time(backup.mark.at)}` : 'no backup yet'].filter(Boolean).join(' · ')}
          note={persisted === false || backup.due ? <><span aria-hidden="true">!</span><span className="sr-only">{backup.due ? 'Photos not backed up' : 'Storage not marked persistent'}</span></> : undefined} warn onClick={() => onOpen('backup')} />
        {/* The app's owner alone (social S4): the board's reports. */}
        {cloud.mine && isOwner(cloud.link?.uid) && <Row name="Board review" sub="Reported posts · owner only" onClick={() => onOpen('review')} />}
      </Group>
      <Group name="Help">
        <Row name="Show walkthrough" action onClick={onShowWalkthrough} />
        <Row name="Accessory placer" action onClick={() => location.assign(`${import.meta.env.BASE_URL}tools/accessory-placer.html`)} />
      </Group>
      <p className="muted small">Build {__BUILD_ID__} · {__BUILT_AT__.slice(0, 16).replace('T', ' ')} UTC</p>
    </>
  );
}

function Group({ name, children }: { name: string; children: ReactNode }) {
  return (<>
    <h2 className="more-sec">{name}</h2>
    <ul className="card more-list" aria-label={name}>{children}</ul>
  </>);
}

/** A row: its name, a line under it, a value on the right, and a chevron (none on Help's, which do a thing rather than open one). */
function Row({ name, sub, note, warn, action, onClick }: { name: string; sub?: string; note?: ReactNode; warn?: boolean; action?: boolean; onClick: () => void }) {
  return (
    <li>
      <button className={action ? 'more-row more-action' : 'more-row'} onClick={onClick}>
        <span className="more-t">{name}{sub && <span className="more-sub">{sub}</span>}</span>
        {note != null && <span className={warn ? 'more-note warn' : 'more-note'}>{note}</span>}
        {!action && <Icon name="chev-right" size={20} sw={2} className="more-chev" />}
      </button>
    </li>
  );
}

/** A sync or a backup today by its time, an older one by its day. */
const time = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Account and sync's row, on its own: a sync (after every set) moves its line and renders nothing else. */
function AccountRow({ cloud, people, onClick }: { cloud: CloudStore; people: PeopleStore; onClick: () => void }) {
  const { lastSync } = useCloudStatus(cloud);
  const uid = cloud.link && cloud.mine ? cloud.link.uid : null;
  const me = useFriendCacheSelect(uid, (c) => c?.lists?.me ?? null);
  const { link } = cloud;
  const sub = link === undefined ? undefined
    : !link ? 'Sign in to sync and add friends'
    : !cloud.mine ? `Signed in for ${people.people.find((x) => x.id === link.person)?.name ?? 'another person'}`
    : [me ? `@${me}` : link.email, lastSync && `synced ${time(lastSync)}`].filter(Boolean).join(' · ');
  return <Row name="Account and sync" sub={sub} onClick={onClick} />;
}
