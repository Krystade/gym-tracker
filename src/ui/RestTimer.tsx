import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { restAlertState, restPush, subscribeRestAlert } from '../push/client';
import { PUSH_ON } from '../push/config';

// One rest at a time, kept outside the screens so leaving Today and coming back doesn't lose it. `card`: the lift's card.
// `label`: what the lock-screen alert says ("Bench Press · set 4 next"), where push notifications are on.
// `full`: inside a superset, the short switch to the next lift's card stands in for this rest, should it turn out not to be one.
interface Rest { until: number; card: string; label?: string; full?: Rest }
let rest: Rest | null = null;
const subs = new Set<() => void>();
const set = (r: Rest | null) => { rest = r; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A rest that changes when it ends also changes when the lock-screen alert goes out (or that it doesn't). */
const setRest = (r: Rest | null) => { set(r); restPush(r ? r.until : null, r?.label); };

/** Starts (or starts over) the rest after a set; with `full`, a superset's switch instead of that rest. */
export const startRest = (seconds: number, card: string, label?: string, full?: { seconds: number; card: string; label?: string }) => {
  const now = Date.now();
  setRest({ until: now + seconds * 1000, card, label, ...(full && { full: { until: now + full.seconds * 1000, card: full.card, label: full.label } }) });
};
/** "Not a superset": a switch running becomes the full rest it stood in for. */
export const revertSwitch = () => { if (rest?.full) setRest(rest.full); };

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
  const what = r?.full ? 'Switch' : 'Rest';
  return (
    <div ref={bar} className={left > 0 ? 'rest-timer' : 'rest-timer done'} role="timer" aria-label={what}>
      <button type="button" className="rest-main" aria-label="Dismiss rest timer" onClick={() => setRest(null)}>
        {left > 0 ? <><span>{what}</span><b>{mss(left)}</b></> : <b>{what} done</b>}
        <span className="muted small">{PUSH_ON && left > 0 && alert === 'failed' ? 'No lock-screen alert' : 'Tap to close'}</span>
      </button>
      <button type="button" className="mini" onClick={() => setRest({ ...r!, until: Math.max(r!.until, Date.now()) + 30_000 })}>+30 s</button>
    </div>
  );
}
