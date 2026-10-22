import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cloudError, loadCloud } from '../cloud/firebase';
import { isOwner } from '../cloud/owner';
import {
  acceptBoard, banUser, checkVerified, createPost, deletePost, removePost, reportPost, saveList, sendVerification, setLike, type Mine,
} from '../cloud/board';
import { blockFriend, sendRequest } from '../cloud/friends';
import {
  AGE_FLOOR, CONTENT_RULES, HIDDEN_MAX, MAX_POST, MIN_SHOWN, MUTED_MAX, REASONS, RULES_FOOTER, cleanPost, gateSteps, leadOf,
  maskEmail, personalWarning, postAgo, postError, postsFrom, rowsOf, shownCount, toggleIn, type Filters, type Post, type Reason,
} from '../domain/board';
import { morePosts, noteGone, noteLike, noteMine, notePost, noteSeen, openBoard, patchBoard, useBoard } from '../state/board';
import { peekFriendCache, refreshLists, useFriendCache, useFriendTags } from '../state/friendCache';
import { VerifyToggle } from './DisplayNameCard';
import { Glued, Verified } from './FriendName';
import { Icon, initials } from './icons';
import { StatsSheet } from './StatsSheet';
import './board.css';

// The board (social S3, S4): one page everyone signed in reads, newest first, from what this phone kept (state/board) and read
// again at most once a minute. Posting waits behind the gate (a username, a verified email, "16 or older and the rules", a day-old
// account). Each post: a 💪, Hide, and ⋯ for the rest (mute, a friend request, report, block; your own: delete; the owner's:
// remove, ban, the ✓). A post 3 people reported is a line for everyone else until the owner reviews it (More › Board review).

type Msg = { ok: boolean; text: string; undo?: () => void };
const plain = (e: unknown) => cloudError(e);
/** "Not now" on the gate, remembered on this phone for the account that said it. */
const FOLD_KEY = 'board:folded';

/** `pulled` moves on each pull at the top of Friends: the board is read again whole. */
export function Board({ uid, email, pulled, onAccount }: { uid: string; email: string | null | undefined; pulled: number; onAccount: () => void }) {
  const board = useBoard(uid);
  const cache = useFriendCache(uid);
  const lists = cache?.lists;
  const tags = useFriendTags(uid);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [acting, setActing] = useState<Post | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);
  const [more, setMore] = useState(false);
  const now = Date.now();

  const filtersOf = useCallback((mine: Mine | undefined): Filters => ({
    me: uid, hidden: new Set(mine?.hidden ?? []), muted: new Set(mine?.muted ?? []),
    blocked: new Set((peekFriendCache(uid)?.lists?.blocked ?? []).map((b) => b.uid)), owner: isOwner(uid),
  }), [uid]);
  const filters = useMemo(() => filtersOf(board?.mine), [filtersOf, board?.mine, lists?.blocked]);

  const fetchMore = useCallback(async () => {
    setMore(true);
    try { await morePosts(await loadCloud(), uid); } catch { /* the sentinel tries again when it next shows */ } finally { setMore(false); }
  }, [uid]);
  const load = useCallback(async (force = false) => {
    try {
      const c = await loadCloud();
      await c.auth.authStateReady();
      setVerified(!!c.auth.currentUser?.emailVerified);
      const b = await openBoard(c, uid, { force });
      setNote(null);
      // Hides and mutes can leave a page nearly empty: one more page then, not a screen of nothing.
      if (!b.end && shownCount(b.posts, filtersOf(b.mine), Date.now()) < MIN_SHOWN) await morePosts(c, uid);
      if (!peekFriendCache(uid)?.lists) void refreshLists(c, uid).catch(() => {});
    } catch (e) { setNote(peekFriendCache(uid)?.board ? 'Couldn’t refresh: showing what this phone saved.' : plain(e)); }
  }, [uid, filtersOf]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (pulled) void load(true); }, [pulled]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // The next page as the end comes within 400px.
  const end = useRef<HTMLDivElement>(null);
  const canMore = !!board?.posts.length && !board.end;
  useEffect(() => {
    const el = end.current;
    if (!el || !canMore || more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) void fetchMore(); }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [canMore, more, fetchMore, board?.posts.length]);

  const steps = gateSteps({ username: lists?.me ?? null, emailVerified: !!verified, accepted: !!board?.mine?.ok, createdAt: lists?.createdAt, banned: !!board?.notice?.banned }, now);
  const banned = steps[0] === 'banned';
  // Never accepted: the gate shows open, as the board's first word to you. "Not now" folds it until Post is tapped.
  const [folded, setFoldedState] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === uid; } catch { return false; } });
  const setFolded = (v: boolean) => { setFoldedState(v); try { if (v) localStorage.setItem(FOLD_KEY, uid); else localStorage.removeItem(FOLD_KEY); } catch { /* this visit only */ } };
  const showGate = !banned && steps.length > 0 && (gateOpen || (!board?.mine?.ok && !folded && board?.mine != null));
  const rows = board ? rowsOf(board.posts, filters, now) : [];
  const notice = board?.notice;
  const removedNew = notice && notice.removed > (board?.seenRemoved ?? 0) ? notice.removed - (board?.seenRemoved ?? 0) : 0;
  const verifiedBy = board?.verified ?? lists?.verified ?? {};

  const act = async (f: () => Promise<void>, done?: Msg) => {
    setMsg(null);
    try { await f(); if (done) setMsg(done); } catch (e) { setMsg({ ok: false, text: plain(e) }); }
  };
  const setList = (key: 'hidden' | 'muted', list: string[]) => act(async () => {
    const mine = board?.mine ?? { ok: false, hidden: [], muted: [] };
    await saveList(await loadCloud(), uid, key, list);
    await noteMine(uid, { ...mine, [key]: list });
  });
  const hide = (p: Post) => {
    const before = board?.mine?.hidden ?? [];
    void setList('hidden', toggleIn(before, p.id, true, HIDDEN_MAX)).then(() => setMsg({ ok: true, text: 'Post hidden.', undo: () => void setList('hidden', before).then(() => setMsg(null)) }));
  };
  const like = (p: Post) => {
    const on = !board?.liked?.includes(p.id);
    void noteLike(uid, p.id, on);
    void (async () => {
      try { await setLike(await loadCloud(), uid, p.id, on); } catch (e) {
        // Refused a 💪 already given (from another phone): it stays given. Anything else goes back as it was.
        if (on && (e as { code?: string }).code === 'permission-denied' && !banned) return;
        await noteLike(uid, p.id, !on);
        setMsg({ ok: false, text: banned ? 'Your account can’t give a 💪 on the board.' : plain(e) });
      }
    })();
  };
  const post = () => {
    setMsg(null);
    if (steps.length) { setGateOpen(true); setFolded(false); window.scrollTo(0, 0); return; }
    setComposing(true);
  };

  return (
    <div className="board">
      {banned && <p className="card bd-notice" role="status">The app’s owner banned this account from the board for breaking its rules. You can still read it.</p>}
      {!banned && removedNew > 0 && (
        <div className="card bd-notice" role="status">
          <p>The app’s owner removed {removedNew === 1 ? 'a post' : `${removedNew} posts`} of yours for breaking the board’s rules.</p>
          <button type="button" className="mini" onClick={() => void noteSeen(uid, notice!.removed)}>OK</button>
        </div>
      )}
      {showGate ? (
        <Gate uid={uid} email={email} steps={steps} accepted={!!board?.mine?.ok} createdAt={lists?.createdAt}
          onVerified={setVerified} onAccount={onAccount} onJoined={() => setGateOpen(true)} onFold={() => { setGateOpen(false); setFolded(true); }} />
      ) : (
        <div className="bd-head">
          <p className="bd-sub">Everyone on Gym Tracker · newest first</p>
          {!banned && <button type="button" className="primary bd-post" onClick={post}>Post</button>}
        </div>
      )}
      {note && <p className="muted small" role="status">{note}</p>}
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`bd-msg small ${msg.ok ? 'ok' : 'warn'}`}>
          {msg.text}{msg.undo && <> <button type="button" className="bd-link" onClick={msg.undo}>Undo</button></>}
        </p>
      )}
      {board == null ? <p className="muted">Loading…</p>
        : !rows.length && board.end ? <p className="muted bd-empty">Nothing on the board yet. {banned ? '' : 'Say hello.'}</p>
        : (
          <ol className="bd-list" aria-label="Posts">
            {rows.map((r) => r.kind === 'held' ? (
              <li key={r.id} className="bd-held" data-post={r.id}>Hidden after reports, waiting for review</li>
            ) : (
              <PostCard key={r.post.id} me={uid} p={r.post} held={r.held} lead={tags[r.post.uid] || leadOf(r.post)} checked={verifiedBy[r.post.uid] != null}
                liked={!!board.liked?.includes(r.post.id)} now={now} onLike={() => like(r.post)} onHide={() => hide(r.post)} onMore={() => setActing(r.post)} />
            ))}
          </ol>
        )}
      <div ref={end} className="bd-end" aria-hidden={!canMore}>
        {canMore && <button type="button" className="mini" disabled={more} onClick={() => void fetchMore()}>{more ? 'Loading…' : 'Older posts'}</button>}
      </div>
      {composing && lists?.me && (
        <Compose me={uid} user={lists.me} name={lists.dn} onClose={() => setComposing(false)}
          onPosted={(p) => { setComposing(false); void notePost(uid, p); setMsg({ ok: true, text: 'Posted.' }); }} />
      )}
      {acting && (
        <PostSheet me={uid} p={acting} lead={tags[acting.uid] || leadOf(acting)} mine={board?.mine} friend={!!lists?.friends.some((f) => f.uid === acting.uid)}
          myName={lists?.me ?? null} onClose={() => setActing(null)}
          onHide={() => { setActing(null); hide(acting); }}
          onMute={(on) => { const p = acting; setActing(null); void setList('muted', toggleIn(board?.mine?.muted ?? [], p.uid, on, MUTED_MAX)).then(() => setMsg({ ok: true, text: on ? `@${p.user} is muted on the board.` : `@${p.user} is back on your board.` })); }}
          onReport={() => { setReporting(acting); setActing(null); }}
          onDone={(text) => { setActing(null); if (text) setMsg({ ok: true, text }); }}
          onError={(text) => setMsg({ ok: false, text })} />
      )}
      {reporting && (
        <ReportSheet can={steps.length === 0} onClose={() => setReporting(null)}
          onPick={(why) => {
            const p = reporting;
            setReporting(null);
            void act(async () => {
              const hidden = toggleIn(board?.mine?.hidden ?? [], p.id, true, HIDDEN_MAX);
              await reportPost(await loadCloud(), uid, p.id, why, hidden);
              await noteMine(uid, { ...(board?.mine ?? { ok: true, hidden: [], muted: [] }), hidden });
            }, { ok: true, text: 'Reported. Thanks: the owner reviews every report, and the post is hidden for you.' });
          }} />
      )}
    </div>
  );
}

function PostCard({ me, p, held, lead, checked, liked, now, onLike, onHide, onMore }: {
  me: string; p: Post; held?: boolean; lead?: string; checked: boolean; liked: boolean; now: number; onLike: () => void; onHide: () => void; onMore: () => void;
}) {
  const check = checked && <Verified name={p.user} />;
  return (
    <li className="bd-card" data-post={p.id}>
      <div className="bd-card-head">
        <span className="avatar" aria-hidden="true">{initials(lead || p.user)}</span>
        <span className="bd-who">
          {lead ? <><b className="bd-lead"><Glued text={lead} after={check} /></b> <span className="bd-user">@{p.user}</span></> : <b className="bd-lead"><Glued text={`@${p.user}`} after={check} /></b>}
        </span>
        <time className="bd-ago" dateTime={new Date(p.at).toISOString()}>{postAgo(p.at, now)}</time>
      </div>
      {held && <p className="bd-heldnote small">{p.uid === me ? 'Hidden for others after reports, waiting for the owner’s review.' : 'Held after reports: you see it as the owner.'}</p>}
      <p className="bd-text">{p.t}</p>
      <div className="bd-actions">
        <button type="button" className="bd-like" aria-pressed={liked} aria-label={`💪 ${p.likes}${liked ? ', yours included' : ''}`} onClick={onLike}>
          <span aria-hidden="true">💪</span><span className="bd-n">{p.likes}</span>
        </button>
        {p.uid !== me && <button type="button" className="bd-hide" onClick={onHide}>Hide</button>}
        <button type="button" className="mini icon bd-more" aria-label={`More for the post by @${p.user}`} onClick={onMore}><Icon name="more" /></button>
      </div>
    </li>
  );
}

/** What stands between you and a post, each with its way through; the rules once, to accept. */
function Gate({ uid, email, steps, accepted, createdAt, onVerified, onAccount, onJoined, onFold }: {
  uid: string; email: string | null | undefined; steps: string[]; accepted: boolean; createdAt?: number;
  onVerified: (v: boolean) => void; onAccount: () => void; /** Accepted: the gate stays open on what's left. */ onJoined: () => void; onFold: () => void;
}) {
  const [age, setAge] = useState(false);
  const [rules, setRules] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await f(); } catch (e) { setMsg({ ok: false, text: plain(e) }); } finally { setBusy(false); }
  };
  const emailOk = !steps.includes('email');
  const from = postsFrom(createdAt);
  const left = steps.filter((s) => s !== 'accept');
  const why = left.includes('username') ? 'Posting opens once you’ve chosen a username.'
    : left.includes('email') ? 'Posting opens once your email is verified.'
    : left.includes('age') ? `Posting opens once your account is a day old${from ? `: ${new Date(from).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}.`
    : null;
  return (
    <section className="card bd-gate" aria-label="Join the board">
      <h2>The board</h2>
      <p className="bd-gate-lead">One page everyone on Gym Tracker can read and post to. Your log stays with your friends; only what you write here is shared.</p>
      {!accepted && (<>
        <ol className="bd-rules">{CONTENT_RULES.map((r) => <li key={r}>{r}</li>)}</ol>
        <p className="muted small">{RULES_FOOTER}</p>
        <label className="bd-check"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /><span>I’m {AGE_FLOOR} or older</span></label>
        <label className="bd-check"><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /><span>I’ll keep to the board’s rules. Posts that break them are removed.</span></label>
      </>)}
      {steps.includes('username') && (
        <div className="bd-step">
          <span className="bd-box" aria-hidden="true" /><span>A username · <span className="bd-notyet">not yet</span>
            <button type="button" className="bd-link bd-steplink" onClick={onAccount}>Pick one on Friends</button></span>
        </div>
      )}
      <div className="bd-step">
        <span className={`bd-box${emailOk ? ' on' : ''}`} aria-hidden="true">{emailOk && <Icon name="check" size={18} sw={2.5} />}</span>
        <span>Email verified{!emailOk && <> · <span className="bd-notyet">not yet</span></>}
          {!emailOk && <span className="muted small bd-stepsub">{sent ? `We sent a link to ${maskEmail(email)}. Open it, then come back.` : `We’ll send a link to ${maskEmail(email)}.`}</span>}
        </span>
      </div>
      {!emailOk && (
        <div className="bd-gate-btns">
          <button type="button" className="wide" disabled={busy} onClick={() => void run(async () => { await sendVerification(await loadCloud()); setSent(true); setMsg({ ok: true, text: 'Sent. Check your inbox (and spam).' }); })}>{sent ? 'Resend link' : 'Send link'}</button>
          {sent && <button type="button" className="wide" disabled={busy} onClick={() => void run(async () => {
            const ok = await checkVerified(await loadCloud());
            onVerified(ok);
            if (!ok) setMsg({ ok: false, text: 'Not verified yet. Open the link in the email, then try again.' });
          })}>I’ve opened it</button>}
        </div>
      )}
      {!accepted ? (
        <button type="button" className="primary wide bd-join" disabled={busy || !age || !rules} onClick={() => void run(async () => {
          await acceptBoard(await loadCloud(), uid);
          const mine = peekFriendCache(uid)?.board?.mine ?? { ok: false, hidden: [], muted: [] };
          await noteMine(uid, { ...mine, ok: true });
          onJoined();
        })}>Join the board</button>
      ) : null}
      {why && <p className="muted small">{accepted ? why : `You can read posts now. ${why}`}</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`small ${msg.ok ? 'ok' : 'warn'}`}>{msg.text}</p>}
      <button type="button" className="bd-link bd-fold" onClick={onFold}>Not now</button>
    </section>
  );
}

/** A new post: a sheet from the bottom with its words, what's left of 280, and a warning when it looks like someone's details. */
function Compose({ me, user, name, onClose, onPosted }: { me: string; user: string; name?: string; onClose: () => void; onPosted: (p: Post) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const clean = cleanPost(text);
  const left = MAX_POST - clean.length;
  const why = clean ? postError(clean) : null;
  const careful = personalWarning(clean);
  const send = async () => {
    const e = postError(clean);
    if (e) { setErr(e); return; }
    setBusy(true); setErr(null);
    try { onPosted(await createPost(await loadCloud(), me, clean)); } catch (x) { setErr(plain(x)); } finally { setBusy(false); }
  };
  return createPortal(<>
    <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
    <section className="sheet bd-compose" role="dialog" aria-modal="true" aria-label="New post">
      <header className="bd-compose-head">
        <button type="button" className="bd-link" onClick={onClose}>Cancel</button>
        <h2>New post</h2>
        <button type="button" className="primary bd-post" disabled={busy || !clean || !!why} onClick={() => void send()}>Post</button>
      </header>
      <textarea ref={field} className="bd-field" aria-label="Your post" rows={5} maxLength={MAX_POST * 2} placeholder="Say something to everyone"
        onChange={(e) => setText(e.target.value)} />
      <div className="bd-compose-meta small">
        <span>Posting as {name && name !== user ? <><b>{name}</b> @{user}</> : <b>@{user}</b>}</span>
        <span className={left < 0 ? 'warn' : 'muted'} aria-live="polite">{left} left</span>
      </div>
      <p className="muted small">Everyone on the board sees this. No links or photos. Never post where you train, your number, or anyone else’s details.</p>
      {careful && <p className="warn small" role="status">{careful}</p>}
      {(err || why) && <p className="warn small" role="alert">{err ?? why}</p>}
    </section>
  </>, document.body);
}

/** ⋯ on a post: hide, mute, a friend request, report, block; your own, delete; the owner's, remove, ban and the ✓. */
function PostSheet({ me, p, lead, mine, friend, myName, onClose, onHide, onMute, onReport, onDone, onError }: {
  me: string; p: Post; lead?: string; mine?: Mine; friend: boolean; myName: string | null; onClose: () => void; onHide: () => void;
  onMute: (on: boolean) => void; onReport: () => void; onDone: (text?: string) => void; onError: (text: string) => void;
}) {
  const [armed, setArmed] = useState<'block' | 'delete' | 'remove' | 'ban' | null>(null);
  const [busy, setBusy] = useState(false);
  const own = p.uid === me, owner = isOwner(me);
  const muted = !!mine?.muted.includes(p.uid);
  const run = async (f: () => Promise<string | undefined>) => {
    setBusy(true);
    try { onDone(await f()); } catch (e) { onError(plain(e)); onClose(); } finally { setBusy(false); }
  };
  const title = lead ? `${lead} · @${p.user}` : `@${p.user}`;
  return (
    <StatsSheet title={title} onClose={onClose}>
      <ul className="bd-acts">
        {!own && <li><button type="button" onClick={onHide}>Hide this post</button></li>}
        {!own && <li><button type="button" disabled={!mine} onClick={() => onMute(!muted)}>{muted ? `Unmute @${p.user} on the board` : `Mute @${p.user} on the board`}</button></li>}
        {!own && !friend && myName && <li><button type="button" disabled={busy} onClick={() => void run(async () => {
          const r = await sendRequest(await loadCloud(), me, myName, p.user);
          return r === 'accepted' ? `You and @${p.user} are friends now.` : `Request sent to @${p.user}.`;
        })}>Send a friend request</button></li>}
        {!own && <li><button type="button" className="danger" onClick={onReport}>Report post…</button></li>}
        {!own && <li><button type="button" className="danger" disabled={busy} onClick={() => armed === 'block' ? void run(async () => {
          const c = await loadCloud();
          await blockFriend(c, me, p.uid);
          await refreshLists(c, me).catch(() => {});
          return `@${p.user} is blocked.`;
        }) : setArmed('block')}>{armed === 'block' ? `Tap again to block @${p.user}` : `Block @${p.user}`}</button></li>}
        {own && <li><button type="button" className="danger" disabled={busy} onClick={() => armed === 'delete' ? void run(async () => {
          await deletePost(await loadCloud(), p.id);
          await noteGone(me, p.id);
          return 'Post deleted.';
        }) : setArmed('delete')}>{armed === 'delete' ? 'Tap again to delete it' : 'Delete post'}</button></li>}
        {owner && !own && <li><button type="button" className="danger" disabled={busy} onClick={() => armed === 'remove' ? void run(async () => {
          await removePost(await loadCloud(), p);
          await noteGone(me, p.id);
          return `Removed. @${p.user} is told on their next visit.`;
        }) : setArmed('remove')}>{armed === 'remove' ? 'Tap again to remove it' : 'Remove post (owner)'}</button></li>}
        {owner && !own && <li><button type="button" className="danger" disabled={busy} onClick={() => armed === 'ban' ? void run(async () => {
          const n = await banUser(await loadCloud(), p.uid);
          await patchBoard(me, (b) => ({ ...b, posts: b.posts.filter((x) => x.uid !== p.uid) }));
          return `@${p.user} is banned; ${n === 1 ? 'their post is' : `${n} posts are`} gone.`;
        }) : setArmed('ban')}>{armed === 'ban' ? `Tap again to ban @${p.user}` : `Ban @${p.user} (owner)`}</button></li>}
      </ul>
      {owner && !own && <VerifyToggle me={me} uid={p.uid} name={p.user} />}
      {!own && <p className="muted small">Blocking hides all their posts and stops their requests and messages. They aren’t told.</p>}
    </StatsSheet>
  );
}

/** Why: six reasons, one tap. Past the gate only (it keeps reports from throwaway accounts). */
function ReportSheet({ can, onClose, onPick }: { can: boolean; onClose: () => void; onPick: (why: Reason) => void }) {
  return (
    <StatsSheet title="Report post" onClose={onClose}>
      {can ? (<>
        <p className="muted small">Why? The owner reviews every report.</p>
        <ul className="bd-acts">{REASONS.map((r) => <li key={r.key}><button type="button" onClick={() => onPick(r.key)}>{r.label}</button></li>)}</ul>
        <p className="muted small">At 3 reports a post is hidden for everyone until it’s reviewed. It’s hidden for you now.</p>
      </>) : (
        <p className="muted">Reporting opens once you’ve joined the board, which keeps reports from throwaway accounts. You can hide this post, and mute or block whoever wrote it, now.</p>
      )}
    </StatsSheet>
  );
}
