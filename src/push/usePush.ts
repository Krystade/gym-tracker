import { useEffect, useRef } from 'react';
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
 */
export const usePushSync = PUSH_ON ? function usePushSync(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string, signedIn: boolean | null, goal?: number) {
  useEffect(() => {
    if (!signedIn) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const post = () => { clearTimeout(t); t = setTimeout(() => { void postActivity(activityOf(entries, program, plans, today, goal, undefined, rest)).catch(() => {}); }, 3000); };
    post();
    restChanged = post;
    return () => { clearTimeout(t); if (restChanged === post) restChanged = null; };
  }, [entries, program, plans, today, signedIn, goal]);
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
    if (!fromHash()) void fromStore();
    const onHash = () => { fromHash(); };
    const onVis = () => { if (document.visibilityState === 'visible') void fromStore(); else tapShown = false; };
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; route?: unknown }; if (d?.type === 'open' && isRoute(d.route)) follow(d.route); };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVis);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', onVis); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);
} : () => {};
