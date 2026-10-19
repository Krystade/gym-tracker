import { useEffect, useState } from 'react';

// The clock, for what reads it: every minute, and when the app is shown again (a phone asleep runs no timers). Only what
// shows or works from the time listens, so a minute going by doesn't take every screen through a render.
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;
const tick = () => { for (const f of [...listeners]) f(); };

/** Calls `f` every minute and each time the app comes back into view; returns what stops it. */
export function onMinute(f: () => void): () => void {
  listeners.add(f);
  if (!stop) {
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    stop = () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
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
