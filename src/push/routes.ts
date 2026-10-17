import type { Route } from './payload';

const OPEN = /^#open=(rest|today|recap|friends|friend\.[A-Za-z0-9_-]{1,128})$/;

/** A notification's landing place from a URL hash (`#open=rest`), or null for anything else. */
export function parseOpen(hash: string): Route | null {
  const m = OPEN.exec(hash);
  return m ? (m[1] as Route) : null;
}

/** The same check for a route that came from a message or storage. */
export const isRoute = (v: unknown): v is Route => typeof v === 'string' && parseOpen(`#open=${v}`) != null;

/** Which tab a route opens. The recap opens Today at the week's digest; friend routes open Friends (the thread on top). */
export function tabOf(r: Route): 'today' | 'friends' {
  return r === 'friends' || r.startsWith('friend.') ? 'friends' : 'today';
}
