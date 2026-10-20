import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { RestPart } from '../domain/timing';
import { restAlertState, restPush, subscribeRestAlert } from '../push/client';
import { PUSH_ON } from '../push/config';
import { Icon } from './icons';

// One rest at a time, kept outside the screens so leaving Today and coming back doesn't lose it. `card`: the lift's card.
// `label`: what the lock-screen alert says ("Bench Press · set 4 next"), where push notifications are on.
// `full`: inside a superset, the short switch to the next lift's card stands in for this rest, should it turn out not to be one.
/**
 * `total`: the whole rest (or switch) in ms as it now stands, ±30 s included, for the bar's progress line. `start`: when it began.
 * `keep`: told the rest's new length in seconds when ±30 s changes it, so the lift's next rest starts there (not a switch's).
 * `why`: how the rest came to its length, line by line (domain/timing restFor, switchFor), for the bar's "?"; `tapped`: what
 * ±30 s has moved it by since, in ms.
 */
interface Rest { until: number; card: string; label?: string; total?: number; full?: Rest; start?: number; keep?: (seconds: number) => void; why?: RestPart[]; tapped?: number }
let rest: Rest | null = null;
const subs = new Set<() => void>();
const set = (r: Rest | null) => { rest = r; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A rest that changes when it ends also changes when the lock-screen alert goes out (or that it doesn't). */
const setRest = (r: Rest | null) => { set(r); restPush(r ? r.until : null, r?.label); };

/**
 * Starts (or starts over) the rest after a set; with `full`, a superset's switch instead of that rest. `keep`: where the lift's
 * rest goes once ±30 s changes it (the full rest's, inside a superset). `why`: this rest's (or switch's) lines; `full.why`, the
 * full rest's.
 */
export const startRest = (seconds: number, card: string, label?: string, full?: { seconds: number; card: string; label?: string; why?: RestPart[] }, keep?: (seconds: number) => void, why?: RestPart[]) => {
  const now = Date.now();
  setRest({ until: now + seconds * 1000, card, label, total: seconds * 1000, start: now, why,
    ...(full ? { full: { until: now + full.seconds * 1000, card: full.card, label: full.label, total: full.seconds * 1000, start: now, keep, why: full.why } } : { keep }) });
};
/** The rest running, if any (for tests). */
export const currentRest = () => rest;
/**
 * ±30 s: a later end (from now, once it's done), or an earlier one but never before now. The whole rest as it then stands
 * is the progress line's whole, and the lift keeps it for next time.
 */
export const adjustRest = (ms: number) => {
  const r = rest;
  if (!r) return;
  const now = Date.now(), start = r.start ?? now;
  const until = ms > 0 ? Math.max(r.until, now) + ms : Math.max(now, r.until + ms);
  // What a tap moved the rest by: +30 s as asked (from now, once it's done), −30 s only as far as now.
  setRest({ ...r, until, total: until - start, tapped: (r.tapped ?? 0) + (ms > 0 ? ms : until - r.until) });
  r.keep?.(Math.max(30, Math.round((until - start) / 1000))); // at least 30 s, like a learned rest
};
/**
 * Why the rest is its length, for the bar's "?": its lines, then what ±30 s moved it by (kept for the lift, where it is), and
 * what they come to. Null for a rest started without its lines.
 */
export function restLines(r: Rest): { total: number; parts: RestPart[] } | null {
  if (!r.why) return null;
  const tapped = Math.round((r.tapped ?? 0) / 1000);
  const parts = tapped ? [...r.why, { what: 'Your ±30 s', s: tapped, add: true as const, ...(r.keep && { note: 'kept for this lift' }) }] : r.why;
  return { total: parts.reduce((a, x) => a + x.s, 0), parts };
}
/** "Not a superset": a switch running becomes the full rest it stood in for. */
export const revertSwitch = () => { if (rest?.full) setRest(rest.full); };

/** How long "Rest done" stays up before the bar goes. */
const DONE_FOR = 30_000;
const mss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** A line's seconds: a length as 2:30, a change as +30 s / −1:05. */
const amount = (p: RestPart) => !p.add ? mss(p.s) : `${p.s < 0 ? '−' : '+'}${Math.abs(p.s) < 60 ? `${Math.abs(p.s)} s` : mss(Math.abs(p.s))}`;

/**
 * The rest between sets: a bar above the tabs counting down, silent (logging happens with music on). −30 s and +30 s change
 * it (a tap on the bar itself does nothing: it sits where a thumb lands); only × puts it away. While it runs the screen stays on,
 * where the Wake Lock API is there.
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

  // The "?": why this rest is its length, above the bar. A tap anywhere but on it or the bar's buttons puts it away (and does
  // what it was for); ±30 s leave it up, so the line for them can be seen to change.
  const [why, setWhy] = useState(false);
  const whyId = useId();
  useEffect(() => {
    if (!why) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.rest-why, .rest-timer button')) setWhy(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setWhy(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  }, [why]);
  const lines = r && !gone ? restLines(r) : null;
  const explained = !!lines;
  useEffect(() => { if (!explained) setWhy(false); }, [explained]);

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
  // Under the time: what comes next ("Set 3 next", or the lift to switch to), unless the lock-screen alert couldn't be set.
  const next = r?.label?.startsWith('Switch to ') ? r.label.slice('Switch to '.length) : r?.label?.split(' · ')[1];
  const sub = PUSH_ON && left > 0 && alert === 'failed' ? 'No lock-screen alert' : next && next[0].toUpperCase() + next.slice(1);
  return (
    <div ref={bar} className={left > 0 ? 'rest-timer' : 'rest-timer done'} role="timer" aria-label={what}>
      {left > 0 && r?.total && <i className="rest-progress" aria-hidden="true" style={{ '--p': Math.min(1, (r.until - now) / r.total) } as CSSProperties} />}
      <div className="rest-main">
        {/* The "?" stands where the bar's glyph was: there's no room at 375px for both and the words. */}
        {lines ? (
          <button type="button" className="rest-why-btn" aria-label={`Why this ${what.toLowerCase()} is ${mss(lines.total)}`} aria-expanded={why} aria-controls={why ? whyId : undefined} onClick={() => setWhy(!why)}>
            <Icon name="help" size={22} />
          </button>
        ) : <Icon name={r?.full ? 'switch' : 'timer'} size={22} />}
        <b>{mss(left)}</b>
        <span className="rest-words">
          <span>{left > 0 ? what : `${what} done`}</span>
          {sub && <span className="muted small">{sub}</span>}
        </span>
      </div>
      <button type="button" className="mini" disabled={left <= 0} onClick={() => adjustRest(-30_000)}>−30 s</button>
      <button type="button" className="mini" onClick={() => adjustRest(30_000)}>+30 s</button>
      <button type="button" className="mini icon" aria-label="Close rest timer" onClick={() => setRest(null)}><Icon name="close" /></button>
      {why && lines && (
        <div className="rest-why" id={whyId} role="dialog" aria-label={`Why this ${what.toLowerCase()}`}>
          <div className="rest-why-head">
            <b>Why {mss(lines.total)}</b>
            <button type="button" className="mini icon" aria-label="Close" onClick={() => setWhy(false)}><Icon name="close" size={20} /></button>
          </div>
          <ul>
            {lines.parts.map((p, i) => (
              <li key={i}>
                <span>{p.what}{p.note && <small>{p.note}</small>}</span>
                <b className={p.add ? 'add' : undefined}>{amount(p)}</b>
              </li>
            ))}
            {lines.parts.length > 1 && <li className="rest-why-total"><span>{r?.full ? 'Switch' : 'Rest'}</span><b>{mss(lines.total)}</b></li>}
          </ul>
        </div>
      )}
    </div>
  );
}
