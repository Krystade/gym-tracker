import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { goto } from './nav';
import { DOCS, EMU_HOST, emu } from './emu';
import { OWNERS } from '../src/cloud/owner';

// Synthetic accounts put straight into the local emulators as an admin (rules don't apply), so a screen can be shown with a
// full crew in seconds instead of logging every set through the UI. Synthetic users and numbers only.

export const EMU = DOCS;
const AUTH = `http://${EMU_HOST}:${emu.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`;
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

/** Their display name (social S1), as the app would write it: beside the username, never instead of it. */
export async function named(request: APIRequestContext, who: Seeded, dn: string) {
  await put(request, `users/${who.uid}`, { username: who.name, displayName: dn });
}

/** The ✓ for them (social S2), added to config/verified alone: other tests' entries in it stay. */
export async function verify(request: APIRequestContext, who: Seeded) {
  const res = await request.patch(`${EMU}/config/verified?updateMask.fieldPaths=${encodeURIComponent(`uids.\`${who.uid}\``)}`, {
    headers: { Authorization: 'Bearer owner' }, data: { fields: { uids: { mapValue: { fields: { [who.uid]: { timestampValue: new Date().toISOString() } } } } } },
  });
  expect(res.ok(), `config/verified: ${await res.text()}`).toBe(true);
}

/**
 * The app's owner (src/cloud/owner, the uid firestore.rules OWNERS() names), as an emulator account: the one account whose uid
 * isn't random, made once per run (every test that asks shares it, under one synthetic username).
 */
export async function ownerAccount(request: APIRequestContext): Promise<Seeded> {
  const uid = OWNERS[0], email = 'site-owner@test.local', name = 'site_owner';
  const res = await request.post(AUTH, { headers: { Authorization: 'Bearer owner' }, data: { localId: uid, email, password: PASSWORD } });
  if (!res.ok()) {
    const t = await res.text();
    expect(t, 'the owner’s emulator account').toMatch(/DUPLICATE_LOCAL_ID|EMAIL_EXISTS/);
  }
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

export interface Set0 { id: string; date: string; seq: number; loggedAt: string; exercise: string; setNo: number; weight: number; reps: number | null; flags: string[]; source: string; gym?: string }
/** Sets at a gym (the name the phone saves with each set). */
export const atGym = (gym: string, sets: Set0[]): Set0[] => sets.map((x) => ({ ...x, gym }));
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
export async function log(request: APIRequestContext, who: Seeded, sets: Set0[], opts: { goal?: number; status?: string; prs?: Record<string, string[]>; /** Their achievements start day. */ since?: string } = {}) {
  const months = new Map<string, Set0[]>();
  for (const s of sets) months.set(s.date.slice(0, 7), [...(months.get(s.date.slice(0, 7)) ?? []), s]);
  const at = Date.now();
  for (const [m, ss] of months) await put(request, `users/${who.uid}/months/${m}`, { sets: ss, body: [], deleted: {}, updatedAt: at, prs: opts.prs?.[m] });
  const items: Record<string, string> = {};
  if (opts.goal) items.profile = JSON.stringify({ weeklyGoal: opts.goal });
  if (opts.status) items.status = JSON.stringify(opts.status);
  if (opts.since) items.achievements = JSON.stringify(opts.since);
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

/**
 * Past the board's gate (social S3): the profile two days old, the rules accepted (no verified email since r28). `createdAt`
 * stays on the profile with the username and display name (put replaces a document whole).
 */
export async function onBoard(request: APIRequestContext, who: Seeded, dn = who.name) {
  await put(request, `users/${who.uid}`, { username: who.name, displayName: dn, createdAt: new Ts(Date.now() - 2 * 864e5) });
  await put(request, `users/${who.uid}/private/board`, { ok: true, at: new Ts(Date.now() - 864e5) });
}

/** A board post by them, as the app writes one, `minsAgo` minutes old; its id back. */
export async function boardPost(request: APIRequestContext, who: Seeded, t: string, minsAgo: number, over: Record<string, unknown> = {}) {
  const id = `e2e${rand()}${rand()}`;
  await put(request, `board/${id}`, { uid: who.uid, name: who.name, user: who.name, t, at: new Ts(Date.now() - minsAgo * 60_000), reports: 0, likes: 0, ...over });
  return id;
}
