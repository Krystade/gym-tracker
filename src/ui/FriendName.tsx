import { useCallback, useState } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { cleanTag, formerlyOf, MAX_TAG, tagged } from '../domain/friendNames';
import { setFriendTag, useFriendCacheSelect, useFriendTags } from '../state/friendCache';
import { Input } from './Field';
import './friendNames.css';

// A friend as you know them, wherever they show: your private tag beside their @username, and "formerly @old" for 30 days
// after they change it (domain/friendNames). Tags are yours alone, kept by uid on your account (cloud/tags).

export interface Named { uid: string; name: string; prev?: string; changedAt?: number }

/** "Sam (gym) · @sam_k" or "@sam_k", for text: a heading, a label, a line read out. */
export function useFriendLabel(me: string | null | undefined): (uid: string, name: string) => string {
  const tags = useFriendTags(me);
  return useCallback((uid: string, name: string) => tagged(name, tags[uid]), [tags]);
}

/** A friend as your friends list last read them (their name now, what it was), over what a screen was handed; by uid. */
function useNamed(me: string | null | undefined, friend: Named): Named {
  const known = useFriendCacheSelect(me, (c) => c?.lists?.friends.find((f) => f.uid === friend.uid));
  return known ? { ...friend, name: known.name, prev: known.prev, changedAt: known.changedAt } : friend;
}

/** Your tag in bold and their @username beside it (just the @username without a tag); "formerly @old" after it unless `bare`. */
export function FriendName({ me, friend: given, bare }: { me: string | null | undefined; friend: Named; bare?: boolean }) {
  const friend = useNamed(me, given);
  const tag = useFriendTags(me)[friend.uid];
  return (
    <span className="fname">
      {tag ? <><span className="ftag">{tag}</span> <span className="fuser">@{friend.name}</span></> : <>@{friend.name}</>}
      {!bare && <Formerly friend={friend} />}
    </span>
  );
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
