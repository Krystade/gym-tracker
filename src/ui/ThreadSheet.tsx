import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cloudError, loadCloud } from '../cloud/firebase';
import { blockFriend, clearSentGym, friendState, listThread, markRead, removeFriend, sendMessage, sendPing, setMuted, type SentGym } from '../cloud/friends';
import { MAX_MESSAGE, messageOk, PRESET_KEYS, PRESETS, shortAgo, type PresetKey, type ThreadItem } from '../domain/messages';
import { copyGym } from '../domain/share';
import type { GymsStore } from '../state/useGyms';

/** The friend a thread is with: from a row (name known) or a notification (uid alone). */
export interface ThreadWith { uid: string; name?: string }

const GAP_MS = 2000; // the rules want 2 s between sends to one friend
const COUNT_FROM = 100; // the count shows only once a message nears the limit

/**
 * Pings and messages with one friend, in a sheet from the bottom (never a centred modal: the board stays visible above
 * it). Top to bottom: who, mute and more; the last 20 items; the six pings above the field, so the keyboard can't hide
 * them; a 140-character field. Read once on opening, again when a push arrives or the app comes back, and after a send.
 */
export function ThreadSheet({ me, friend, gyms, onClose, onViewLog, onChanged }: {
  me: string; friend: ThreadWith; gyms: GymsStore; onClose: () => void; onViewLog: (f: { uid: string; name: string }) => void; onChanged: () => void;
}) {
  const [name, setName] = useState(friend.name ?? '');
  const [state, setState] = useState<{ friend: boolean; muted: boolean } | null>(null);
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [sentGyms, setSentGyms] = useState<SentGym[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState<'remove' | 'block' | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // The box grows a line at a time to fit what's typed, up to its CSS max-height; past that it scrolls.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    const border = el.offsetHeight - el.clientHeight, want = el.scrollHeight + border;
    el.style.height = `${want}px`;
    el.style.overflowY = want > parseFloat(getComputedStyle(el).maxHeight) ? 'auto' : 'hidden';
  }, [text]);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async (first = false) => {
    try {
      const c = await loadCloud();
      const [s, t] = await Promise.all([first ? friendState(c, me, friend.uid) : Promise.resolve(null), listThread(c, me, friend.uid)]);
      if (s) { setName(s.name); setState({ friend: s.friend, muted: s.muted }); }
      setItems(t.items); setSentGyms(t.gyms);
      // Everything they sent is read now; the dots and the badge follow.
      if (!s || s.friend) await markRead(c, me, friend.uid).catch(() => {});
      changed.current();
    } catch (e) { setMsg({ ok: false, text: cloudError(e) }); setItems((x) => x ?? []); }
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

  const who = name ? `@${name}` : 'them';
  /** One send at a time, and the buttons rest for the rules' 2 s after it. */
  const send = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true); setMsg(null);
    const t0 = Date.now();
    try { await f(); setMsg({ ok: true, text: done }); await load(); }
    catch (e) { setMsg({ ok: false, text: (e as { plain?: boolean }).plain ? (e as Error).message : 'Couldn’t send.' }); }
    finally { setTimeout(() => setBusy(false), Math.max(0, GAP_MS - (Date.now() - t0))); }
  };
  const ping = (k: PresetKey) => void send(async () => sendPing(await loadCloud(), me, friend.uid, k), `Sent ${PRESETS[k].emoji}`);
  const submit = () => { const t = text; if (messageOk(t)) void send(async () => { await sendMessage(await loadCloud(), me, friend.uid, t); setText(''); }, 'Sent'); };
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
      <section className="sheet thread-sheet" role="dialog" aria-modal="true" aria-label={`Messages with ${who}`}>
        <header className="sheet-head">
          <h2>{who}</h2>
          {state?.friend && (
            <button className="mini icon" aria-pressed={state.muted} aria-label={state.muted ? `Unmute ${who}` : `Mute ${who}`} disabled={busy} onClick={mute}>{state.muted ? '🔕' : '🔔'}</button>
          )}
          <button className="mini icon" aria-label="More" aria-expanded={menu} onClick={() => { setMenu(!menu); setArmed(null); }}>⋯</button>
          <button className="mini icon" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        {menu && (
          <div className="sheet-menu" role="group" aria-label={`${who} options`}>
            {state?.friend && <button className="mini" onClick={() => onViewLog({ uid: friend.uid, name })}>View log</button>}
            {state?.friend && (
              <button className="mini" disabled={busy} onClick={() => (armed === 'remove'
                ? void act(async () => removeFriend(await loadCloud(), me, friend.uid), () => { setState({ friend: false, muted: false }); setMenu(false); setMsg({ ok: true, text: `Removed ${who}. Neither of you can see the other’s log now.` }); })
                : setArmed('remove'))}>{armed === 'remove' ? 'Tap again to remove' : 'Remove'}</button>
            )}
            <button className="mini danger" disabled={busy} onClick={() => (armed === 'block'
              ? void act(async () => blockFriend(await loadCloud(), me, friend.uid), () => { setState({ friend: false, muted: false }); setItems([]); setMenu(false); setMsg({ ok: true, text: `Blocked ${who}. They can’t ask to be friends or message you. Unblock under Friends.` }); })
              : setArmed('block'))}>{armed === 'block' ? 'Tap again to block' : 'Block'}</button>
          </div>
        )}
        <ol ref={list} className="thread" aria-label="Messages">
          {items == null ? <li className="muted small">Loading…</li>
            : !items.length ? <li className="muted small thread-empty">{can ? `Nothing yet. Send ${who} a ping.` : 'Nothing here.'}</li>
            : items.map((i) => {
              const g = i.kind === 'gym' ? gymRow(i.id) : undefined;
              return (
                <li key={i.id} className={`bubble ${i.mine ? 'mine' : 'theirs'}${i.kind === 'p' ? ' ping' : ''}`}>
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
                  </>) : <span className="bubble-text">{i.text}</span>}
                  <time className="muted" dateTime={new Date(i.at).toISOString()}>{shortAgo(i.at, Date.now())}</time>
                </li>
              );
            })}
        </ol>
        {can ? (<>
          <div className="presets" role="group" aria-label="Quick pings">
            {PRESET_KEYS.map((k) => (
              <button key={k} className="preset" disabled={busy || !state} aria-label={`Send ${PRESETS[k].emoji} ${PRESETS[k].copy}`} title={PRESETS[k].copy} onClick={() => ping(k)}>{PRESETS[k].emoji}</button>
            ))}
          </div>
          {/* Enter is a new line (a message can have several); Send sends, and so does Cmd or Ctrl+Enter on a keyboard. */}
          <form className="compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <textarea ref={field} aria-label={`Message ${who}`} value={text} maxLength={MAX_MESSAGE} rows={1} enterKeyHint="enter" placeholder="Message" autoComplete="off"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} />
            <span className="compose-side">
              <span className={`small ${n >= MAX_MESSAGE ? 'warn' : 'muted'}`} aria-live="polite">{n > COUNT_FROM ? `${n}/${MAX_MESSAGE}` : ''}</span>
              <button type="submit" className="mini primary" disabled={busy || !state || !messageOk(text)}>Send</button>
            </span>
          </form>
        </>) : state && <p className="muted small">You’re not friends with {who} now, so you can’t message them.</p>}
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok small' : 'warn small'}>{msg.text}</p>}
      </section>
    </>
  );
}
