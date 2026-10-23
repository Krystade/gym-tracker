import { rateNext, type Rate } from '../domain/board';
import { dayEnds, dayId, GLOBAL_PER_DAY, OPEN, SOCIAL_PER_DAY, type LimitId, type Switches } from '../domain/limits';
import { notifyLimit } from '../push/client';
import type { Cloud } from './firebase';

// The writes firestore.rules want beside every social write (r28): your social counter (socialRate/{you}, 300 a day) and the
// app's counter for the day (limits/{day}, 2,000 for everyone), in the same write. And the owner's switches (config/switches).

type Batch = ReturnType<Cloud['F']['writeBatch']>;
const fail = (text: string) => Object.assign(new Error(text), { plain: true });
const millis = (v: unknown) => (v as { toMillis?(): number } | null | undefined)?.toMillis?.();
export const denied = (e: unknown) => (e as { code?: string }).code === 'permission-denied';
const rateOf = (d: Record<string, unknown> | undefined): Rate | null => {
  const at = millis(d?.at), win = millis(d?.win);
  return at != null && win != null && typeof d?.n === 'number' ? { at, win, n: d.n } : null;
};
const until = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * The tries a counted write makes while it's refused: the day as this phone's clock has it, then the other way (near a window's
 * edge), then the app's day one either side (a phone clock hours off: the rules take only the server's day). Then whyRefused.
 */
export const TRIES: readonly (readonly [flip: boolean, dayOff: number])[] = [[false, 0], [true, 0], [false, -1], [false, 1]];
export async function withTries<T>(attempt: (flip: boolean, dayOff: number) => Promise<T>, refused: (e: unknown) => Promise<unknown>): Promise<T> {
  let last: unknown;
  for (const [flip, off] of TRIES) {
    try { return await attempt(flip, off); } catch (e) { if (!denied(e)) throw e; last = e; }
  }
  throw await refused(last);
}

/** The app's counter for the day, up one, in `b`: a post's write, or with your social counter (counted). */
export function countDay({ F, db }: Cloud, b: Batch, now = Date.now()): void {
  b.set(F.doc(db, `limits/${dayId(now)}`), { n: F.increment(1) }, { merge: true });
}

/** The owner's switches, as the app last read them; none: all open. */
export async function readSwitches({ F, db }: Cloud): Promise<Switches> {
  const d = (await F.getDoc(F.doc(db, 'config/switches'))).data();
  return { board: d?.board === true, requests: d?.requests === true, messages: d?.messages === true };
}
/** How many social writes the app has taken today (the owner's Board review). */
export async function readToday({ F, db }: Cloud, now = Date.now()): Promise<number> {
  return ((await F.getDoc(F.doc(db, `limits/${dayId(now)}`))).data()?.n as number | undefined) ?? 0;
}
let seen: { at: number; sw: Switches } | null = null;
/** The switches, read again at most every 5 minutes (or `force`): the board shows "Board closed" from them. */
export async function switchesNow(c: Cloud, force = false, now = Date.now()): Promise<Switches> {
  if (!force && seen && now - seen.at < 300_000) return seen.sw;
  seen = { at: now, sw: await readSwitches(c) };
  return seen.sw;
}
/** The owner closes or opens one (More › Board review). */
export async function setSwitch({ F, db }: Cloud, key: keyof Switches, closed: boolean): Promise<void> {
  await F.setDoc(F.doc(db, 'config/switches'), { [key]: closed, at: F.serverTimestamp() }, { merge: true });
  seen = null;
}

export const CLOSED: Record<keyof Switches, string> = {
  board: 'The board is closed for now: the app’s owner closed it. You can still read it.',
  requests: 'Friend requests are closed for now: the app’s owner closed them. An invite link still works.',
  messages: 'Messages and shared gyms are closed for now: the app’s owner closed them.',
};
export const globalText = (now: number) =>
  `Gym Tracker has reached its limit for posts, messages and requests today. It opens again ${until(dayEnds(now))}.`;

/**
 * Why the rules refused a social write, when it's one of the limits: the owner's switch for `area` closed, or the app's day full
 * (the owner hears of that). Otherwise null: the caller's own words for a refusal stand.
 */
export async function whyRefused(c: Cloud, area: keyof Switches | null, now = Date.now()): Promise<Error | null> {
  const { F, db } = c;
  const [sw, day] = await Promise.all([
    readSwitches(c).catch(() => OPEN),
    F.getDoc(F.doc(db, `limits/${dayId(now)}`)).then((d) => d.data()?.n as number | undefined, () => undefined),
  ]);
  if (area && sw[area]) return fail(CLOSED[area]);
  if ((day ?? 0) >= GLOBAL_PER_DAY) { limitHit('global'); return fail(globalText(now)); }
  return null;
}

/** Tells the owner (push and email, through the Worker, at most once a day each) that you ran into a limit. */
export function limitHit(id: LimitId, to?: string): void {
  if (to) notifyLimit(id, to); else notifyLimit(id);
}

/**
 * Your social counter's next value, for a write that adds it (and the day's counter) to its batch: the rules want both. Throws
 * past 300 in your day. `flip`: judge the day the other way (a refusal near its edge, by the server's clock).
 */
export async function socialNext(c: Cloud, uid: string, now: number, flip = false, dayOff = 0): Promise<(b: Batch) => void> {
  const { F, db } = c;
  const ref = F.doc(db, `socialRate/${uid}`);
  const r = rateOf((await F.getDoc(ref)).data());
  const next = rateNext(r, now, flip);
  if (next.n > SOCIAL_PER_DAY) {
    limitHit('social');
    throw fail(`That’s ${SOCIAL_PER_DAY} today (💪s, messages, requests, invites and gyms together). More ${until(r!.win + 86_400_000)}.`);
  }
  return (b) => {
    const ts = F.serverTimestamp();
    b.set(ref, { at: ts, win: next.keep && r ? F.Timestamp.fromMillis(r.win) : ts, n: next.n });
    countDay(c, b, now + dayOff * 86_400_000);
  };
}

/**
 * One social write as the rules want it: `put` fills the batch, then your counter and the day's go in with it. Refused, it tries
 * again (TRIES); refused every time, it says why when a limit is the reason (whyRefused), else rethrows the refusal for the
 * caller to word.
 */
export async function counted(c: Cloud, uid: string, area: keyof Switches | null, put: (b: Batch) => void, now = Date.now()): Promise<void> {
  await withTries(async (flip, off) => {
    const add = await socialNext(c, uid, now, flip, off);
    const b = c.F.writeBatch(c.db);
    put(b);
    add(b);
    await b.commit();
  }, async (e) => (await whyRefused(c, area, now)) ?? e);
}
