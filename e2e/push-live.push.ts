import { createServer, type Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';

// End to end on this machine: the app (built with a Worker URL) → wrangler dev (local mode) → a fake push service here,
// which decrypts what arrives with the subscription's private key; then the push is handed to the app's service worker
// over CDP. Synthetic account on the Auth emulator. Run with playwright.push.config.ts (Chromium, headless).

const subtle = globalThis.crypto.subtle;
const ascii = (s: string) => new TextEncoder().encode(s);
const cat = (...xs: Uint8Array[]) => Uint8Array.from(xs.flatMap((x) => [...x]));
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}
/** RFC 8291 (aes128gcm), receiving side. */
async function decrypt(body: Uint8Array, priv: CryptoKey, pub: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, priv, 256));
  const ikm = await hkdf(auth, ecdh, cat(ascii('WebPush: info\0'), pub, asPub), 32);
  const key = await subtle.importKey('raw', await hkdf(salt, ikm, ascii('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
  const out = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, ascii('Content-Encoding: nonce\0'), 12) }, key, body.slice(21 + idlen)));
  let end = out.length - 1;
  while (out[end] === 0) end--;
  expect(out[end]).toBe(2);
  return new TextDecoder().decode(out.slice(0, end));
}

interface Got { path: string; headers: Record<string, string | string[] | undefined>; body: Uint8Array }
let server: Server, endpoint: string;
const got: Got[] = [];
let priv: CryptoKey, pub: Uint8Array;
const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

test.beforeAll(async () => {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  priv = pair.privateKey;
  pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { got.push({ path: req.url ?? '', headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)) }); res.writeHead(201).end(); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/push/synthetic-device`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

const nav = (page: Page, t: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true }).click();
const card = (page: Page) => page.getByRole('region', { name: 'Notifications' });
/** Calls the Worker as the signed-in app does, for what the UI doesn't show. */
const worker = (page: Page, method: string, path: string) => page.evaluate(async ([url, method, path]) => {
  const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('firebaseLocalStorageDb'); q.onsuccess = () => r(q.result); });
  const all = await new Promise<{ value: { stsTokenManager: { accessToken: string } } }[]>((r) => { const q = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => r(q.result); });
  const token = all.find((x) => x.value?.stsTokenManager)!.value.stsTokenManager.accessToken;
  const res = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  return res.json();
}, [String(test.info().config.metadata.worker), method, path] as const);
const lastPush = (page: Page) => page.evaluate(() => new Promise<unknown>((r) => {
  const q = indexedDB.open('gym-tracker-push');
  q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('lastPush'); g.onsuccess = () => r(g.result ?? null); };
}));

test('turn on, send a test push, read it, and hand it to the service worker; the rest timer asks for an alert', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['notifications']);
  // The Home Screen app, and a push subscription pointed at the fake push service (headless can't really subscribe).
  await page.addInitScript(({ endpoint, p256dh, auth }) => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: true, media: q } as MediaQueryList : mm(q));
    let current: PushSubscription | null = null;
    const make = () => ({ endpoint, expirationTime: null, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }), unsubscribe: async () => { current = null; return true; } }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () { current = make(); return current; };
    PushManager.prototype.getSubscription = async function () { return current; };
    // Chrome's headless shell answers "denied" whatever was granted; the stubbed subscribe stands in for the prompt.
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  }, { endpoint, p256dh: b64u(pub), auth: b64u(auth) });
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await nav(page, 'More');
  await expect(card(page)).toContainText('Notifications need an account.');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`push${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@test.local`);
  await account.getByLabel('Password').fill('synthetic-pass-1');
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByText(/^Signed in as/)).toBeVisible();

  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(card(page).getByRole('status')).toHaveText('Notifications are on.');
  await expect(card(page).getByRole('checkbox', { name: /Rest timer/ })).toBeChecked();
  await expect(card(page).getByRole('checkbox', { name: /Workout reminder/ })).not.toBeChecked();
  const status = await worker(page, 'GET', '/status') as { devices: { id: string }[]; prefs: { tz: string; kinds: { rest: boolean } } };
  expect(status.devices).toHaveLength(1);
  expect(status.prefs.kinds.rest).toBe(true);

  // Reminder on: chips spread over the default goal of 2 a week, Tuesday and Friday.
  await card(page).getByRole('checkbox', { name: /Workout reminder/ }).check();
  await expect(card(page).getByRole('group', { name: 'Reminder days' }).getByRole('button', { pressed: true })).toHaveText(['Tue', 'Fri']);
  await expect.poll(async () => ((await worker(page, 'GET', '/status')) as { prefs: { kinds: { remind: boolean }; reminder: { days: number[] } } }).prefs, { timeout: 10_000 })
    .toMatchObject({ kinds: { remind: true }, reminder: { days: [2, 5] } });
  await page.screenshot({ path: 'test-results/push-card-on.png', fullPage: true });

  await card(page).getByRole('button', { name: 'Send test notification' }).click();
  await expect(card(page).getByRole('status')).toHaveText('Sent. It should show in a few seconds.');
  expect(got).toHaveLength(1);
  expect(got[0].path).toBe('/push/synthetic-device');
  expect(got[0].headers).toMatchObject({ 'content-encoding': 'aes128gcm', urgency: 'normal', topic: 'test' });
  expect(String(got[0].headers.authorization)).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]{86}$/);
  const plain = await decrypt(got[0].body, priv, pub, auth);
  expect(JSON.parse(plain)).toEqual({ web_push: 8030, mutable: true, notification: {
    title: 'Test notification', body: 'Notifications work on this phone.', lang: 'en', navigate: new URL('#open=today', page.url()).href, data: { kind: 'test', route: 'today' } } });

  // Hand exactly what arrived to the service worker, as the push service would.
  const cdp = await context.newCDPSession(page);
  const regs: { registrationId: string; scopeURL: string }[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => regs.length).toBeGreaterThan(0);
  expect(await lastPush(page)).toBeNull();
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId: regs[0].registrationId, data: plain });
  await expect.poll(() => lastPush(page)).toMatchObject({ kind: 'test' });

  // A set starts the rest timer, which asks the Worker for the lock-screen alert; dismissing it cancels that.
  await nav(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).first().fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).first().fill('8');
  await page.getByRole('button', { name: 'Add set' }).first().click();
  await expect(page.getByRole('timer', { name: 'Rest' })).toBeVisible();
  await expect.poll(async () => ((await worker(page, 'GET', '/status')) as { rest: { due: number } | null }).rest).not.toBeNull();
  await page.getByRole('button', { name: 'Close rest timer' }).click();
  await expect.poll(async () => ((await worker(page, 'GET', '/status')) as { rest: unknown }).rest).toBeNull();

  // A launch on #open=recap lands on Today, at the week's digest.
  await page.goto('/#open=recap');
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  expect(new URL(page.url()).hash).toBe('');
});

test('the rest alarm fires a push on its own, with the label the app sent', async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['notifications']);
  await page.goto('/');
  // A fresh account, its device subscribed and a 5 s rest set straight on the Worker: the alarm alone has to send it.
  await nav(page, 'More');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`rest${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@test.local`);
  await account.getByLabel('Password').fill('synthetic-pass-1');
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByText(/^Signed in as/)).toBeVisible();
  const before = got.length;
  const r = await page.evaluate(async ([url, endpoint, p256dh, auth]) => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('firebaseLocalStorageDb'); q.onsuccess = () => r(q.result); });
    const all = await new Promise<{ value: { stsTokenManager: { accessToken: string } } }[]>((r) => { const q = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); q.onsuccess = () => r(q.result); });
    const headers = { authorization: `Bearer ${all.find((x) => x.value?.stsTokenManager)!.value.stsTokenManager.accessToken}`, 'content-type': 'application/json' };
    const { id } = await (await fetch(`${url}/subscribe`, { method: 'POST', headers, body: JSON.stringify({ endpoint, keys: { p256dh, auth } }) })).json();
    return (await fetch(`${url}/timer`, { method: 'POST', headers, body: JSON.stringify({ sub: id, seconds: 5, label: 'Squat · set 2 next' }) })).status;
  }, [String(test.info().config.metadata.worker), endpoint, b64u(pub), b64u(auth)] as const);
  expect(r).toBe(200);
  await expect.poll(() => got.length, { timeout: 20_000 }).toBe(before + 1);
  const p = got.at(-1)!;
  expect(p.headers).toMatchObject({ urgency: 'high', ttl: '60', topic: 'rest' });
  expect(JSON.parse(await decrypt(p.body, priv, pub, auth)).notification).toMatchObject({ title: 'Rest done', body: 'Squat · set 2 next', data: { route: 'rest' } });
});

// ---- Friends: each phone its own push keys and endpoint on the fake push service, and its own account. ----

/** A phone's push subscription keys, and a way to read what the fake push service got for it. */
async function phoneKeys(name: string) {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const path = `/push/${name}-${Date.now().toString(36)}`;
  return {
    path, endpoint: endpoint.replace(/\/push\/.*$/, path), p256dh: b64u(pub), auth: b64u(auth),
    pushes: () => got.filter((g) => g.path === path),
    read: async (g: Got) => JSON.parse(await decrypt(g.body, pair.privateKey, pub, auth)) as { notification: { title: string; body: string; navigate: string; data: { kind: string; route: string } } },
  };
}

/** Turns notifications on from More, every friend switch on. */
async function enrol(page: Page) {
  await nav(page, 'More');
  await card(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(card(page).getByRole('status')).toHaveText('Notifications are on.');
  await expect(card(page).getByRole('checkbox', { name: /Friend activity/ })).toBeChecked();
  await expect(card(page).getByRole('checkbox', { name: /Pings and messages/ })).toBeChecked();
}

/** A Home Screen phone with an account and a username, and notifications on unless `notify` is false. */
async function friendPhone(browser: import('@playwright/test').Browser, who: string, notify = true) {
  const keys = await phoneKeys(who);
  const app = String(test.info().project.use.baseURL).replace(/\/$/, '');
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, storageState: { cookies: [], origins: [{ origin: app, localStorage: [{ name: 'gym-tracker:walkthrough', value: 'done' }] }] } });
  await ctx.grantPermissions(['notifications']);
  const page = await ctx.newPage();
  await page.addInitScript(({ endpoint, p256dh, auth }) => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: true, media: q } as MediaQueryList : mm(q));
    let current: PushSubscription | null = null;
    const make = () => ({ endpoint, expirationTime: null, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }), unsubscribe: async () => { current = null; return true; } }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () { current = make(); return current; };
    PushManager.prototype.getSubscription = async function () { return current; };
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  }, { endpoint: keys.endpoint, p256dh: keys.p256dh, auth: keys.auth });
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const name = `${who}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
  await nav(page, 'More');
  const account = page.getByRole('region', { name: 'Account' });
  await account.getByRole('textbox', { name: 'Email' }).fill(`${name}@test.local`);
  await account.getByLabel('Password').fill('synthetic-pass-1');
  await account.getByRole('button', { name: 'Create account' }).click();
  await expect(account.getByText(/^Signed in as/)).toBeVisible();
  if (notify) await enrol(page);
  await goto(page, 'Friends');
  const friends = page.getByRole('region', { name: 'Friends', exact: true });
  await friends.getByRole('textbox', { name: 'Username' }).fill(name);
  await friends.getByRole('button', { name: 'Save username' }).click();
  await expect(friends).toContainText(`You’re @${name}`);
  return { page, name, keys, friends, close: () => ctx.close() };
}

test('friend activity: a request rings the person asked, accepting rings the asker, and its switch reaches the Worker', async ({ browser }) => {
  test.setTimeout(120_000);
  const [a, b] = await Promise.all([friendPhone(browser, 'a'), friendPhone(browser, 'b')]);

  // A asks B by username: B's phone gets the push, in the Worker's words, with A's name from A's profile.
  await a.friends.getByRole('textbox', { name: 'Their username' }).fill(b.name);
  await a.friends.getByRole('button', { name: 'Send request' }).click();
  await expect(a.friends.getByRole('status')).toHaveText(`Request sent to @${b.name}.`);
  await expect.poll(() => b.keys.pushes().length, { timeout: 15_000 }).toBe(1);
  const req = b.keys.pushes()[0];
  expect(req.headers).toMatchObject({ urgency: 'normal', ttl: '86400', 'content-encoding': 'aes128gcm' });
  expect(String(req.headers.topic)).toMatch(/^[\w-]{22}$/);
  expect((await b.keys.read(req)).notification).toMatchObject({ title: 'Friend request', body: `${a.name} wants to be friends`, data: { kind: 'request', route: 'friends' } });

  // B accepts: A's phone hears, and the tap would open B.
  await b.page.reload();
  await goto(b.page, 'Friends');
  await b.friends.getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(b.friends.getByRole('status')).toHaveText(`You and @${a.name} are now friends.`);
  await expect.poll(() => a.keys.pushes().length, { timeout: 15_000 }).toBe(1);
  const acc = await a.keys.read(a.keys.pushes()[0]);
  expect(acc.notification).toMatchObject({ title: 'New friend', body: `You and ${b.name} are friends` });
  expect(acc.notification.data.route).toMatch(/^friend\.[\w-]+$/);
  expect(acc.notification.navigate).toBe(new URL(`#open=${acc.notification.data.route}`, a.page.url()).href);

  // B switches friend activity off on More: the Worker has it (what it then holds back is in worker/test/notify.test.ts).
  await nav(b.page, 'More');
  await card(b.page).getByRole('checkbox', { name: /Friend activity/ }).uncheck();
  await expect.poll(async () => ((await worker(b.page, 'GET', '/status')) as { prefs: { kinds: { activity: boolean } } }).prefs.kinds.activity, { timeout: 10_000 }).toBe(false);
  await Promise.all([a.close(), b.close()]);
});

test('pings and messages: a friend’s ping rings with their name and the badge, a muted friend’s doesn’t, and the tap opens the thread', async ({ browser }) => {
  test.setTimeout(150_000);
  // B turns notifications on only once the friendships are made, so the requests' and acceptances' pushes (1 a minute
  // from each friend) don't hold back the pings this test is about.
  const [a, b, c] = await Promise.all([friendPhone(browser, 'a', false), friendPhone(browser, 'b', false), friendPhone(browser, 'c', false)]);
  for (const f of [a, c]) {
    await b.friends.getByRole('textbox', { name: 'Their username' }).fill(f.name);
    await b.friends.getByRole('button', { name: 'Send request' }).click();
    await expect(b.friends.getByRole('status')).toHaveText(`Request sent to @${f.name}.`);
    await f.page.reload();
    await goto(f.page, 'Friends');
    await f.friends.getByRole('region', { name: 'Requests' }).getByRole('button', { name: 'Accept' }).click();
    await expect(f.friends.getByRole('status')).toHaveText(`You and @${b.name} are now friends.`);
  }
  await enrol(b.page);
  expect(b.keys.pushes()).toHaveLength(0);

  // B mutes C from C's thread; the Worker gets C in the prefs' muted list.
  await goto(b.page, 'Friends');
  const thread = (p: Page, n: string) => p.getByRole('dialog', { name: `Messages with @${n}` });
  await b.page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: `Message @${c.name}` }).click();
  await thread(b.page, c.name).getByRole('button', { name: `Mute @${c.name}` }).click();
  await expect(thread(b.page, c.name).getByRole('button', { name: `Unmute @${c.name}` })).toBeVisible();
  await thread(b.page, c.name).getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => ((await worker(b.page, 'GET', '/status')) as { prefs: { muted?: string[] } }).prefs.muted?.length, { timeout: 10_000 }).toBe(1);

  // C messages B, then A pings B. Only A's rings: C is muted. A's badge is 2, so C's message did reach B's Worker first.
  const send = async (f: typeof a, what: () => Promise<void>, sent: string) => {
    await f.page.getByRole('region', { name: 'Crew' }).getByRole('button', { name: `Message @${b.name}` }).click();
    await what();
    await expect(thread(f.page, b.name).getByRole('status')).toHaveText(sent);
  };
  await send(c, async () => {
    await thread(c.page, b.name).getByRole('textbox', { name: `Message @${b.name}` }).fill('leg day?');
    await thread(c.page, b.name).getByRole('button', { name: 'Send', exact: true }).click();
  }, 'Sent');
  await send(a, () => thread(a.page, b.name).getByRole('button', { name: 'Send 💪 Strong' }).click(), 'Sent 💪');
  await expect.poll(() => b.keys.pushes().length, { timeout: 15_000 }).toBe(1);
  const ping = b.keys.pushes()[0];
  expect(ping.headers).toMatchObject({ urgency: 'normal', ttl: '86400', 'content-encoding': 'aes128gcm' });
  expect(String(ping.headers.topic)).toMatch(/^[\w-]{22}$/);
  const n = (await b.keys.read(ping)).notification as { title: string; body: string; navigate: string; app_badge?: string; data: { kind: string; route: string } };
  expect(n).toMatchObject({ title: a.name, body: '💪', app_badge: '2', data: { kind: 'ping' } }); // the emoji alone
  expect(n.data.route).toMatch(/^friend\.[\w-]+$/);
  // C's never comes: its message was counted (the 2) before A's ping went, so it was held back, not late.
  expect(b.keys.pushes()).toHaveLength(1);

  // The tap: the app opens on A's thread, with the ping in it.
  await b.page.goto(n.navigate);
  await expect(thread(b.page, a.name).getByRole('list', { name: 'Messages' }).locator('.bubble-text')).toHaveText(['💪']);
  await Promise.all([a.close(), b.close(), c.close()]);
});
