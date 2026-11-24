import { expect, type Locator, type Page } from '@playwright/test';

/**
 * When the signed-in profile's last sync ended ('' before its first): cloud-seen's time, which a sync saves once everything in it
 * is done (state/useCloud), in the database of the profile the account is linked to.
 */
export const lastSync = (page: Page) => page.evaluate(async () => {
  const there = new Set((await indexedDB.databases()).map((d) => d.name));
  // Opened only when there: opening one that isn't would make it, empty, before the app's upgrade could.
  const get = (name: string, store: string, key: string) => !there.has(name) ? Promise.resolve(undefined) : new Promise<unknown>((ok, no) => {
    const r = indexedDB.open(name);
    r.onerror = () => no(r.error);
    r.onsuccess = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(store)) { d.close(); ok(undefined); return; }
      const g = d.transaction(store).objectStore(store).get(key);
      g.onsuccess = () => { d.close(); ok(g.result); };
      g.onerror = () => { d.close(); no(g.error); };
    };
  });
  const person = ((await get('gym-tracker-shared', 'kv', 'cloud')) as { person?: string } | undefined)?.person ?? 'main';
  const seen = (await get(person === 'main' ? 'gym-tracker' : `gym-tracker~${person}`, 'config', 'cloud-seen')) as { at?: string } | undefined;
  return seen?.at ?? '';
});

const text = async (l: Locator) => ((await l.count()) ? (await l.first().textContent()) ?? '' : '');

/**
 * Taps `button` (Create account, Sign in, Sync now) on the Account card `card` and waits out the sync it sets off, on the sync's
 * own ending: the end it saves, new since the tap, or the card's error, whichever comes first (an error fails at once, with its
 * text). Not "Synced" on screen within expect's 5 s: a sync is a chain of emulator round trips in a row (the index, a
 * transaction a month, settings, cycle, Together), and a sign-in's starts behind the 9 friend and inbox queries signing in sets
 * off, which WebKit sends 6 at a time to the emulator's one host. Alone a sign-in's took ~1.4 s; with 8 workers' phones on one
 * emulator every round trip stretches (those queries 0.5 → 1.4 s) and it took ~3.5 s (the two-phones flake, 2026-11-23). That is
 * late, not lost, so it is waited for while it runs, within the test's own time; a sync that never ends still fails, at the
 * test's timeout, named. The tap waits for the button to be enabled (no sync running), and the last end is read before it.
 */
export async function tapAndSync(page: Page, card: Locator, button: Locator) {
  await expect(button).toBeEnabled();
  const what = await button.textContent(), before = await lastSync(page);
  await button.click();
  await syncEnds(page, card, before, `the sync ${what} set off`);
}

/**
 * Waits for a sync to end with a saved end other than `before` (lastSync, read before whatever sets it off; see tapAndSync), and
 * for the card to say Synced: a follow-up sync straight after (useCloud's `again`) shows Syncing… until it ends too, and is
 * waited out the same way. By the saved end changing, not by the clock: a page clock held still (setFixedTime) stamps a first
 * sync after '' all the same (a second there would stamp the first's time, and can't be told from it).
 */
export async function syncEnds(page: Page, card: Locator, before: string, what = 'the sync') {
  const error = card.getByRole('alert'), status = card.getByRole('status');
  let how = 'syncing';
  await expect.poll(async () => (how = (await error.count()) ? `failed: ${await text(error)}`
    : (await lastSync(page)) !== before && /^Synced/.test(await text(status)) ? 'ended' : 'syncing'),
  { message: what, timeout: 0, intervals: [50, 100, 250] }).not.toBe('syncing');
  expect(how, what).toBe('ended');
}

/**
 * Waits until no sync is running (Sync now enabled again, the card saying Synced), however long the one running takes: for a sync
 * that may or may not have been set off (a timer run with page.clock), where there is nothing to wait for the end of. Fails on
 * the card's error.
 */
export async function syncSettles(card: Locator, syncNow: Locator) {
  const error = card.getByRole('alert'), status = card.getByRole('status');
  let how = 'syncing';
  await expect.poll(async () => (how = (await error.count()) ? `failed: ${await text(error)}`
    : (await syncNow.isEnabled()) && /^Synced/.test(await text(status)) ? 'settled' : 'syncing'),
  { message: 'the sync running, settling', timeout: 0, intervals: [50, 100, 250] }).not.toBe('syncing');
  expect(how).toBe('settled');
}
