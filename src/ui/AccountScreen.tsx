import { useCallback, useEffect, useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { SetsStore } from '../state/useSets';
import type { BodyStore } from '../state/useBody';
import type { ProfileStore } from '../state/useProfile';
import { roughFix } from '../state/usePlace';
import { isPlaceKey, newPlaceKey } from '../domain/place';
import { plural } from '../domain/format';
import type { Person } from '../db/db';
import { cloudError, loadCloud, type Cloud } from '../cloud/firebase';
import { setRequestsFrom } from '../cloud/friends';
import { hydrateFriendCache, patchFriendCache, refreshLists, useFriendCache } from '../state/friendCache';
import { useReplaced } from '../state/useReplaced';
import { AccountCard } from './AccountCard';
import { ChangeUsername } from './ChangeUsername';
import { DisplayNameCard, SeenAsCard } from './DisplayNameCard';
import { ReplacedList } from './ReplacedList';

/**
 * More › Account and sync (IA plan A3): sign in or out, Sync now, Delete account, what syncs replaced here, and your username
 * with Change username (owner, 2026-10-21: moved off Friends, which is for friends, not account setup).
 */
export function AccountScreen({ cloud, people, store, body, profile, onOpenFriends }: {
  cloud: CloudStore; people: Person[]; store: SetsStore; body: BodyStore; /** This person's, for Location for Together. */ profile: ProfileStore;
  /** No username yet: Friends, where it's picked. */ onOpenFriends: () => void;
}) {
  const replaced = useReplaced(store, body);
  const uid = cloud.link && cloud.mine ? cloud.link.uid : null;
  return (
    <>
      <AccountCard cloud={cloud} people={people} replaced={cloud.mine ? <ReplacedList replaced={replaced} /> : undefined} />
      {uid && <UsernameCard uid={uid} onOpenFriends={onOpenFriends} />}
      {uid && <PlaceCard profile={profile} store={store} />}
    </>
  );
}

type Msg = { ok: boolean; text: string } | null;

/**
 * Your display name, your username as friends find you, and how others see you (social S1): from what the phone kept of Friends,
 * read again on opening. The display name waits for a username: it shows beside one.
 */
function UsernameCard({ uid, onOpenFriends }: { uid: string; onOpenFriends: () => void }) {
  const lists = useFriendCache(uid)?.lists;
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    void (async () => {
      const kept = (await hydrateFriendCache(uid)).lists;
      try { await refreshLists(await loadCloud(), uid); } catch (e) { if (!kept) setFailed(cloudError(e)); }
    })();
  }, [uid]);
  const setMe = (n: string) => void patchFriendCache(uid, (c) => (c.lists ? { ...c, lists: { ...c.lists, me: n } } : c));
  const act = useCallback(async (f: (c: Cloud) => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try {
      const c = await loadCloud();
      const text = await f(c);
      await refreshLists(c, uid);
      if (text) setMsg({ ok: true, text });
    } catch (e) { setMsg({ ok: false, text: cloudError(e) }); }
    finally { setBusy(false); }
  }, [uid]);
  const me = lists?.me;
  return (<>
    {lists && me && <DisplayNameCard uid={uid} lists={{ ...lists, me }} />}
    <section className="card" aria-labelledby="username-h">
      <h2 id="username-h">Username</h2>
      {me ? <ChangeUsername uid={uid} me={me} changedAt={lists?.changedAt} busy={busy} act={act} setMe={setMe} />
        : lists ? (<>
          <p className="muted small">No username yet. Pick one on Friends, so friends can find you.</p>
          <button className="wide" onClick={onOpenFriends}>Pick a username</button>
        </>)
        : failed ? <p role="alert" className="warn">{failed}</p>
        : <p className="muted small">Loading…</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted small' : 'warn'}>{msg.text}</p>}
    </section>
    {lists && me && <SeenAsCard uid={uid} lists={{ ...lists, me }} />}
    {lists && me && <RequestsCard uid={uid} invite={lists.reqs === 'invite'} />}
  </>);
}

/**
 * Who may send you a friend request (social S3): anyone who knows your username (the board shows it to everyone), or only someone
 * with your invite link. firestore.rules hold it; whoever is refused is told to ask for a link.
 */
function RequestsCard({ uid, invite }: { uid: string; invite: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = async (to: 'any' | 'invite') => {
    if ((to === 'invite') === invite) return;
    setBusy(true); setErr(null);
    try {
      await setRequestsFrom(await loadCloud(), uid, to);
      await patchFriendCache(uid, (c) => {
        if (!c.lists) return c;
        const { reqs: _, ...rest } = c.lists;
        return { ...c, lists: { ...rest, ...(to === 'invite' && { reqs: 'invite' as const }) } };
      });
    } catch (e) { setErr(cloudError(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="card" aria-labelledby="reqs-h">
      <h2 id="reqs-h">Friend requests</h2>
      <div role="radiogroup" aria-label="Who can send you a friend request">
        <label className="check"><input type="radio" name="reqs" disabled={busy} checked={!invite} onChange={() => void set('any')} /><span>Anyone with your username</span></label>
        <label className="check"><input type="radio" name="reqs" disabled={busy} checked={invite} onChange={() => void set('invite')} /><span>Invite link only</span></label>
      </div>
      <p className="muted small">Your username shows on every post you make on the board. With invite link only, only people you send a link to can ask.</p>
      {err && <p role="alert" className="warn">{err}</p>}
    </section>
  );
}

const BLOCKED = 'Location is off for this app. Allow it in Settings › Privacy & Security › Location Services (Safari Websites, or the app), then turn this on again.';

/**
 * Location for Together (owner 2026-10-29: the same place and the same time; domain/place): off until turned on here, by a tap
 * that asks the phone for its location once (never on load). On, the first set of each visit takes one rough fix
 * (state/usePlace); off, no more, and the codes sets already carry can be taken off them.
 */
function PlaceCard({ profile, store }: { profile: ProfileStore; store: SetsStore }) {
  const on = isPlaceKey(profile.profile.placeKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const coded = store.entries.filter((e) => e.loc !== undefined);
  const turn = () => {
    setErr(null);
    if (on) { const { placeKey: _, ...p } = profile.profile; void profile.save(p); return; }
    if (!navigator.geolocation) { setErr('This browser can’t tell its location.'); return; }
    setBusy(true);
    // Asked from the tap itself, so the phone shows its prompt; the fix is only the answer, dropped here. Not allowed: stays off.
    void roughFix(navigator.geolocation).then(async (f) => {
      if ('error' in f && f.error === 1) setErr(BLOCKED);
      else await profile.save({ ...profile.profile, placeKey: newPlaceKey() });
    }).finally(() => setBusy(false));
  };
  return (
    <section className="card" aria-labelledby="place-h">
      <div className="place-setting">
        <h2 id="place-h">Location for Together</h2>
        <button type="button" role="switch" className="switch" disabled={busy} aria-checked={on} aria-label="Location for Together" onClick={turn} />
      </div>
      <p className="muted small">
        Trained together counts a session only in the same place at the same time, so both of you turn this on. The first set of
        each visit takes one rough fix (about 150 m) that never leaves this phone: your sets carry only a code that tells a friend’s
        phone you were in the same place, never where.
      </p>
      {!on && coded.length > 0 && (
        <button className="wide" disabled={busy} onClick={() => void store.updateMany(coded.map(({ loc: _, ...e }) => e))}>
          Remove the codes from {plural(coded.length, 'set')}
        </button>
      )}
      {err && <p role="alert" className="warn">{err}</p>}
    </section>
  );
}
