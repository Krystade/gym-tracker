import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';

// Synthetic accounts put straight into the local emulators as an admin (rules don't apply), so a screen can be shown with a
// full crew in seconds instead of logging every set through the UI. Synthetic users and numbers only.

export const EMU = 'http://127.0.0.1:8080/v1/projects/demo-gym-tracker/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key';
export const PASSWORD = 'synthetic-pass-1';
export const rand = () => Math.random().toString(36).slice(2, 10);
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A Firestore timestamp, where the app reads one (`toMillis`). */
export class Ts { constructor(readonly ms: number) {} }
/** A JS value as Firestore's REST API writes it. */
function value(v: unknown): unknown {
  if (v === null) return { nullValue: null };
  if (v instanceof Ts) return { timestampValue: new Date(v.ms).toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: fields(v as Record<string, unknown>) } };
}
const fields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, value(v)]));

export async function put(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const res = await request.patch(`${EMU}/${path}`, { headers: { Authorization: 'Bearer owner' }, data: { fields: fields(data) } });
  expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
}

export interface Seeded { uid: string; name: string; email: string }
/** An account with a username and nothing else. */
export async function account(request: APIRequestContext, name = `u${rand()}`): Promise<Seeded> {
  const email = `${name}@test.local`;
  const res = await request.post(AUTH, { data: { email, password: PASSWORD, returnSecureToken: true } });
  expect(res.ok(), await res.text()).toBe(true);
  const uid = (await res.json()).localId as string;
  await put(request, `users/${uid}`, { username: name, displayName: name });
  await put(request, `usernames/${name}`, { uid });
  return { uid, name, email };
}

/** A ping from one to another, in the receiver's inbox as sendPing writes it. */
export async function ping(request: APIRequestContext, from: Seeded, to: Seeded, e: string, at: number) {
  await put(request, `users/${to.uid}/inbox/p${rand()}`, { from: from.uid, kind: 'p', e, at: new Ts(at) });
}

export async function befriend(request: APIRequestContext, a: Seeded, b: Seeded, now = Date.now()) {
  await put(request, `users/${a.uid}/friends/${b.uid}`, { since: now, via: 'request' });
  await put(request, `users/${b.uid}/friends/${a.uid}`, { since: now, via: 'request' });
}

export interface Set0 { id: string; date: string; seq: number; loggedAt: string; exercise: string; setNo: number; weight: number; reps: number | null; flags: string[]; source: string }
/** A session: each lift's sets, one every `gap` minutes from `start`. */
export function session(start: Date, lifts: [string, [number, number][]][], gap = 3): Set0[] {
  const out: Set0[] = [];
  let t = start.getTime();
  for (const [exercise, sets] of lifts) {
    sets.forEach(([weight, reps], i) => {
      const date = iso(new Date(t));
      out.push({ id: `app|${date}|${exercise.toLowerCase()}|${i + 1}`, date, seq: t, loggedAt: new Date(t).toISOString(), exercise, setNo: i + 1, weight, reps, flags: [], source: 'app' });
      t += gap * 60_000;
    });
  }
  return out;
}

/** Their log into their month documents (with the PR ids a phone writes there), their goal and status into their settings. */
export async function log(request: APIRequestContext, who: Seeded, sets: Set0[], opts: { goal?: number; status?: string; prs?: Record<string, string[]> } = {}) {
  const months = new Map<string, Set0[]>();
  for (const s of sets) months.set(s.date.slice(0, 7), [...(months.get(s.date.slice(0, 7)) ?? []), s]);
  const at = Date.now();
  for (const [m, ss] of months) await put(request, `users/${who.uid}/months/${m}`, { sets: ss, body: [], deleted: {}, updatedAt: at, prs: opts.prs?.[m] });
  const items: Record<string, string> = {};
  if (opts.goal) items.profile = JSON.stringify({ weeklyGoal: opts.goal });
  if (opts.status) items.status = JSON.stringify(opts.status);
  if (Object.keys(items).length) await put(request, `users/${who.uid}/meta/profile`, { items, updatedAt: at });
  await put(request, `users/${who.uid}/meta/index`, { months: Object.fromEntries([...months.keys()].map((m) => [m, at])), ...(Object.keys(items).length && { meta: at }) });
}

/** A phone signed in to a seeded account, its clock at `time`, its log synced down, on Friends. */
export async function signedIn(browser: Browser, who: Seeded, time: Date, setup?: (page: Page) => Promise<void>) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  const page = await ctx.newPage();
  await setup?.(page);
  await page.clock.install({ time });
  await page.goto('/');
  await goto(page, 'Friends');
  await page.getByRole('button', { name: 'Sign in or create an account' }).click();
  const acct = page.getByRole('region', { name: 'Account' });
  await acct.getByRole('textbox', { name: 'Email' }).fill(who.email);
  await acct.getByLabel('Password').fill(PASSWORD);
  await acct.getByRole('button', { name: 'Sign in' }).click();
  await expect(acct.getByRole('status')).toHaveText(/^Synced/, { timeout: 20_000 });
  await goto(page, 'Friends');
  return page;
}
