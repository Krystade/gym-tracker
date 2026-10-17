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

/**
 * Keeps the Worker current for the signed-in person: the reminder and recap numbers after the log changes, and the
 * subscription each time the app comes back. Signed out, this phone's subscription goes.
 */
export const usePushSync = PUSH_ON ? function usePushSync(entries: SetEntry[], program: Program | null | undefined, plans: DayPlan[], today: string, signedIn: boolean | null) {
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => { void postActivity(activityOf(entries, program, plans, today)).catch(() => {}); }, 3000);
    return () => clearTimeout(t);
  }, [entries, program, plans, today, signedIn]);
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
/**
 * Where a notification tap wants the app to go: the `#open=` hash it opened with, the service worker's message to a
 * window that was already open, or (for an open that lost the hash, WebKit 263687) the route the tap stored.
 */
export const useOpenRoute = PUSH_ON ? function useOpenRoute(go: (r: Route) => void) {
  const latest = useRef(go);
  latest.current = go;
  useEffect(() => {
    const follow = (r: Route) => { void take('route').catch(() => {}); latest.current(r); };
    const fromHash = () => {
      const r = parseOpen(location.hash);
      if (!r) return false;
      history.replaceState(null, '', location.pathname + location.search);
      follow(r);
      return true;
    };
    const fromStore = async () => {
      const s = await take('route').catch(() => undefined);
      if (s && Date.now() - s.at < FRESH_MS && isRoute(s.route)) latest.current(s.route);
    };
    if (!fromHash()) void fromStore();
    const onHash = () => { fromHash(); };
    const onVis = () => { if (document.visibilityState === 'visible') void fromStore(); };
    const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; route?: unknown }; if (d?.type === 'open' && isRoute(d.route)) follow(d.route); };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onVis);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', onVis); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);
} : () => {};
