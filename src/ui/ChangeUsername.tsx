import { useState } from 'react';
import type { Cloud } from '../cloud/firebase';
import { claimUsername } from '../cloud/friends';
import { nextChangeAt } from '../domain/friendNames';
import { cleanUsername, USERNAME } from '../domain/invite';
import { Input } from './Field';
import './friendNames.css';

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * "You're @x" and Change username beside it, opening in place: a new name in one write (cloud/friends claimUsername), at most
 * once a day. Friends go by your account, not your name, so nothing else changes; for 30 days they see "formerly @x" too.
 */
export function ChangeUsername({ uid, me, changedAt, busy, act, setMe }: {
  uid: string; me: string; changedAt?: number; busy: boolean;
  act: (f: (c: Cloud) => Promise<string | void>) => Promise<void>; setMe: (n: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const n = cleanUsername(name), ok = USERNAME.test(n) && n !== me;
  const next = nextChangeAt(changedAt, Date.now());
  return (
    <>
      <div className="me-line">
        <p className="muted small">You’re @{me}. Friends see your log, notes, body weight, priorities and program. Never your photos.</p>
        {!open && <button type="button" className="mini" disabled={busy} onClick={() => { setName(me); setOpen(true); }}>Change username</button>}
      </div>
      {open && (
        <form className="sync-form name-form" aria-label="Change username" onSubmit={(e) => {
          e.preventDefault();
          if (ok && next == null) void act(async (c) => { await claimUsername(c, uid, n); setMe(n); setOpen(false); return `You’re @${n} now. Friends see it at once, with “formerly @${me}” for 30 days.`; });
        }}>
          <label>New username<Input autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {name && !USERNAME.test(n) && <p className="small err" role="status">3–20 lowercase letters, numbers or _</p>}
          <p className="muted small">{next != null
            ? `You changed it in the last day. You can change it again after ${when(next)}.`
            : `Friends keep you and see the new name at once. Once a day at most; @${me} is free for anyone after.`}</p>
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="primary" disabled={!ok || busy || next != null}>Save username</button>
          </div>
        </form>
      )}
    </>
  );
}
