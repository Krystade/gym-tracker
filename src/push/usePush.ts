import { useEffect, useRef } from 'react';
import { weekCount, type Achievements } from '../domain/achievements';
import type { DayPlan, Program } from '../domain/program';
import type { SetEntry } from '../domain/types';
import { activityOf } from './activity';
import { forgetDevice, postActivity, resyncPush } from './client';
import { PUSH_ON } from './config';
import type { Route } from './payload';
import { isRoute, parseOpen } from './routes';
import { take } from './store';

// Both hooks are no-ops in a build without a Worker, so the bundle carries none of this.

/** The week plan's rest dates as Today last read them (readiness S5: restDatesOf), and the sync to tell when they change. */
let rest: readonly string[] | undefined;
let restChanged: (() => void) | null = null;
/**
 * From Today: the plan's rest dates for the reminder (owner Q6). Held here, not in React state, so a plan read again after a sync
 * renders nothing (e2e/inputs); a change posts the activity again, debounced as any other.
 */
export function setRestDates(dates: readonly string[] | undefined): void {
  if (!PUSH_ON || (rest?.join() === dates?.join() && !rest === !dates)) return;
  rest = dates;
  restChanged?.();
}

/**
 * Keeps the Worker current for the signed-in person: the reminder and recap numbers after the log changes (and the week plan's
 * rest dates, from Today: setRestDates), and the subscription each time the app comes back. Signed out, this phone's subscription goes.
 * `ach`: this person's achievements on a log (useAchievements): the week's count for the recap, worked out in the debounce.
 */
export const usePushSync = PUSH_ON ? function usePushSync(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string, signedIn: boolean | null, goal?: number,
  ach?: ((entries: SetEntry[], today: string) => Achievements) | null) {
  useEffect(() => {
    if (!signedIn) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const post = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        let n: number | undefined;
        try { n = ach ? weekCount(ach(entries, today), today) : undefined; } catch { /* a count beside the recap: never a reason not to post */ }
        void postActivity(activityOf(entries, program, plans, today, goal, undefined, rest, n)).catch(() => {});
      }, 3000);
    };
    post();
    restChanged = post;
    return () => { clearTimeout(t); if (restChanged === post) restChanged = null; };
  }, [entries, program, plans, today, signedIn, goal, ach]);
  useEffect(() => {
    if (signedIn === false) { void forgetDevice(); return; }
    if (!signedIn) return;
    const on = () => { if (document.visibilityState === 'visible') void resyncPush().catch(() => {}); };
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [signedIn]);
} : () => {};

const FRESH_MS = 2 * 60_000;
/** A tap's screen is up, and the app hasn't been in the background since. */
let tapShown = false;
/**
 * For main.tsx: a deploy's reload waits until the app is next in the background rather than close what a tap just
 * opened. Coming back to the front is when the app looks for a deploy, which is just when a tap brings it there.
 */
export const tapShowing = () => tapShown;

/**
 * Where a notification tap wants the app to go: the `#open=` hash it opened with, the service worker's message to a
 * window that was already open, or (for an open that lost the hash, WebKit 263687) the route the tap stored.
 */
export const useOpenRoute = PUSH_ON ? function useOpenRoute(go: (r: Route) => void) {
  const latest = useRef(go);
  latest.current = go;
  useEffect(() => {
    const show = (r: Route) => { tapShown = true; latest.current(r); };
    const follow = (r: Route) => { void take('route').catch(() => {}); show(r); };
    const fromHash = () => {
      const r = parseOpen(location.hash);
      if (!r) return false;
      history.replaceState(null, '', location.pathname + location.search);
      follow(r);
      return true;
    };
    const fromStore = async () => {
      const s = await take('route').catch(() => undefined);
      if (s && Date.now() - s.at < FRESH_MS && isRoute(s.route)) show(s.route);
    };
    // Coming back: iOS brings the app up for a tap before the service worker's notificationclick stores the route (and its
    // message can be lost to a page that was suspended), so look again for a few seconds, not only the moment it shows.
    let looks: number[] = [];
    const resume = () => {
      looks.forEach(clearTimeout);
      looks = [0, 400, 1200, 2500, 5000].map((ms) => window.setTimeout(() => { if (document.visibilityState === 'visible') void fromStore(); }, ms));
    };
    if (!fromHash()) resume();
    const onHash = () => { fromHash(); };
    const onVis = () => { if (document.visibilityState === 'visible') resume(); else { tapShown = false; looks.forEach(clearTimeout); } };
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; route?: unknown }; if (d?.type === 'open' && isRoute(d.route)) follow(d.route); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', onVis);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => {
      looks.forEach(clearTimeout);
      window.removeEventListener('hashchange', onHash); window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', onVis); navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, []);
} : () => {};
