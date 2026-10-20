import { useEffect, useState } from 'react';

// The clock, for what reads it: every minute, and when the app is shown again (a phone asleep runs no timers). Only what
// shows or works from the time listens, so a minute going by doesn't take every screen through a render.
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;
let last = 0;
const tick = () => { last = Date.now(); for (const f of [...listeners]) f(); };
// An installed app woken on iOS may send no event and run no timer for a while (owner, 2026-10-19: Monday morning still
// showed Sunday's week until he logged something). A tap with no tick for a minute is the clock's cue, ahead of the tap.
const onTap = () => { if (Date.now() - last >= 60_000) tick(); };
const opts = { capture: true, passive: true } as const;

/** Calls `f` every minute, each time the app comes back into view, and at the first tap after a minute with no tick; returns what stops it. */
export function onMinute(f: () => void): () => void {
  listeners.add(f);
  if (!stop) {
    last = Date.now();
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    addEventListener('pageshow', tick);
    addEventListener('focus', tick);
    document.addEventListener('pointerdown', onTap, opts);
    stop = () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      removeEventListener('pageshow', tick);
      removeEventListener('focus', tick);
      document.removeEventListener('pointerdown', onTap, opts);
    };
  }
  return () => {
    listeners.delete(f);
    if (!listeners.size) { stop?.(); stop = null; }
  };
}

const minuteNow = () => Math.floor(Date.now() / 60_000);

/** The minute it is, kept current while `on`: a component showing a time ("5m ago", "later than now") renders again as it moves. */
export function useMinute(on = true): number {
  const [m, setM] = useState(minuteNow);
  useEffect(() => {
    if (!on) return;
    setM(minuteNow());
    return onMinute(() => setM(minuteNow()));
  }, [on]);
  return m;
}
