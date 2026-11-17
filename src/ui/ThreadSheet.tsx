import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { blockFriend, clearSentGym, friendState, markRead, removeFriend, sendMessage, sendPing, sendSticker, setMuted } from '../cloud/friends';
import { MAX_MESSAGE, messageOk, PRESET_KEYS, PRESETS, shortAgo, type PresetKey } from '../domain/messages';
import { patchFriendCache, peekFriendCache, readLocally, refreshThread, useFriendCache } from '../state/friendCache';
import { copyGym } from '../domain/share';
import { useMinute } from '../state/clock';
import type { GymsStore } from '../state/useGyms';
import { Icon, initials } from './icons';
import { FriendName, FriendTagEditor, useFriendLabel } from './FriendName';
import { useArmed } from './useArmed';
import { useSheet } from './useSheet';
import { makeSticker, stickerFromElement } from './stickerImage';
import { MessageBox, readBox, writeBox } from './MessageBox';
import { rankOf, recentRow, stickerId } from '../domain/stickerLibrary';
import { keepStickers, setFavourite, useStickers } from '../state/stickers';
import { StickerDrawer } from './StickerDrawer';

/** The friend a thread is with: from a row (name known) or a notification (uid alone). */
export interface ThreadWith { uid: string; name?: string }

const COUNT_FROM = 100; // the count shows only once a message nears the limit
/** A send not answered by then says it's going ("Sending…") until it is; cloud/friends gives up on it at SEND_WAIT_MS. */
const SLOW_MS = 1000;

/**
 * What a send that failed after its sheet was closed left behind (the sticker, the words, why), per you and friend: the thread
 * puts it back in the box and says why when it next opens, or at once if it's open again already, so nothing that didn't go
 * is lost without a word.
 */
type Unsent = { sticker?: string; text?: string; why?: string };
const unsent = new Map<string, Unsent>();
const openThreads = new Map<string, () => void>();
const noteUnsent = (key: string, x: Unsent) => { unsent.set(key, { ...unsent.get(key), ...x }); openThreads.get(key)?.(); };
/** The line a failed send shows: its own words when it has them, else its code, for the next report from the phone. */
const whyNot = (e: unknown) => {
  const x = e as { plain?: boolean; short?: string; message?: string; code?: string };
  return x.short ?? (x.plain ? x.message! : `Couldn’t send${x.code ? ` (${x.code})` : ''}. Try again.`);
};

/**
 * Pings and messages with one friend, in a sheet from the bottom (never a centred modal: the board stays visible above
 * it). Top to bottom: who, mute and more; the last 20 items; the six pings above the field, so the keyboard can't hide
 * them; a 140-character field. Shows at once what the phone kept of the thread (state/friendCache); read again on opening,
 * when a push arrives or the app comes back, and after a run of sends. A ping tapped again and again sends every tap (owner,
 * 2026-11-12: 👀 over and over): nothing waits or locks between them; they go one after another, as fast as they're taken,
 * and only your day's 300 (socialRate) stops them, with a line saying so.
 *
 * Stickers (owner, 2026-11-12: "like iOS stickers in Messages"): one pasted into the box waits there until Send (nothing goes by
 * mistake). The sticker button opens your stickers in the keyboard's place (ui/StickerDrawer, owner 2026-11-16: sending them was
 * still "pretty clunky"): every one sent, added from Photos or seen in a thread, favourites first, each sent at a tap. The row above
 * the pings is your favourites, then the last 12 sent, and sends at a tap as a ping does. A sticker in the thread, tapped, offers
 * Favourite.
 * The box is a contenteditable (ui/MessageBox) so iOS's emoji keyboard offers its Stickers, Memoji and Genmoji there too: one put
 * in the box the same way becomes the sticker waiting for Send, and the words round it stay as they were.
 *
 * A sticker sent from the box stays there, marked as sending, until the server has it (owner, 2026-11-12: one let go at the tap
 * "looked good" and never came, and nothing said so); one not sent stays with the line saying why. A send that takes a while
 * says "Sending…"; one with no answer fails (cloud/friends SEND_WAIT_MS), and words that didn't go come back to the box.
 */
export function ThreadSheet({ me, friend, gyms, onClose, onViewLog, onChanged }: {
  me: string; friend: ThreadWith; gyms: GymsStore; onClose: () => void; onViewLog: (f: { uid: string; name: string }) => void; onChanged: () => void;
}) {
  const cache = useFriendCache(me);
  useMinute(); // each item's age ("5m") moves on by itself
  // A friend on the kept list is known at once (name, mute), so the pings work before anything is read.
  const known = cache?.lists?.friends.find((f) => f.uid === friend.uid);
  const [fetchedName, setName] = useState(friend.name ?? '');
  const name = fetchedName || known?.name || '';
  const [fetchedDn, setDn] = useState<string | undefined>(undefined);
  const dn = known?.dn ?? fetchedDn;
  const [fetched, setState] = useState<{ friend: boolean; muted: boolean } | null>(null);
  const state = fetched ?? (known ? { friend: true, muted: !!known.muted } : null);
  // Nothing kept and the read failed, or blocked just now: an empty thread rather than Loading.
  const [empty, setEmpty] = useState(false);
  const kept = cache?.threads[friend.uid];
  const items = kept?.items ?? (empty ? [] : null);
  const sentGyms = kept?.gyms ?? [];
  // What's typed lives in the box itself (uncontrolled) and `text` follows it. A controlled field is written back from state
  // on every render, and a render landing inside an input event (a thread or news read coming back: the friend cache tells
  // every screen at once, synchronously) wrote the old value over the keystroke before React's own listener saw it.
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * `fades`: a send's "Sent", which the new bubble already shows; it goes after 2 s (still read out, then gone from view).
   * `n` remounts it for each, so a run of sends shows every one ("Sent 👀 ×5") and each fades from its own start.
   */
  const [msg, setMsg] = useState<{ ok: boolean; text: string; fades?: boolean; n?: number } | null>(null);
  const [menu, setMenu] = useState(false);
  /** The sticker in the box, waiting for Send. */
  const [pending, setPending] = useState<string | null>(null);
  /** The box's sticker once Send is tapped, until its send ends: kept in a ref too, so a second tap can't send it twice. */
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const going = useRef<string | null>(null);
  const key = `${me}:${friend.uid}`;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /**
   * Your stickers (state/stickers) and the recent row as shown: favourites first, then the order the recents had when the sheet
   * opened (`rowRank`), with one new from the box put first. One resent from the row goes first only in what's kept, so the row
   * never moves under a finger tapping it again and again; it's laid out again when the drawer folds away.
   */
  const lib = useStickers(me);
  const [rowRank, setRowRank] = useState<ReadonlyMap<string, number> | null>(null);
  const recent = lib ? recentRow(lib, rowRank ?? undefined) : [];
  useEffect(() => {
    if (!lib) return;
    const r = recentRow(lib, rowRank ?? undefined);
    if (!rowRank || r.some((s) => !rowRank.has(s.id))) setRowRank(rankOf(r));
  }, [lib, rowRank]);
  /** The drawer of your stickers, open in the keyboard's place. */
  const [drawer, setDrawer] = useState(false);
  const drawerId = useId();
  /** The sticker in the thread tapped for its Favourite (its item's id). */
  const [picked, setPicked] = useState<string | null>(null);
  const { armed, arm, tap, settling } = useArmed<'remove' | 'block'>();
  const box = useSheet<HTMLElement>(onClose);
  const list = useRef<HTMLOListElement>(null);
  // The box grows a line at a time to fit what's typed, up to its CSS max-height; past that it scrolls.
  const field = useRef<HTMLDivElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async (first = false) => {
    try {
      const c = await loadCloud();
      const [s] = await Promise.all([first ? friendState(c, me, friend.uid) : Promise.resolve(null), refreshThread(c, me, friend.uid)]);
      if (s) { setName(s.name); setDn(s.dn); setState({ friend: s.friend, muted: s.muted }); }
      // Everything they sent is read now; the dots go at once, and the badge follows the news read again.
      if (!s || s.friend) await markRead(c, me, friend.uid).then(() => patchFriendCache(me, (x) => readLocally(x, friend.uid))).catch(() => {});
      changed.current();
    } catch (e) {
      // With the thread kept, it stays as it was, quietly; with nothing kept, say why it's empty.
      if (!peekFriendCache(me)?.threads[friend.uid]) { setMsg({ ok: false, text: cloudError(e) }); setEmpty(true); }
    }
  }, [me, friend.uid]);
  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    const onMsg = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === 'push') void load(); };
    document.addEventListener('visibilitychange', onVis);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { document.removeEventListener('visibilitychange', onVis); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, [load]);
  // The newest at the bottom, in view; again as the drawer takes the keyboard's place or gives it back (the thread shorter or taller).
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [items, drawer]);
  // A sticker's Favourite, shown under the last one, is scrolled into the thread's view (the list alone: never the page under it).
  useEffect(() => {
    const el = list.current, chip = el?.querySelector('.sticker-fav');
    if (!el || !chip) return;
    const over = chip.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    if (over > 0) el.scrollTop += over + 4;
  }, [picked]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = useFriendLabel(me);
  const who = name ? label(friend.uid, name, dn) : 'them';
  // Every tap queues its send behind the last (the counters are read and written in turn); the thread is read again once
  // the queue is empty, not after each. A refusal ends the run: what's still queued is dropped, and the line says why.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const run = useRef({ waiting: 0, stop: false, last: '', same: 0, n: 0 });
  // `undo`: what puts it back when it doesn't go, refused or dropped from a stopped run (the sheet closed: kept for its next open).
  const send = (f: () => Promise<unknown>, done: string, undo?: () => void) => {
    const r = run.current;
    r.waiting++;
    queue.current = queue.current.then(async () => {
      let slow: ReturnType<typeof setTimeout> | undefined;
      try {
        if (r.stop) { undo?.(); return; }
        slow = setTimeout(() => { if (alive.current) setMsg({ ok: true, text: 'Sending…', n: ++r.n }); }, SLOW_MS);
        await f();
        r.same = r.last === done ? r.same + 1 : 1;
        r.last = done;
        setMsg({ ok: true, text: r.same > 1 ? `${done} ×${r.same}` : done, fades: true, n: ++r.n });
      } catch (e) {
        r.stop = true;
        undo?.();
        if (alive.current) setMsg({ ok: false, text: whyNot(e), n: ++r.n }); else noteUnsent(key, { why: whyNot(e) });
      } finally {
        clearTimeout(slow);
        if (!--r.waiting) { run.current = { waiting: 0, stop: false, last: '', same: 0, n: r.n }; void load(); }
      }
    });
  };
  const ping = (k: PresetKey) => void send(async () => sendPing(await loadCloud(), me, friend.uid, k), `Sent ${PRESETS[k].emoji}`);
  const remember = (st: string, show: boolean) => {
    void keepStickers(me, [{ src: st, at: Date.now(), sent: true }], true).catch(() => {});
    if (show) setRowRank((r) => { if (!r) return r; const m = new Map(r); m.delete(stickerId(st)); return m; });
  };
  // From the box: it stays there until the server has it, then goes; not sent, it stays (or comes back, if taken out meanwhile).
  const sticker = (st: string, fromBox = false) => {
    if (fromBox) { going.current = st; setOutgoing(st); }
    const ended = () => { if (fromBox && going.current === st) { going.current = null; setOutgoing(null); } };
    const undo = () => { ended(); if (!fromBox) return; if (alive.current) setPending((p) => p ?? st); else noteUnsent(key, { sticker: st }); };
    send(async () => {
      await sendSticker(await loadCloud(), me, friend.uid, st);
      ended();
      if (fromBox) setPending((p) => (p === st ? null : p));
      remember(st, fromBox);
    }, 'Sent sticker', undo);
  };
  /** An image pasted, picked or put in by the keyboard: made into a sticker, it waits in the box; one that can't be says why. */
  const take = async (made: Promise<string>) => {
    try { setPending(await made); } catch (e) { setMsg({ ok: false, text: (e as { plain?: boolean }).plain ? (e as Error).message : 'Couldn’t read that image.', n: Date.now() }); }
  };
  // The box empties as it's sent, so a second tap on Send can't send the words twice; refused, they come back if it's still empty.
  const put = (t: string) => { setText(t); writeBox(field.current, t); };
  const submit = () => {
    const t = text;
    if (pending && going.current !== pending) sticker(pending, true);
    if (!messageOk(t)) return;
    put('');
    send(async () => sendMessage(await loadCloud(), me, friend.uid, t), 'Sent', () => {
      if (!alive.current) noteUnsent(key, { text: t }); else if (!readBox(field.current)) put(t);
    });
  };
  // What a send left when its sheet closed before it failed: back in the box, with why.
  useEffect(() => {
    const restore = () => {
      const u = unsent.get(key);
      if (!u) return;
      unsent.delete(key);
      if (u.sticker) setPending((p) => p ?? u.sticker!);
      if (u.text && !readBox(field.current)) put(u.text);
      if (u.why) setMsg({ ok: false, text: u.why, n: Date.now() });
    };
    restore();
    openThreads.set(key, restore);
    return () => { if (openThreads.get(key) === restore) openThreads.delete(key); };
  }, [key]);
  const act = async (f: () => Promise<void>, after: () => void) => {
    setBusy(true); setMsg(null);
    try { await f(); changed.current(); after(); } catch (e) { setMsg({ ok: false, text: cloudError(e) }); } finally { setBusy(false); }
  };
  const mute = () => {
    if (!state) return;
    const next = !state.muted;
    void act(async () => setMuted(await loadCloud(), me, friend.uid, next), () => { setState({ ...state, muted: next }); setMsg({ ok: true, text: next ? `Muted. ${who} won’t ring your phone; their messages still come in here.` : `${who} can ring your phone again.` }); });
  };
  const gymRow = (id: string) => sentGyms.find((g) => g.id === id);
  /** The sticker button: the drawer up in the keyboard's place (the keyboard goes down for it), or folded away again. */
  const toggleDrawer = () => {
    if (drawer) { setDrawer(false); setRowRank(null); return; }
    if (field.current && document.activeElement === field.current) field.current.blur();
    setDrawer(true);
  };
  // A tap in the box brings the keyboard back up in the drawer's place.
  const typing = () => { if (drawer) { setDrawer(false); setRowRank(null); } };
  const favourite = (src: string, on: boolean) => void setFavourite(me, src, on).then(
    () => setMsg({ ok: true, text: on ? 'Added to your favourites.' : 'Taken out of your favourites.', fades: true, n: Date.now() }),
    () => setMsg({ ok: false, text: 'Couldn’t keep that on this phone. Try again.', n: Date.now() }));
  const n = text.length, can = state?.friend !== false;
  const line = msg && <p key={msg.n} role={msg.ok ? 'status' : 'alert'} className={msg.ok ? `ok small${msg.fades ? ' fades' : ''}` : 'warn small'}>{msg.text}</p>;

  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section ref={box} className="sheet thread-sheet" role="dialog" aria-modal="true" aria-label={`Messages with ${who}`}>
        <header className="sheet-head">
          <span className="avatar" aria-hidden="true">{initials(dn || name || '?')}</span>
          <h2>{name ? <FriendName me={me} friend={{ uid: friend.uid, name, dn }} /> : who}</h2>
          {state?.friend && (
            <button className="mini icon" aria-pressed={state.muted} aria-label={state.muted ? `Unmute ${who}` : `Mute ${who}`} disabled={busy} onClick={mute}><Icon name={state.muted ? 'bell-off' : 'bell'} /></button>
          )}
          <button className="mini icon" aria-label="More" aria-expanded={menu} onClick={() => { setMenu(!menu); arm(null); }}><Icon name="more" /></button>
          <button className="mini icon" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </header>
        {menu && (
          <div className="sheet-menu" role="group" aria-label={`${who} options`}>
            {state?.friend && <button className="mini" onClick={() => onViewLog({ uid: friend.uid, name })}>View log</button>}
            {state?.friend && (
              <button className="mini" disabled={busy} aria-disabled={settling('remove')} onClick={() => tap('remove',
                () => void act(async () => removeFriend(await loadCloud(), me, friend.uid), () => { setState({ friend: false, muted: false }); setMenu(false); setMsg({ ok: true, text: `Removed ${who}. Neither of you can see the other’s log now.` }); }))}>{armed === 'remove' ? 'Tap again to remove' : 'Remove'}</button>
            )}
            <button className="mini danger" disabled={busy} aria-disabled={settling('block')} onClick={() => tap('block',
              () => void act(async () => blockFriend(await loadCloud(), me, friend.uid), () => {
                setState({ friend: false, muted: false }); setEmpty(true); setMenu(false);
                void patchFriendCache(me, (x) => { const { [friend.uid]: _gone, ...threads } = x.threads; return { ...x, threads }; }); setMsg({ ok: true, text: `Blocked ${who}. They can’t ask to be friends or message you. Unblock under Friends.` }); }))}>{armed === 'block' ? 'Tap again to block' : 'Block'}</button>
          </div>
        )}
        {menu && state?.friend && name && <FriendTagEditor me={me} friend={{ uid: friend.uid, name }} />}
        <ol ref={list} className="thread" aria-label="Messages">
          {items == null ? <li className="muted small">Loading…</li>
            : !items.length ? <li className="muted small thread-empty">{can ? `Nothing yet. Send ${who} a ping.` : 'Nothing here.'}</li>
            : items.map((i) => {
              const g = i.kind === 'gym' ? gymRow(i.id) : undefined;
              return (
                <li key={i.id} className={`bubble ${i.mine ? 'mine' : 'theirs'}${i.kind === 'p' ? ' ping' : i.sticker ? ' sticker' : ''}`}>
                  {g ? (<>
                    <span>Sent you a gym: <b>{g.gym.name}</b></span>
                    <span className="bubble-actions">
                      <button className="mini primary" disabled={busy} onClick={() => void act(async () => {
                        const copy = copyGym(g.gym, gyms.gyms);
                        if (!(await gyms.save([...gyms.gyms, copy], gyms.active?.id ?? copy.id))) throw new Error('Saving the gym on this phone failed.');
                        await clearSentGym(await loadCloud(), me, g.id);
                      }, () => { setMsg({ ok: true, text: `Added ${g.gym.name} to your gyms.` }); void load(); })}>Add</button>
                      <button className="mini" disabled={busy} onClick={() => void act(async () => clearSentGym(await loadCloud(), me, g.id), () => void load())}>Dismiss</button>
                    </span>
                  </>) : i.sticker ? (<>
                    <button type="button" className="sticker-hit" aria-expanded={picked === i.id} onClick={() => setPicked((p) => (p === i.id ? null : i.id))} onContextMenu={(e) => e.preventDefault()}>
                      <img className="sticker-img" src={i.sticker} alt="Sticker" draggable={false} />
                    </button>
                    {picked === i.id && (() => {
                      const id = stickerId(i.sticker), on = !!lib?.some((x) => x.id === id && x.fav != null);
                      return (
                        <span className="bubble-actions">
                          <button type="button" className="mini sticker-fav" aria-pressed={on} onClick={() => favourite(i.sticker!, !on)}><Icon name={on ? 'star-on' : 'star'} size={18} />Favourite</button>
                        </span>
                      );
                    })()}
                  </>) : <span className="bubble-text">{i.text}</span>}
                  <time className="muted" dateTime={new Date(i.at).toISOString()}>{shortAgo(i.at, Date.now())}</time>
                </li>
              );
            })}
        </ol>
        {can ? (<>
          {!drawer && recent.length > 0 && (
            <div className="recent-stickers" role="group" aria-label="Recent stickers">
              {recent.map((st, k) => (
                <button key={st.id} className="recent-sticker" disabled={!state} aria-label={`Send sticker ${k + 1}${st.fav != null ? ', a favourite' : ''}`} onClick={() => sticker(st.src)} onContextMenu={(e) => e.preventDefault()}>
                  <img src={st.src} alt="" draggable={false} />
                  {st.fav != null && <span className="sd-star" aria-hidden="true"><Icon name="star-on" size={12} sw={1.5} /></span>}
                </button>
              ))}
            </div>
          )}
          <div className="presets" role="group" aria-label="Quick pings">
            {PRESET_KEYS.map((k) => (
              <button key={k} className="preset" disabled={!state} aria-label={`Send ${PRESETS[k].emoji} ${PRESETS[k].copy}`} title={PRESETS[k].copy} onClick={() => ping(k)}>{PRESETS[k].emoji}</button>
            ))}
          </div>
          {/* Enter is a new line (a message can have several); Send sends, and so does Cmd or Ctrl+Enter on a keyboard. */}
          <form className="compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <button type="button" className="mini icon add-sticker" aria-label="Stickers" aria-expanded={drawer} aria-controls={drawerId} disabled={!state} onClick={toggleDrawer}><Icon name="sticker" /></button>
            {pending && (
              <span className="compose-sticker" aria-busy={pending === outgoing}>
                <img src={pending} alt="Sticker to send" draggable={false} />
                <button type="button" className="remove" aria-label="Remove the sticker" onClick={() => setPending(null)}><Icon name="close" size={14} sw={2.5} /></button>
              </span>
            )}
            <MessageBox ref={field} label={`Message ${who}`} placeholder="Message" max={MAX_MESSAGE} empty={!text} onText={setText}
              onFile={(f) => void take(makeSticker(f))} onImage={(urls, el) => void take(stickerFromElement(urls, el))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} onFocus={typing} />
            <span className="compose-side">
              <span className={`small ${n >= MAX_MESSAGE ? 'warn' : 'muted'}`} aria-live="polite">{n > COUNT_FROM ? `${n}/${MAX_MESSAGE}` : ''}</span>
              <button type="submit" className="mini primary send" aria-label="Send" disabled={!state || (!messageOk(text) && (!pending || pending === outgoing))}><Icon name="send" size={22} sw={2.25} /></button>
            </span>
          </form>
          {/* Its line goes above the drawer, so a send's "Sent" never moves the sticker under the finger. */}
          {drawer && line}
          {drawer && <StickerDrawer id={drawerId} uid={me} disabled={!state} onSend={(st) => sticker(st)} onNote={(ok, text) => setMsg({ ok, text, n: Date.now() })} />}
        </>) : state && <p className="muted small">You’re not friends with {who} now, so you can’t message them.</p>}
        {!(can && drawer) && line}
      </section>
    </>
  );
}
