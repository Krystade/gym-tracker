import { useCallback, useEffect, useRef, useState } from 'react';
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
import { withRecent } from '../domain/sticker';
import { getRecentStickers, putRecentStickers } from '../db/db';

/** The friend a thread is with: from a row (name known) or a notification (uid alone). */
export interface ThreadWith { uid: string; name?: string }

const COUNT_FROM = 100; // the count shows only once a message nears the limit

/**
 * Pings and messages with one friend, in a sheet from the bottom (never a centred modal: the board stays visible above
 * it). Top to bottom: who, mute and more; the last 20 items; the six pings above the field, so the keyboard can't hide
 * them; a 140-character field. Shows at once what the phone kept of the thread (state/friendCache); read again on opening,
 * when a push arrives or the app comes back, and after a run of sends. A ping tapped again and again sends every tap (owner,
 * 2026-11-12: 👀 over and over): nothing waits or locks between them; they go one after another, as fast as they're taken,
 * and only your day's 300 (socialRate) stops them, with a line saying so.
 *
 * Stickers (owner, 2026-11-12: "like iOS stickers in Messages"): one pasted into the box, or picked with the sticker button,
 * waits in the box until Send (nothing goes by mistake); the row of the last 12 sent from this profile sends at a tap, as a ping does.
 * The box is a contenteditable (ui/MessageBox) so iOS's emoji keyboard offers its Stickers, Memoji and Genmoji there too: one put
 * in the box the same way becomes the sticker waiting for Send, and the words round it stay as they were.
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
  /**
   * The recent row as shown: as kept when the sheet opened, with any new one sent from the box put first. One resent from the row
   * goes first only in what's kept (`keptRecent`), so the row never moves under a finger tapping it again and again.
   */
  const [recent, setRecent] = useState<string[]>([]);
  const keptRecent = useRef<string[]>([]);
  useEffect(() => { void getRecentStickers().then((l) => { keptRecent.current = l; setRecent(l); }).catch(() => {}); }, []);
  const picker = useRef<HTMLInputElement>(null);
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
  // The newest at the bottom, in view.
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [items]);
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
  const send = (f: () => Promise<unknown>, done: string) => {
    const r = run.current;
    r.waiting++;
    queue.current = queue.current.then(async () => {
      try {
        if (r.stop) return;
        await f();
        r.same = r.last === done ? r.same + 1 : 1;
        r.last = done;
        setMsg({ ok: true, text: r.same > 1 ? `${done} ×${r.same}` : done, fades: true, n: ++r.n });
      } catch (e) {
        r.stop = true;
        const x = e as { plain?: boolean; short?: string; message?: string };
        setMsg({ ok: false, text: x.short ?? (x.plain ? x.message! : 'Couldn’t send.'), n: ++r.n });
      } finally {
        if (!--r.waiting) { run.current = { waiting: 0, stop: false, last: '', same: 0, n: r.n }; void load(); }
      }
    });
  };
  const ping = (k: PresetKey) => void send(async () => sendPing(await loadCloud(), me, friend.uid, k), `Sent ${PRESETS[k].emoji}`);
  const remember = (st: string, show: boolean) => {
    keptRecent.current = withRecent(keptRecent.current, st);
    if (show) setRecent((r) => withRecent(r, st));
    void putRecentStickers(keptRecent.current).catch(() => {});
  };
  const sticker = (st: string, fromBox = false) => send(async () => {
    try { await sendSticker(await loadCloud(), me, friend.uid, st); } catch (e) { if (fromBox) setPending((p) => p ?? st); throw e; }
    remember(st, fromBox);
  }, 'Sent sticker');
  /** An image pasted, picked or put in by the keyboard: made into a sticker, it waits in the box; one that can't be says why. */
  const take = async (made: Promise<string>) => {
    try { setPending(await made); } catch (e) { setMsg({ ok: false, text: (e as { plain?: boolean }).plain ? (e as Error).message : 'Couldn’t read that image.', n: Date.now() }); }
  };
  // The box empties as it's sent, so a second tap on Send can't send the words twice; refused, they come back if it's still empty.
  const put = (t: string) => { setText(t); writeBox(field.current, t); };
  const submit = () => {
    const t = text;
    if (pending) { setPending(null); sticker(pending, true); }
    if (!messageOk(t)) return;
    put('');
    send(async () => {
      try { await sendMessage(await loadCloud(), me, friend.uid, t); } catch (e) { if (!readBox(field.current)) put(t); throw e; }
    }, 'Sent');
  };
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
  const n = text.length, can = state?.friend !== false;

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
                  </>) : i.sticker ? <img className="sticker-img" src={i.sticker} alt="Sticker" draggable={false} onContextMenu={(e) => e.preventDefault()} />
                    : <span className="bubble-text">{i.text}</span>}
                  <time className="muted" dateTime={new Date(i.at).toISOString()}>{shortAgo(i.at, Date.now())}</time>
                </li>
              );
            })}
        </ol>
        {can ? (<>
          {recent.length > 0 && (
            <div className="recent-stickers" role="group" aria-label="Recent stickers">
              {recent.map((st, k) => (
                <button key={st.slice(-24) + k} className="recent-sticker" disabled={!state} aria-label={`Send sticker ${k + 1}`} onClick={() => sticker(st)} onContextMenu={(e) => e.preventDefault()}>
                  <img src={st} alt="" draggable={false} />
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
            <button type="button" className="mini icon add-sticker" aria-label="Add a sticker" disabled={!state} onClick={() => picker.current?.click()}><Icon name="sticker" /></button>
            <input ref={picker} type="file" accept="image/*" hidden aria-hidden="true" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void take(makeSticker(f)); }} />
            {pending && (
              <span className="compose-sticker">
                <img src={pending} alt="Sticker to send" draggable={false} />
                <button type="button" className="remove" aria-label="Remove the sticker" onClick={() => setPending(null)}><Icon name="close" size={14} sw={2.5} /></button>
              </span>
            )}
            <MessageBox ref={field} label={`Message ${who}`} placeholder="Message" max={MAX_MESSAGE} empty={!text} onText={setText}
              onFile={(f) => void take(makeSticker(f))} onImage={(urls, el) => void take(stickerFromElement(urls, el))}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
            <span className="compose-side">
              <span className={`small ${n >= MAX_MESSAGE ? 'warn' : 'muted'}`} aria-live="polite">{n > COUNT_FROM ? `${n}/${MAX_MESSAGE}` : ''}</span>
              <button type="submit" className="mini primary send" aria-label="Send" disabled={!state || (!messageOk(text) && !pending)}><Icon name="send" size={22} sw={2.25} /></button>
            </span>
          </form>
        </>) : state && <p className="muted small">You’re not friends with {who} now, so you can’t message them.</p>}
        {msg && <p key={msg.n} role={msg.ok ? 'status' : 'alert'} className={msg.ok ? `ok small${msg.fades ? ' fades' : ''}` : 'warn small'}>{msg.text}</p>}
      </section>
    </>
  );
}
