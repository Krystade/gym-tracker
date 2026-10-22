import { useState } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { setDisplayName } from '../cloud/friends';
import { isOwner } from '../cloud/owner';
import { cleanDisplayName, displayLength, displayNameError, MAX_DISPLAY, nextNameAt } from '../domain/displayName';
import { patchFriendCache, refreshLists, setVerifiedHere, type Lists } from '../state/friendCache';
import { Input } from './Field';
import { Glued, Verified, useVerified } from './FriendName';
import { initials } from './icons';
import './friendNames.css';

// More › Account: your display name (social S1, mockup 06), and how others see you. Free text shown beside your @username,
// never instead of it; empty by default, and nobody is asked to set one (owner, 2026-10-22). Once a day.

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** The display name field: checked as typed, saved in one write (cloud/friends setDisplayName). */
export function DisplayNameCard({ uid, lists }: { uid: string; lists: Lists & { me: string } }) {
  const saved = lists.dn ?? '';
  const [text, setText] = useState(saved);
  // Changed elsewhere (another phone, read again): the field follows, unless you're mid-edit.
  const [base, setBase] = useState(saved);
  if (base !== saved) { setBase(saved); if (text === base) setText(saved); }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const clean = cleanDisplayName(text);
  const bad = displayNameError(clean);
  const next = nextNameAt(lists.nameAt, Date.now());
  const changed = clean !== saved;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const c = await loadCloud();
      const dn = await setDisplayName(c, uid, clean);
      setText(dn);
      // Shown at once; the lists read again behind it bring the server's time.
      await patchFriendCache(uid, (x) => (x.lists ? { ...x, lists: { ...x.lists, dn: dn || undefined, nameAt: Date.now() } } : x));
      setMsg({ ok: true, text: dn ? `Friends see “${dn}” beside @${lists.me} now.` : `Removed. Friends see @${lists.me} alone.` });
      void refreshLists(c, uid).catch(() => {});
    } catch (e) { setMsg({ ok: false, text: cloudError(e) }); }
    finally { setBusy(false); }
  };
  const n = displayLength(clean);
  return (
    <section className="card dn-card" aria-labelledby="dn-h">
      <h2 id="dn-h">Display name</h2>
      <form className="sync-form dn-form" aria-label="Display name" onSubmit={(e) => { e.preventDefault(); if (changed && !bad && next == null && !busy) void save(); }}>
        <Input aria-labelledby="dn-h" aria-describedby="dn-hint" value={text} placeholder="Your name, like Sam K." maxLength={MAX_DISPLAY * 4}
          autoComplete="nickname" enterKeyHint="done" disabled={busy} onChange={(e) => { setText(e.target.value); setMsg(null); }} />
        {bad ? <p className="small err" role="status">{bad}</p>
          : n > MAX_DISPLAY - 6 && <p className="muted small" role="status">{n} of {MAX_DISPLAY}</p>}
        <p id="dn-hint" className="muted small">{next != null
          ? `You changed it in the last day. You can change it again after ${when(next)}.`
          : `1–${MAX_DISPLAY} characters. Shows to friends, always with @${lists.me} beside it. Once a day.`}</p>
        {changed && (
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={() => { setText(saved); setMsg(null); }}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !!bad || next != null}>{clean ? 'Save name' : 'Remove name'}</button>
          </div>
        )}
      </form>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'muted small' : 'warn'}>{msg.text}</p>}
    </section>
  );
}

/** How others see you: your display name (else @username) in bold, the ✓ if you have it, @username in grey. */
export function SeenAsCard({ uid, lists }: { uid: string; lists: Lists & { me: string } }) {
  const on = useVerified(uid)[uid] != null;
  const lead = lists.dn;
  return (
    <section className="card" aria-labelledby="seen-h">
      <h2 id="seen-h">How others see you</h2>
      <div className="seen-row">
        <span className="avatar" aria-hidden="true">{initials(lead || lists.me)}</span>
        <span className="fname seen-name">
          {lead ? <><span className="ftag"><Glued text={lead} after={on && <Verified name={lists.me} />} /></span> <span className="fuser">@{lists.me}</span></>
            : <span className="ftag"><Glued text={`@${lists.me}`} after={on && <Verified name={lists.me} />} /></span>}
        </span>
      </div>
      <p className="muted small">A friend who gave you a private tag sees their tag in its place.</p>
      {isOwner(uid) && <VerifyToggle me={uid} uid={uid} name={lists.me} self />}
    </section>
  );
}

/**
 * The owner's switch for someone's ✓ (social S2): on a friend's page, and on your own preview for yourself. Nobody else sees it,
 * and firestore.rules refuse anyone else's write anyway.
 */
export function VerifyToggle({ me, uid, name, self }: { me: string; uid: string; name: string; self?: boolean }) {
  const on = useVerified(me)[uid] != null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!isOwner(me)) return null;
  const flip = async () => {
    setBusy(true); setErr(null);
    try { await setVerifiedHere(await loadCloud(), me, uid, !on); }
    catch (e) { setErr(cloudError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="vtoggle">
      <button type="button" className="mini" aria-pressed={on} disabled={busy} onClick={() => void flip()}>{on ? 'Remove the ✓' : 'Give the ✓'}</button>
      <span className="muted small">{on
        ? <>{self ? 'You have' : `@${name} has`} the ✓. Only you can give or remove it.</>
        : <>{self ? 'Give yourself the ✓' : `The ✓ says you know this is really @${name}`}. Only you can give it.</>}</span>
      {err && <p role="alert" className="warn">{err}</p>}
    </div>
  );
}
