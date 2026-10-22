import { useCallback, useState, type ReactNode } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { cleanTag, formerlyOf, MAX_TAG, tagged } from '../domain/friendNames';
import { setFriendTag, useFriendCacheSelect, useFriendTags, type FriendCache } from '../state/friendCache';
import { Input } from './Field';
import { StatsSheet } from './StatsSheet';
import './friendNames.css';

// A friend as you know them, wherever they show: in bold your private tag, else the display name they chose (social S1), else
// their @username; the @username beside it in grey whenever something else leads, so it's never hidden (two people can both be
// "Mara R.", only one is @mara_lifts); "formerly @old" for 30 days after they change it (domain/friendNames); and the ✓ after
// the name when the app's owner verified them (social S2). Tags are yours alone, kept by uid on your account (cloud/tags).

export interface Named { uid: string; name: string; /** Their display name (domain/displayName), when they set one. */ dn?: string; prev?: string; changedAt?: number }

const same = (a: Record<string, string | number>, b: Record<string, string | number>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
const NONE: Record<string, never> = {};
const pickDns = (c: FriendCache | undefined): Record<string, string> => {
  const fs = c?.lists?.friends.filter((f) => f.dn);
  return fs?.length ? Object.fromEntries(fs.map((f) => [f.uid, f.dn!])) : NONE;
};
const pickVerified = (c: FriendCache | undefined): Record<string, number> => c?.lists?.verified ?? NONE;
/** Who the app's owner verified, by uid (config/verified), as your lists last read it. */
export const useVerified = (me: string | null | undefined) => useFriendCacheSelect(me, pickVerified, same);

/** "Sam (gym) · @sam_k", "Sam K. · @sam_k" or "@sam_k", for text: a heading, a label, a line read out. */
export function useFriendLabel(me: string | null | undefined): (uid: string, name: string, dn?: string) => string {
  const tags = useFriendTags(me);
  const dns = useFriendCacheSelect(me, pickDns, same);
  return useCallback((uid: string, name: string, dn?: string) => tagged(name, tags[uid] || dn || dns[uid]), [tags, dns]);
}

/** A friend as your friends list last read them (their name now, what it was, their display name), over what a screen was handed; by uid. */
function useNamed(me: string | null | undefined, friend: Named): Named {
  const known = useFriendCacheSelect(me, (c) => c?.lists?.friends.find((f) => f.uid === friend.uid));
  return known ? { ...friend, name: known.name, dn: known.dn, prev: known.prev, changedAt: known.changedAt } : friend;
}

/**
 * In bold your tag, else their display name, with their @username beside it in grey; just the @username when neither; the ✓
 * after the name when verified; "formerly @old" after it all unless `bare`. `inButton`: the name sits inside a button (Today's
 * banner, a Compare row), so the ✓ is drawn there but isn't a button of its own.
 */
export function FriendName({ me, friend: given, bare, inButton }: { me: string | null | undefined; friend: Named; bare?: boolean; inButton?: boolean }) {
  const friend = useNamed(me, given);
  const lead = useFriendTags(me)[friend.uid] || friend.dn;
  const check = useVerified(me)[friend.uid] != null && <Verified name={friend.name} tap={!inButton} />;
  return (
    <span className="fname">
      {lead ? <><span className="ftag"><Glued text={lead} after={check} /></span> <span className="fuser">@{friend.name}</span></> : <Glued text={`@${friend.name}`} after={check} />}
      {!bare && <Formerly friend={friend} />}
    </span>
  );
}

const graphemes = (s: string) =>
  typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment) : [...s];
/**
 * `text` with `after` (the ✓) held to its last character, so a line never breaks between a name and its ✓: a long name wraps
 * before its last word, and the ✓ goes with it.
 */
export function Glued({ text, after }: { text: string; after: ReactNode }) {
  if (!after) return <>{text}</>;
  const g = graphemes(text), last = g.pop() ?? '';
  return <>{g.join('')}<span className="vglue">{last}{after}</span></>;
}

/** The ✓ itself: drawn, never text, so no name can carry one (domain/displayName refuses everything like it). */
export function CheckMark() {
  return (
    <svg className="vglyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="10" />
      <path d="M5.6 10.3l2.9 2.9 5.9-6" />
    </svg>
  );
}

/**
 * The ✓ after a verified person's name. Tapped, a sheet says what it means: the app's owner confirmed this is the real @x
 * (owner, 2026-10-22). `tap` false: drawn only (the name is inside a button).
 */
export function Verified({ name, tap = true }: { name: string; tap?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tap) return <span className="vcheck" role="img" aria-label="verified"><CheckMark /></span>;
  return (<>
    <button type="button" className="vcheck" aria-label="Verified" onClick={(e) => { e.stopPropagation(); setOpen(true); }}><CheckMark /></button>
    {open && (
      <StatsSheet title="Verified" onClose={() => setOpen(false)}>
        <p className="vsheet"><span className="vcheck" aria-hidden="true"><CheckMark /></span><span>Verified by the app’s owner: this is the real @{name}.</span></p>
      </StatsSheet>
    )}
  </>);
}

/** "formerly @old", for 30 days after they changed their username; nothing otherwise. */
export function Formerly({ friend }: { friend: Named }) {
  const was = formerlyOf(friend, Date.now()); // a 30-day span: the time of the render is near enough
  return was ? <span className="fwas"> formerly @{was}</span> : null;
}

/**
 * "Add a tag" (or the tag, to change it): a private name for this friend, e.g. "Sam (gym)", shown beside their @username in
 * Friends, threads and notifications. Only you see it. Opens in place, never over the screen.
 */
export function FriendTagEditor({ me, friend }: { me: string; friend: Named }) {
  const tag = useFriendTags(me)[friend.uid] ?? '';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (t: string) => {
    setBusy(true); setErr(null);
    try { await setFriendTag(await loadCloud(), me, friend.uid, t); setOpen(false); }
    catch (e) { setErr(cloudError(e)); }
    finally { setBusy(false); }
  };
  if (!open) {
    return (
      <div className="ftag-line">
        <button type="button" className="mini ftag-edit" onClick={() => { setText(tag); setErr(null); setOpen(true); }}>{tag ? 'Edit tag' : 'Add a tag'}</button>
        <span className="muted small">{tag ? <>You call @{friend.name} <b>{tag}</b>. Only you see it.</> : 'A name only you see, like “Sam (gym)”.'}</span>
      </div>
    );
  }
  const clean = cleanTag(text);
  return (
    <form className="sync-form ftag-form" aria-label={`Tag for @${friend.name}`} onSubmit={(e) => { e.preventDefault(); if (clean !== tag) void save(clean); else setOpen(false); }}>
      <label>Your tag for @{friend.name}
        <Input autoFocus value={text} maxLength={MAX_TAG * 2} placeholder="Sam (gym)" enterKeyHint="done" onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="muted small">Shows beside @{friend.name} in Friends, messages and notifications. Only you see it, and it stays if they change their username.</p>
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        {tag && <button type="button" disabled={busy} onClick={() => void save('')}>Remove</button>}
        <button type="submit" className="primary" disabled={busy || (!clean && !tag)}>Save</button>
      </div>
      {err && <p role="alert" className="warn">{err}</p>}
    </form>
  );
}
