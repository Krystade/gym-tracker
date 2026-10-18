import { useState, useSyncExternalStore } from 'react';

/**
 * A value that changes without rendering whoever made it: only the screens that read it with `useBox` render again. For state
 * kept high in the app that only one corner shows (the sync's status, the news counter), so a change to it doesn't take every
 * screen through a render.
 */
export interface Box<T> { get: () => T; set: (v: T | ((prev: T) => T)) => void; subscribe: (l: () => void) => () => void }

export function box<T>(initial: T): Box<T> {
  let v = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => {
      const next = typeof n === 'function' ? (n as (prev: T) => T)(v) : n;
      if (Object.is(next, v)) return;
      v = next;
      for (const l of listeners) l();
    },
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/** A box for this component's lifetime (made once, like useState). */
export const useOwnBox = <T,>(initial: T): Box<T> => useState(() => box(initial))[0];

/** The box's value, live. */
export const useBox = <T,>(b: Box<T>): T => useSyncExternalStore(b.subscribe, b.get);
