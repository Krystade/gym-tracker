import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { restAlertState, restPush, subscribeRestAlert } from '../push/client';
import { PUSH_ON } from '../push/config';
import { Icon } from './icons';

// One rest at a time, kept outside the screens so leaving Today and coming back doesn't lose it. `card`: the lift's card.
// `label`: what the lock-screen alert says ("Bench Press · set 4 next"), where push notifications are on.
/** `total`: the whole rest in ms, +30 s included, for the bar's progress line. */
interface Rest { until: number; card: string; label?: string; total?: number }
let rest: Rest | null = null;
const subs = new Set<() => void>();
const set = (r: Rest | null) => { rest = r; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A rest that changes when it ends also changes when the lock-screen alert goes out (or that it doesn't). */
const setRest = (r: Rest | null) => { set(r); restPush(r ? r.until : null, r?.label); };

/** Starts (or starts over) the rest after a set. */
export const startRest = (seconds: number, card: string, label?: string) => setRest({ until: Date.now() + seconds * 1000, card, label, total: seconds * 1000 });

/** How long "Rest done" stays up before the bar goes. */
const DONE_FOR = 30_000;
const mss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The rest between sets: a bar above the tabs counting down, silent (logging happens with music on). A tap puts it away,
 * +30 s adds time. While it runs the screen stays on, where the Wake Lock API is there.
 */
export function RestTimer() {
  const r = useSyncExternalStore(subscribe, () => rest);
  const alert = useSyncExternalStore(subscribeRestAlert, restAlertState);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!r) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [r]);
  const left = r ? Math.max(0, Math.ceil((r.until - now) / 1000)) : 0;
  const gone = !r || now >= r.until + DONE_FOR;
  useEffect(() => { if (r && gone) set(null); }, [r, gone]);
  const running = !gone && left > 0;

  useEffect(() => {
    if (!running) return;
    let lock: WakeLockSentinel | null = null, alive = true;
    const take = async () => {
      try {
        const l = await navigator.wakeLock?.request('screen');
        if (alive) lock = l ?? null; else void l?.release();
      } catch { /* not allowed here: the timer runs anyway */ }
    };
    void take();
    // A hidden page loses its lock; take it again on the way back.
    const onVis = () => { if (document.visibilityState === 'visible') void take(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, [running]);

  // Room under the page for the bar, so nothing has to stay under it.
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current, root = document.documentElement;
    if (!el) return;
    root.style.setProperty('--rest-h', `${el.offsetHeight + 8}px`);
    return () => { root.style.removeProperty('--rest-h'); };
  }, [gone]);
  // A new rest: the form just used stays clear of the bar.
  useEffect(() => {
    if (!r) return;
    const form = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(r.card)}"] .set-form`);
    const top = bar.current?.getBoundingClientRect().top;
    if (form && top != null && form.getBoundingClientRect().bottom > top) form.scrollIntoView({ block: 'nearest' });
  }, [r?.until, r?.card]);

  if (gone) return null;
  return (
    <div ref={bar} className={left > 0 ? 'rest-timer' : 'rest-timer done'} role="timer" aria-label="Rest">
      {left > 0 && r?.total && <i className="rest-progress" aria-hidden="true" style={{ '--p': Math.min(1, (r.until - now) / r.total) } as CSSProperties} />}
      <button type="button" className="rest-main" aria-label="Dismiss rest timer" onClick={() => setRest(null)}>
        <Icon name="timer" size={22} />
        <b>{mss(left)}</b>
        <span className="rest-words">
          <span>{left > 0 ? 'Rest' : 'Rest done'}</span>
          <span className="muted small">{PUSH_ON && left > 0 && alert === 'failed' ? 'No lock-screen alert' : 'Tap to close'}</span>
        </span>
      </button>
      <button type="button" className="mini" onClick={() => { const until = Math.max(r!.until, Date.now()) + 30_000; setRest({ ...r!, until, total: Math.max(r!.total ?? 0, until - Date.now()) }); }}>+30 s</button>
      <button type="button" className="mini icon" aria-label="Close rest timer" onClick={() => setRest(null)}><Icon name="close" /></button>
    </div>
  );
}
