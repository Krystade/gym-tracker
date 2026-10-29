import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { BUDDIES, defaultName } from '../src/domain/buddies/roster';
import { HEAD } from '../src/domain/buddies/anchors';

// Gym Buddies stage 4 (plan §16.10): the Buddies tab's screens. The first pick of three commons; the lead's card with points,
// tickets and stats worked out from what's logged after it joined; renaming and making another the lead; the Collection with
// the credits (Characters' old place under More is gone); the lead on Today; and the head anchors' check grid.

const lead = (page: Page) => page.getByRole('button', { name: /, your lead buddy: open Buddies$/ });
/** Every sprite on the page drew: a missing or misnamed PNG has no natural width. */
const sprites = (page: Page) => page.locator('main img').evaluateAll((xs) => (xs as HTMLImageElement[]).map((i) => (i.complete ? i.naturalWidth : -1)));

test('the first buddy: three commons, one picked; it leads, earns from the set logged after, and shows on Today', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(lead(page)).toHaveCount(0); // none until one is picked
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  await expect(offer).toHaveCount(3);
  const names = await offer.locator('b').allTextContents();
  for (const n of names) expect(BUDDIES.find((b) => defaultName(b.id) === n)?.rarity, n).toBe(0);
  // The same three after a reload: the offer is seeded, not rolled each time.
  await page.reload();
  await goto(page, 'Buddies');
  await expect(offer.locator('b')).toHaveText(names);
  const pick = page.getByRole('button', { name: /^(Pick |Tap one)/ });
  await expect(pick).toBeDisabled();
  await offer.nth(1).click();
  await expect(offer.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await pick.click();
  const card = page.getByRole('region', { name: `${names[1]}’s card` });
  await expect(card.getByRole('heading', { name: names[1] })).toBeVisible();
  await expect(card.getByText('Lead', { exact: true })).toBeVisible();
  await expect(card.getByText('Lv 0')).toBeVisible();
  const wallet = page.locator('.bu-wallet');
  await expect(wallet).toHaveText('0 points, 0 tickets');
  await expect(page.getByRole('heading', { name: /^Your buddies/ })).toContainText(`1 of ${BUDDIES.length}`);
  expect(await sprites(page)).not.toContain(-1);

  // A set logged today: 1 point for the set and 5 for the session, and its card says what it came from.
  await goto(page, 'Today');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await page.getByRole('textbox', { name: 'Weight' }).fill('135');
  await page.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.getByRole('button', { name: /^Add set/ }).click();
  await expect(page.getByText('135 × 10').first()).toBeVisible();
  // Today's head: the lead, and a tap opens Buddies.
  await lead(page).click();
  await expect(page.getByRole('heading', { name: 'Buddies', level: 1 })).toBeVisible();
  // 1 for the set, 5 for the session, and whatever the achievements it unlocked pay (§16.5); no tickets below gold.
  await expect(wallet).toHaveText(/^\d+ points, 0 tickets$/);
  expect(Number((await wallet.textContent())!.match(/^\d+/)![0])).toBeGreaterThanOrEqual(6);
  await expect(card.getByText(/^With you since today: 1 set, 1 session\.$/)).toBeVisible();
  await expect(card.getByRole('listitem', { name: 'Size 0' })).toBeVisible();

  // Renamed: on its card and on Today.
  await card.getByRole('button', { name: 'Rename' }).click();
  await card.getByRole('textbox', { name: 'Name' }).fill('Rex');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Rex’s card' }).getByRole('heading', { name: 'Rex' })).toBeVisible();
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: 'Rex, your lead buddy: open Buddies' })).toBeVisible();
});

test('another buddy can lead; the Collection shows every buddy, unmet ones as shadows, with the credits; More has no Characters', async ({ page }) => {
  await page.goto('/');
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  await expect(page.getByRole('region', { name: `${first}’s card` })).toBeVisible();
  // A second buddy, as a pull will keep it (stage 5): a spend with its roll.
  const rare = BUDDIES.find((b) => b.rarity === 2)!;
  await page.evaluate(async (got) => {
    const d = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const store = d.transaction('config', 'readwrite').objectStore('config');
    const row = await new Promise<{ map: Record<string, unknown> }>((res) => { const r = store.get('spends'); r.onsuccess = () => res(r.result); });
    const day = new Date().toLocaleDateString('en-CA');
    const s = { id: 'e2e-pull', at: Date.now(), day, kind: 'pull', banner: 'buddy', cost: 13, seed: 1, got, rarity: 2, refund: 0 };
    await new Promise((res) => { const r = store.put({ key: 'spends', map: { ...row.map, [s.id]: s } }); r.onsuccess = res; });
    d.close();
  }, rare.id);
  await page.reload();
  await goto(page, 'Buddies');
  const roster = page.getByRole('region', { name: /^Your buddies/ }).getByRole('button');
  await expect(roster).toHaveCount(2);
  await expect(roster.first()).toHaveAccessibleName(new RegExp(`^${first}, Lv 0, lead$`));
  await page.screenshot({ path: 'screenshots/buddies-home-full.png', fullPage: true });
  await roster.nth(1).click();
  const second = page.getByRole('region', { name: `${defaultName(rare.id)}’s card` });
  await expect(second.getByText('Rare', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Make lead' }).click();
  await expect(second.getByText('Lead', { exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Make lead' })).toHaveCount(0);
  await goto(page, 'Today');
  await expect(page.getByRole('button', { name: `${defaultName(rare.id)}, your lead buddy: open Buddies` })).toBeVisible();

  await goto(page, 'Buddies');
  await page.getByRole('button', { name: /^Collection/ }).click();
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Not met yet/ })).toHaveCount(BUDDIES.length - 2);
  await expect(page.getByRole('region', { name: 'Rare' }).getByRole('button', { name: defaultName(rare.id) })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clint Bellanger' })).toHaveAttribute('href', /opengameart\.org/);
  await expect(page.getByRole('link', { name: 'Kenney' })).toHaveAttribute('href', /kenney\.nl/);
  await expect.poll(() => sprites(page).then((w) => w.filter((x) => x !== 16).length)).toBe(0);
  await page.getByRole('region', { name: 'Rare' }).getByRole('button', { name: defaultName(rare.id) }).click();
  await expect(page.getByRole('heading', { name: defaultName(rare.id), level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '‹ Collection' }).click();
  await expect(page.getByRole('heading', { name: 'Collection', level: 1 })).toBeVisible();

  await goto(page, 'More');
  await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /^Characters/ })).toHaveCount(0);
});

test('the head anchors’ check grid: every pose of every buddy, drawn, at 320 and 375 wide', async ({ page }) => {
  await page.goto('/?check=anchors');
  await expect(page.getByRole('heading', { name: 'Head anchors' })).toBeVisible();
  await expect(page.locator('.anchor-grid li')).toHaveCount(Object.keys(HEAD).length);
  await expect.poll(() => sprites(page).then((w) => w.filter((x) => x !== 16).length)).toBe(0);
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `screenshots/buddy-anchors-${w}.png`, fullPage: true });
  }
});
