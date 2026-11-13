import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { BUDDIES, BUDDY, defaultName } from '../src/domain/buddies/roster';

// Gym Buddies stage 4 (plan §16.10): the Buddies tab's screens. The first pick of three commons; the lead's card with points,
// tickets and stats worked out from what's logged after it joined; renaming and making another the lead; the Collection with
// the credits (Characters' old place under More is gone); the lead on Today; and the head anchors' check grid.

const lead = (page: Page) => page.getByRole('button', { name: /, your lead buddy: open Buddies$/ });
/** Every sprite on the page, with its natural width (-1 while it loads): a missing or misnamed PNG has none. */
const sprites = (page: Page) => page.locator('main img').evaluateAll((xs) => (xs as HTMLImageElement[]).map((i) => [i.getAttribute('src') ?? '', i.complete ? i.naturalWidth : -1] as const));
/** A sprite's own width: a Tiny one's 16, an older character's strip all its frames. */
const widthOf = (src: string) => { const b = BUDDY.get(src.match(/buddies\/([\w-]+)\.png$/)?.[1] ?? ''); return b?.art ? b.art.n * b.art.w : 16; };
/** The sprites that didn't draw at their own width. */
const wrong = (page: Page) => sprites(page).then((xs) => xs.filter(([src, w]) => w !== widthOf(src)).map(([src]) => src));

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
  expect((await sprites(page)).map(([, w]) => w)).not.toContain(-1);

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
  await expect(page.getByRole('link', { name: 'Kenney' }).first()).toHaveAttribute('href', /kenney\.nl/);
  await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toHaveCount(3);
  await expect.poll(() => wrong(page)).toEqual([]);
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
  await expect(page.locator('.anchor-grid li')).toHaveCount(BUDDIES.reduce((n, b) => n + (b.art ? b.art.n : b.poses.length), 0));
  await expect.poll(() => wrong(page)).toEqual([]);
  for (const w of [320, 375]) {
    await page.setViewportSize({ width: w, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `screenshots/buddy-anchors-${w}.png`, fullPage: true });
  }
});

test('the lead on Today holds what its card does (placed, guessed or on the anchor), covering no control, big ones too', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const day = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  // Owned and worn as the app keeps them (db config): a choose spend each, the sword held, a lead picked.
  const seed = (lead: string) => page.evaluate(async ({ lead, day }) => {
    const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const at = Date.now(), got = ['c066', 'truck', 'dudemrs', 'd105'];
    const spends = Object.fromEntries(got.map((g, i) => [`s${i}`, { id: `s${i}`, at: at - 1000 + i, day, kind: 'choose', banner: g === 'd105' ? 'acc' : 'buddy', cost: 0, got: g, rarity: 0, refund: 0 }]));
    const tx = db.transaction('config', 'readwrite'), st = tx.objectStore('config');
    st.put({ key: 'spends', map: spends });
    st.put({ key: 'buddies', map: { [lead]: { equip: { held: 'd105' }, at } } });
    st.put({ key: 'buddy-lead', id: lead, at });
    st.put({ key: 'buddy-start', since: day });
    await new Promise((ok) => { tx.oncomplete = ok; });
    db.close();
  }, { lead, day });
  // The Tiny one placed by hand on its first pose (tilted, out front); the others learn nothing like them: guess or anchor.
  await page.evaluate(() => localStorage.setItem('acc-marks', JSON.stringify({ held: { c066: { poses: { 0: { x: 13, y: 9, w: 8, h: 8, r: 30, f: false } } } } })));
  for (const [k, id] of ['c066', 'truck', 'dudemrs', 'c066'].entries()) {
    if (k === 3) await page.evaluate(() => localStorage.removeItem('acc-marks')); // and unplaced: on its head anchor
    await seed(id);
    await page.reload();
    const lead = page.locator('.today-buddy'), held = lead.locator('img.bu-held[data-held="d105"]');
    await expect(held, id).toBeVisible();
    if (k === 0) await expect(held).toHaveAttribute('data-placed', '');
    // On screen, below the status bar's backdrop.
    const box = (await held.boundingBox())!;
    expect(box.y, id).toBeGreaterThanOrEqual((await lead.boundingBox())!.y - 12.5); // no higher than the lead's own room
    expect(box.x + box.width, id).toBeLessThanOrEqual(375);
    // Nothing it holds lies over a control (the lead's own button aside).
    const hit = await held.evaluate((el) => {
      const h = el.getBoundingClientRect();
      return [...document.querySelectorAll('button, a, input, select, textarea, [role=button], [role=tab]')].filter((c) => !c.closest('.today-buddy')).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width && r.height && r.left < h.right && h.left < r.right && r.top < h.bottom && h.top < r.bottom;
      }).map((c) => c.outerHTML.slice(0, 80));
    });
    expect(hit, id).toEqual([]);
    if (k === 0 || k === 2) await page.screenshot({ path: `test-results/today-held-${id}.png` });
  }
});
