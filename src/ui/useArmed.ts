import { useEffect, useRef, useState } from 'react';

/**
 * A destructive button's "Tap again to …": the first tap arms it, a second confirms. Two quick taps are one double-tap, not a
 * yes (owner's 13 mini, 2026-11-12: double taps came in where they shouldn't), so for ARM_MS after arming the button is inert:
 * aria-disabled, which VoiceOver reads and a test's click waits out, without the dimming a real `disabled` would flash.
 */
export const ARM_MS = 400;
export function useArmed<K extends string>() {
  const [armed, setArmed] = useState<K | null>(null);
  const [ready, setReady] = useState(true);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const arm = (k: K | null) => {
    setArmed(k);
    clearTimeout(timer.current);
    setReady(!k);
    if (k) timer.current = window.setTimeout(() => setReady(true), ARM_MS);
  };
  /** A tap on `k`'s button: arms it, or confirms it once it's been armed a moment. */
  const tap = (k: K, go: () => void) => { if (armed !== k) arm(k); else if (ready) go(); };
  /** The armed button's aria-disabled while a second tap would be the same double-tap. */
  const settling = (k: K) => (armed === k && !ready) || undefined;
  return { armed, arm, tap, settling };
}
