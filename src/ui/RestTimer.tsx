import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { RestPart } from '../domain/timing';
import { restAlertState, restPush, subscribeRestAlert } from '../push/client';
import { PUSH_ON } from '../push/config';
import { Icon } from './icons';
import { NEXT } from '../domain/upNext';

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
/**
 * After the plan's last set (owner, 2026-10-20: "a set timer still starts after my last one"): no rest, and in the bar's place
 * Finish and Keep going. `finish`: what Finish does; `resume`: the rest held back, which Keep going starts.
 */
interface Offer { finish: () => void; resume?: () => void }
let offer: Offer | null = null;
const subs = new Set<() => void>();
const set = (r: Rest | null) => { rest = r; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** A rest that changes when it ends also changes when the lock-screen alert goes out (or that it doesn't). */
const setRest = (r: Rest | null) => { set(r); restPush(r ? r.until : null, r?.label); };

/**
 * Starts (or starts over) the rest after a set; with `full`, a superset's switch instead of that rest. `keep`: where the lift's
 * rest goes once ±30 s changes it (the full rest's, inside a superset). `why`: this rest's (or switch's) lines; `full.why`, the
 * full rest's. `from`: when it began (epoch ms), if before now: a rest held back by the Finish bar runs from its set.
 */
export const startRest = (seconds: number, card: string, label?: string, full?: { seconds: number; card: string; label?: string; why?: RestPart[] }, keep?: (seconds: number) => void, why?: RestPart[], from?: number) => {
  const now = from ?? Date.now();
  offer = null;
  setRest({ until: now + seconds * 1000, card, label, total: seconds * 1000, start: now, why,
    ...(full ? { full: { until: now + full.seconds * 1000, card: full.card, label: full.label, total: full.seconds * 1000, start: now, keep, why: full.why } } : { keep }) });
};
/** The rest running, if any (for tests). */
export const currentRest = () => rest;
/** The plan's last set is in: the rest before it ends (its alert called off) and none starts; Finish and Keep going show instead. */
export const offerFinish = (o: Offer) => { offer = o; setRest(null); };
/** The Finish bar up, if it is (for tests). */
export const currentOffer = () => offer;
/** Keep going: the bar goes, and the rest it held back starts. */
export const keepGoing = () => { const o = offer; offer = null; set(rest); o?.resume?.(); };
/** Finish: the bar goes, and the session is finished. */
export const finishNow = () => { const o = offer; offer = null; set(rest); o?.finish(); };
/** The session closed: the bar and any rest go, and the rest's lock-screen alert is called off (nothing to call off, nothing sent). */
export const closeTimers = () => { if (!rest && !offer) return; offer = null; setRest(null); };

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
  r.keep?.(Math.max(30, Math.round((until - start) / 1000))); // at least 30 s
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

/**
 * What the bar says comes next, from the rest's label (domain/upNext): `sub`, under "Rest", for this lift's next set or the plan
 * done; `row`, a line of its own, for another lift (the plan's next, a superset's other lift or its next round).
 */
export function nextOf(label: string | undefined, card: string | undefined): { sub?: string; row?: string } {
  if (!label) return {};
  if (label.startsWith('Switch to ')) return { row: label.slice('Switch to '.length) };
  if (label.startsWith(NEXT)) return { row: label.slice(NEXT.length) };
  const m = / · set (\d+) next$/.exec(label);
  if (!m) return { sub: label };
  const lift = label.slice(0, m.index);
  return lift.toLowerCase() === card?.toLowerCase() ? { sub: `Set ${m[1]} next` } : { row: `${lift} · set ${m[1]}` };
}

/** The screen is kept on for the rest's last 15 s only (battery audit, 2026-10-23: it was the whole rest). */
const HOLD_MS = 15_000;
/** How long "Rest done" stays up before the bar goes. */
const DONE_FOR = 30_000;
const mss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** A line's seconds: a length as 2:30, a change as +30 s / −1:05. */
const amount = (p: RestPart) => !p.add ? mss(p.s) : `${p.s < 0 ? '−' : '+'}${Math.abs(p.s) < 60 ? `${Math.abs(p.s)} s` : mss(Math.abs(p.s))}`;

/**
 * The rest between sets: a bar above the tabs counting down, silent (logging happens with music on). −30 s and +30 s change
 * it (a tap on the bar itself does nothing: it sits where a thumb lands); only × puts it away. In its last 15 s the screen stays on,
 * where the Wake Lock API is there.
 */
export function RestTimer() {
  const r = useSyncExternalStore(subscribe, () => rest);
  const ask = useSyncExternalStore(subscribe, () => offer);
  const alert = useSyncExternalStore(subscribeRestAlert, restAlertState);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!r) return;
    // Ticking only while it can be seen: hidden, nothing is drawn (battery audit, 2026-10-23: 4 renders a second went on in
    // the background); back in view it reads the clock at once, so the time shown is never stale. Once a second, as the
    // seconds turn over (the progress line moves with the digits; it was 4 times a second).
    const until = r.until;
    let id = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const ms = (until - t) % 1000; // to the next whole second of the countdown (past the end, of the time since)
      id = window.setTimeout(tick, (ms > 0 ? ms : 1000 + ms) + 5);
    };
    const run = () => {
      clearTimeout(id); id = 0;
      if (document.visibilityState !== 'hidden') tick();
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => { clearTimeout(id); document.removeEventListener('visibilitychange', run); };
  }, [r]);
  const left = r ? Math.max(0, Math.ceil((r.until - now) / 1000)) : 0;
  const gone = !r || now >= r.until + DONE_FOR;
  useEffect(() => { if (r && gone) set(null); }, [r, gone]);
  const running = !gone && left > 0;
  // The Finish bar stands in the rest's place: with no rest, it's up while offered.
  const finishing = gone && !!ask;

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

  const until = r?.until;
  useEffect(() => {
    if (!running || until == null) return;
    let lock: WakeLockSentinel | null = null, alive = true, at = 0;
    const near = () => until - Date.now() <= HOLD_MS;
    const take = async (keep: boolean) => {
      try {
        const l = await navigator.wakeLock?.request('screen');
        if (alive && keep) { void lock?.release().catch(() => {}); lock = l ?? null; } else void l?.release().catch(() => {});
      } catch { /* not allowed here: the timer runs anyway */ }
    };
    // WebKit grants a wake lock only in a tap, then for the rest of the page's life (WebKit 263382@main): this request, made
    // in the tap that started or moved the rest, is what lets the one 15 s before the end through with no tap. Until then
    // it's let go at once, and the screen sleeps as iOS decides (with Attention Aware on, never while it's looked at).
    void take(near());
    if (!near()) at = window.setTimeout(() => void take(true), until - HOLD_MS - Date.now());
    // A hidden page loses its lock; take it again on the way back, in the last 15 s.
    const onVis = () => { if (document.visibilityState === 'visible' && near()) void take(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearTimeout(at); document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, [running, until]);

  // Room under the page for the bar, so nothing has to stay under it (taller with a line for the next lift).
  const { sub: then, row } = nextOf(r?.label, r?.card);
  const bar = useRef<HTMLDivElement>(null);
  // Measured with the old room still there: taking it away first, even for a moment, let a page scrolled to its end clamp up.
  useLayoutEffect(() => {
    const el = bar.current, root = document.documentElement;
    if (el) root.style.setProperty('--rest-h', `${el.offsetHeight + 8}px`);
    else root.style.removeProperty('--rest-h');
  }, [gone, finishing, row]);
  useLayoutEffect(() => () => { document.documentElement.style.removeProperty('--rest-h'); }, []);
  // A new rest: the form just used stays clear of the bar.
  useEffect(() => {
    if (!r) return;
    const form = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(r.card)}"] .set-form`);
    const top = bar.current?.getBoundingClientRect().top;
    if (form && top != null && form.getBoundingClientRect().bottom > top) form.scrollIntoView({ block: 'nearest' });
  }, [r?.until, r?.card]);

  if (finishing) return (
    // Slim, and nothing happens if it's left alone: the session closes by itself once it has gone quiet (TodayScreen).
    <div ref={bar} className="rest-timer finish-bar" role="group" aria-label="Plan done">
      <p className="rest-main"><Icon name="check" size={22} sw={2.5} /><span className="rest-words"><span>Plan done</span><span className="muted small">No rest timer</span></span></p>
      <button type="button" className="mini" onClick={keepGoing}>Keep going</button>
      <button type="button" className="mini primary" onClick={finishNow}>Finish</button>
    </div>
  );
  if (gone) return null;
  const what = r?.full ? 'Switch' : 'Rest';
  // Under the time: this lift's next set ("Set 3 next") or "Plan done", unless the lock-screen alert couldn't be set.
  const sub = PUSH_ON && left > 0 && alert === 'failed' ? 'No lock-screen alert' : then;
  return (
    <div ref={bar} className={`rest-timer${left > 0 ? '' : ' done'}${row ? ' has-next' : ''}`} role="timer" aria-label={what}>
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
      {/* Done, there's nothing to take off: its room goes to the words ("Rest done" was cut to "Rest d…" at 375px). */}
      {left > 0 && <button type="button" className="mini" onClick={() => adjustRest(-30_000)}>−30 s</button>}
      <button type="button" className="mini" onClick={() => adjustRest(30_000)}>+30 s</button>
      <button type="button" className="mini icon" aria-label="Close rest timer" onClick={() => setRest(null)}><Icon name="close" /></button>
      {/* Another lift next: a line of its own the width of the bar, as its name won't fit beside the time and buttons. */}
      {row && <p className="rest-next small"><span className="muted">Next</span> <b>{row}</b></p>}
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
