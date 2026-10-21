import { useCallback, useEffect, useState } from 'react';
import type { CloudStore } from '../state/useCloud';
import type { SetsStore } from '../state/useSets';
import type { BodyStore } from '../state/useBody';
import type { Person } from '../db/db';
import { cloudError, loadCloud, type Cloud } from '../cloud/firebase';
import { hydrateFriendCache, patchFriendCache, refreshLists, useFriendCache } from '../state/friendCache';
import { useReplaced } from '../state/useReplaced';
import { AccountCard } from './AccountCard';
import { ChangeUsername } from './ChangeUsername';
import { ReplacedList } from './ReplacedList';

/**
 * More › Account and sync (IA plan A3): sign in or out, Sync now, Delete account, what syncs replaced here, and your username
 * with Change username (owner, 2026-10-21: moved off Friends, which is for friends, not account setup).
 */
export function AccountScreen({ cloud, people, store, body, onOpenFriends }: {
  cloud: CloudStore; people: Person[]; store: SetsStore; body: BodyStore; /** No username yet: Friends, where it's picked. */ onOpenFriends: () => void;
}) {
  const replaced = useReplaced(store, body);
  const uid = cloud.link && cloud.mine ? cloud.link.uid : null;
  return (
    <>
      <AccountCard cloud={cloud} people={people} replaced={cloud.mine ? <ReplacedList replaced={replaced} /> : undefined} />
      {uid && <UsernameCard uid={uid} onOpenFriends={onOpenFriends} />}
    </>
  );
}

type Msg = { ok: boolean; text: string } | null;

/** Your username as friends find you, from what the phone kept of Friends and read again on opening. */
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
  return (
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
  );
}
