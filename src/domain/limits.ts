// Limits (r28; plan .superpowers/security/rate-limits.md, local): what firestore.rules hold every account and the whole app to,
// so one account, or a few, can't use up the free plan's day for everyone. A test checks these against the rules. Plain
// TypeScript: the push Worker reads them too.

/** Social writes (a 💪 given or taken back, a friend request, an invite, a gym, a ping or message) one account makes a day. */
export const SOCIAL_PER_DAY = 300;
/** Social writes and board posts the whole app takes a UTC day, everyone together. */
export const GLOBAL_PER_DAY = 2000;
const DAY_MS = 86_400_000;
/** The app's counter for the day of `ms`: limits/{UTC days since 1970}, as the rules work it out from the server's time. */
export const dayId = (ms: number) => String(Math.floor(ms / DAY_MS));
/** When the day of `ms` ends (UTC midnight). */
export const dayEnds = (ms: number) => (Math.floor(ms / DAY_MS) + 1) * DAY_MS;

/** Which limit a person ran into, as the app tells the owner (push Worker POST /notify, kind 'limit'). */
export type LimitId = 'board' | 'report' | 'social' | 'send' | 'global';
export const LIMIT_IDS: readonly LimitId[] = ['board', 'report', 'social', 'send', 'global'];
/** The owner's switches (config/switches): true closes that for everyone but reading. */
export interface Switches { board: boolean; requests: boolean; messages: boolean }
export const OPEN: Switches = { board: false, requests: false, messages: false };
