import { useCallback, useEffect, useState } from 'react';
import { cloudError, loadCloud, type Cloud } from '../cloud/firebase';
import {
  acceptInvite, acceptRequest, claimUsername, declineRequest, listFriends, listRequests, liveInvite, makeInvite, myUsername, removeFriend, revokeInvites, sendRequest,
  type Friend, type Request,
} from '../cloud/friends';
import { cleanUsername, inviteUrl, parseInvite, USERNAME, type Invite } from '../domain/invite';

type Msg = { ok: boolean; text: string } | null;
const base = () => `${location.origin}${location.pathname}`;

/** Find friends by username or an invite link; tap one to see their log. Only while signed in. */
export function FriendsCard({ uid, pending, onPendingDone, onView, onRequests }: {
  uid: string; pending: Invite | null; onPendingDone: () => void; onView: (f: Friend) => void; onRequests: (n: number) => void;
}) {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState('');
  const [find, setFind] = useState('');
  const [paste, setPaste] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const refresh = useCallback(async (c: Cloud) => {
    const [f, r, i] = await Promise.all([listFriends(c, uid), listRequests(c, uid), liveInvite(c, uid)]);
    setFriends(f); setRequests(r); setInvite(i); onRequests(r.length);
  }, [uid, onRequests]);
  /** One action at a time; its outcome (or the error in plain words) shows under the card's heading. */
  const act = useCallback(async (f: (c: Cloud) => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try {
      const c = await loadCloud();
      const text = await f(c);
      await refresh(c);
      if (text) setMsg({ ok: true, text });
    } catch (e) { setMsg({ ok: false, text: cloudError(e) }); }
    finally { setBusy(false); }
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try { const c = await loadCloud(); setMe(await myUsername(c, uid)); await refresh(c); }
      catch (e) { setMe(null); setMsg({ ok: false, text: cloudError(e) }); }
    })();
  }, [uid, refresh]);
  // An invite link opened in this app: accepted once you have a username, so they see who you are.
  useEffect(() => {
    if (!pending || !me) return;
    onPendingDone();
    void act(async (c) => `You and ${await acceptInvite(c, uid, pending)} are now friends.`);
  }, [pending, me, uid, act, onPendingDone]);

  const message = msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted small' : 'warn'}>{msg.text}</p>;
  if (me === undefined) return <section className="card" aria-label="Friends"><p className="muted">Loading…</p>{message}</section>;
  if (!me) {
    const n = cleanUsername(name), ok = USERNAME.test(n);
    return (
      <section className="card" aria-label="Friends">
        <p className="muted small">Pick a username so friends can find you: 3–20 lowercase letters, numbers or _.{pending && ' Then the invite you opened is accepted.'}</p>
        <form className="sync-form" onSubmit={(e) => { e.preventDefault(); if (ok) void act(async (c) => { await claimUsername(c, uid, n); setMe(n); }); }}>
          <label>Username<input autoCapitalize="off" autoCorrect="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {name && !ok && <p className="small err" role="status">3–20 lowercase letters, numbers or _</p>}
          <button type="submit" className="primary wide" disabled={!ok || busy}>Save username</button>
        </form>
        {message}
      </section>
    );
  }

  const link = invite && inviteUrl(base(), invite);
  const to = cleanUsername(find);
  const share = async () => {
    if (!link) return;
    if (navigator.share) { try { await navigator.share({ title: 'Gym Tracker', text: `Be my friend on Gym Tracker (@${me})`, url: link }); } catch { /* closed */ } return; }
    try { await navigator.clipboard.writeText(link); setMsg({ ok: true, text: 'Link copied.' }); } catch { setMsg({ ok: false, text: 'Couldn’t copy. Select the link and copy it.' }); }
  };
  return (
    <section className="card" aria-label="Friends">
      <p className="muted small">You’re @{me}. Friends see your log, notes, body weight, priorities and program. Never your photos.</p>
      {message}
      {requests.length > 0 && (
        <section className="sub" aria-label="Requests">
          <h3>Requests</h3>
          <ul className="friend-list">
            {requests.map((r) => (
              <li key={r.uid}>
                <span>@{r.name} wants to be friends</span>
                <span className="friend-actions">
                  <button className="primary" disabled={busy} onClick={() => void act(async (c) => { await acceptRequest(c, uid, r.uid); return `You and ${r.name} are now friends.`; })}>Accept</button>
                  <button disabled={busy} onClick={() => void act(async (c) => { await declineRequest(c, uid, r.uid); })}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="sub" aria-label="Your friends">
        <h3>Your friends</h3>
        {!friends.length ? <p className="muted small">None yet. Add someone below.</p> : (
          <ul className="friend-list">
            {friends.map((f) => (
              <li key={f.uid}>
                <button className="link" onClick={() => onView(f)}>@{f.name}</button>
                <span className="friend-actions">
                  <button className="mini" disabled={busy} onClick={() => (armed === f.uid
                    ? void act(async (c) => { setArmed(null); await removeFriend(c, uid, f.uid); return `Removed ${f.name}. Neither of you can see the other’s log now.`; })
                    : setArmed(f.uid))}>{armed === f.uid ? 'Tap again to remove' : 'Remove'}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="sub" aria-label="Add a friend">
        <h3>Add a friend</h3>
        <form className="sync-form" onSubmit={(e) => {
          e.preventDefault();
          if (USERNAME.test(to)) void act(async (c) => { const r = await sendRequest(c, uid, me, to); setFind(''); return r === 'accepted' ? `You and ${to} are now friends.` : `Request sent to ${to}.`; });
        }}>
          <label>Their username<input autoCapitalize="off" autoCorrect="off" spellCheck={false} value={find} onChange={(e) => setFind(e.target.value)} /></label>
          <button type="submit" className="wide" disabled={!USERNAME.test(to) || busy}>Send request</button>
        </form>
        {link ? (<>
          <label className="invite-link">Your invite link<input readOnly value={link} onFocus={(e) => e.target.select()} /></label>
          <p className="muted small">Anyone who opens it while signed in becomes your friend. It works for 7 days.</p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => void act(async (c) => { await revokeInvites(c, uid); return 'Invite link cancelled.'; })}>Cancel link</button>
            <button className="primary" onClick={() => void share()}>Share link</button>
          </div>
        </>) : <button className="wide" disabled={busy} onClick={() => void act(async (c) => { await makeInvite(c, uid); })}>Make an invite link</button>}
        <form className="sync-form" onSubmit={(e) => {
          e.preventDefault();
          const inv = parseInvite(paste);
          if (inv) void act(async (c) => { const n = await acceptInvite(c, uid, inv); setPaste(''); return `You and ${n} are now friends.`; });
        }}>
          <label>Got an invite link? Paste it<input autoCapitalize="off" autoCorrect="off" spellCheck={false} value={paste} onChange={(e) => setPaste(e.target.value)} /></label>
          <button type="submit" className="wide" disabled={!parseInvite(paste) || busy}>Accept invite</button>
        </form>
      </section>
    </section>
  );
}
