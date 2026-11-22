import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';
import { notched } from './layout';
import { iso } from './seed';
import { ledgerOf, MULTI, pull, PULL, starter } from '../src/domain/buddies/gacha';
import { FRAMES } from '../src/domain/buddies/anchors';
import { BUDDIES, BUDDY, defaultName, type Banner, type Rarity } from '../src/domain/buddies/roster';

// Pulls up front (owner 2026-11-15): the ticket and each banner's pull, ten pulls and pity on the Buddies tab, and a pull's show
// (ui/buddies/PullShow). A 10-pull spends tickets first, then points, shows each in turn, then all ten with what came back; a
// single pull's show is long for a legendary and a tap skips to it; a duplicate says so. On the 13 mini, notch and home
// indicator included. A buddy comes in a mystery egg and an accessory in a treasure chest (owner 2026-11-21), the egg's spots
// and the chest's lock gem in the light's colour as it climbs; the egg's top cracks off, the chest's lid stays part-open.
// The roll is forced only by handing the app a chosen random seed (its one call for a 32-bit seed).

const SHOTS = 'screenshots/buddies';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,logged_at';
const points = async (page: Page) => Number((await page.locator('.bu-wallet').textContent())!.match(/^[\d,]+/)![0].replace(/,/g, ''));
const tickets = async (page: Page) => Number((await page.locator('.bu-tix').getAttribute('aria-label'))!.match(/^\d+/)?.[0] ?? 0);
const banner = (page: Page, name: 'Buddies' | 'Accessories') => page.getByRole('region', { name: `${name} banner` });

/** A seed whose single pull on a banner (the buddies' unless said), from a fresh pity, lands as `want` says (searched here, as
 *  the app rolls). */
function seedFor(want: (got: string, rarity: Rarity) => boolean, on: Banner = 'buddy'): number {
  const l = ledgerOf([]);
  for (let seed = 1; seed < 5_000_000; seed++) { const s = pull(l, on, 'pull', seed, 1, '2026-11-01'); if (want(s.got!, s.rarity)) return seed; }
  throw new Error('no seed');
}

/** The first pick, then 15 sessions of 12 sets over the last month: points, and tickets from every 5 sessions. */
async function setUp(page: Page): Promise<string> {
  await notched(page);
  // The app's pull seed is one crypto.getRandomValues on a Uint32Array of 1; window.__seed, once set, answers the next such call.
  await page.addInitScript(() => {
    const real = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (<T extends ArrayBufferView | null>(a: T): T => {
      const w = window as unknown as { __seed?: number | null };
      if (w.__seed != null && a instanceof Uint32Array && a.length === 1) { a[0] = w.__seed; w.__seed = null; return a; }
      return real(a as never) as T;
    }) as typeof crypto.getRandomValues;
  });
  await page.goto('/');
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  await expect(page.getByRole('region', { name: `${first}’s card` })).toBeVisible();
  const rows = Array.from({ length: 15 }, (_, k) => iso(new Date(Date.now() - (k + 1) * 2 * 864e5))).flatMap((day) =>
    Array.from({ length: 12 }, (_, i) => `${day},Bench Press,,${i + 1},135,8,,,,sample,${day}T10:00:${String(i).padStart(2, '0')}`));
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText(`✓ Imported ${rows.length} new sets`)).toBeVisible({ timeout: 30_000 });
  await goto(page, 'Buddies');
  await expect.poll(() => points(page)).toBeGreaterThanOrEqual(180 + 15 * 5);
  await expect.poll(() => tickets(page)).toBeGreaterThanOrEqual(3);
  return first;
}

test('ten pulls: tickets first then points, said on the button; each in turn, then all ten with the refunds; the wallet after', async ({ page }) => {
  test.setTimeout(90_000);
  await setUp(page);
  const p0 = await points(page), t0 = await tickets(page);
  expect(t0).toBeLessThan(MULTI);
  // The ticket, up front, and each banner's pity next to its buttons.
  await expect(page.locator('.bu-tix')).toContainText(String(t0));
  await expect(banner(page, 'Buddies').getByRole('button', { name: 'Odds: rare in 10, epic in 40' })).toBeVisible();
  await expect(banner(page, 'Buddies').getByRole('button', { name: 'Pull with ticket: 1 ticket' })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/home-tickets.png` });

  const bill = `${t0} ${t0 === 1 ? 'ticket' : 'tickets'} + ${(MULTI - t0) * PULL.buddy} pts`;
  const ten = banner(page, 'Buddies').getByRole('button', { name: `${MULTI} pulls: ${bill}` });
  await expect(ten).toBeEnabled();
  await ten.click();
  const show = page.getByRole('dialog', { name: `Your ${MULTI} pulls` });
  await expect(show).toBeVisible();
  await expect(show.locator('.ps-count')).toHaveText(`1 of ${MULTI}`);
  await expect(show.locator('[data-vessel="egg"]')).toBeVisible(); // a buddy banner's: each in an egg, never a chest
  await expect(show.locator('[data-vessel="chest"]')).toHaveCount(0);
  // A tap skips the first's animation; once it has landed a tap goes on to the next.
  await show.click();
  await expect(show).toHaveAttribute('data-phase', 'land');
  await expect(show.getByRole('status')).toContainText(/Tap for the next/);
  await show.click();
  await expect(show.locator('.ps-count')).toHaveText(`2 of ${MULTI}`);
  await expect(show).not.toHaveAttribute('data-phase', 'land');
  await expect(show.locator('[data-vessel="egg"]')).toBeVisible();
  await show.getByRole('button', { name: 'Skip all' }).click();

  const all = page.getByRole('dialog', { name: `Your ${MULTI} pulls: all ${MULTI}` });
  const cells = all.getByRole('list', { name: 'What landed' }).getByRole('listitem');
  await expect(cells).toHaveCount(MULTI);
  await page.waitForTimeout(900); // the cells' entrance
  await page.screenshot({ path: `${SHOTS}/ten-summary.png` });
  const labels = await cells.evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')!));
  const refunds = labels.map((l) => Number(l.match(/, (\d+) points? back$/)?.[1] ?? 0));
  const refund = refunds.reduce((a, x) => a + x, 0), fresh = labels.filter((l) => l.endsWith(', new')).length;
  expect(labels.some((l) => /, (rare|epic|legendary) buddy, /.test(l))).toBe(true); // a rare or better every ten
  expect(refunds.every((r) => r === 0 || r === Math.round(PULL.buddy / 2))).toBe(true);
  const dupes = MULTI - fresh;
  await expect(all.locator('.ps-tally')).toHaveText(`${fresh} new${dupes ? `${dupes} ${dupes === 1 ? 'duplicate' : 'duplicates'}: +${refund} back` : 'no duplicates'}`);
  await expect(all.locator('.ps-cell.best').first()).toBeVisible();
  await expect(all.getByText(`Spent ${bill.replace(' pts', ' points')}.`)).toBeVisible();
  await all.getByRole('button', { name: 'Done' }).click();
  await expect(all).toHaveCount(0);
  // Spent: every ticket and the rest in points, less what the duplicates gave back; pity reset by the rare.
  await expect.poll(() => tickets(page)).toBe(0);
  await expect.poll(() => points(page)).toBe(p0 - (MULTI - t0) * PULL.buddy + refund);
  await expect(banner(page, 'Buddies').getByRole('button', { name: /^Odds: rare in (\d|10),/ })).toBeVisible();
  // No tickets left: the pull is a points pull now.
  await expect(banner(page, 'Buddies').getByRole('button', { name: `Pull: ${PULL.buddy} pts` })).toBeEnabled();
});

test('one pull: a legendary charges long and a tap skips straight to it; a duplicate says ×2 and what came back', async ({ page }) => {
  test.setTimeout(90_000);
  const lead = await setUp(page);
  const t0 = await tickets(page);
  const legendary = seedFor((_, r) => r === 4);

  // Left alone, a legendary's show runs about two seconds: still charging well into it, then the burst, then it lands.
  await page.evaluate((s) => { (window as unknown as { __seed: number }).__seed = s; }, legendary);
  await banner(page, 'Buddies').getByRole('button', { name: /^Pull with ticket/ }).click();
  const show = page.getByRole('dialog', { name: 'Your pull' });
  await expect(show).toBeVisible();
  await expect(show.locator('[data-vessel="egg"]')).toBeVisible();
  await expect(show.locator('[data-vessel="chest"]')).toHaveCount(0);
  await page.waitForTimeout(1800);
  await expect(show).toHaveAttribute('data-phase', 'charge');
  // The spots are the light's colour as it climbs (epic's purple by now), and orange at the last step before the burst.
  await page.screenshot({ path: `${SHOTS}/legendary-charge.png` });
  const spots = show.locator('.egg .px-a').first();
  await expect(show).toHaveClass(/\bt[34]\b/);
  await expect(spots).toHaveCSS('fill', /^rgb\((176, 124, 255|255, 143, 61)\)$/);
  await expect(show).toHaveClass(/\bt4\b/, { timeout: 1000 });
  await expect(spots).toHaveCSS('fill', 'rgb(255, 143, 61)');
  await expect(show).toHaveAttribute('data-phase', 'burst', { timeout: 2000 });
  await page.waitForTimeout(90);
  await page.screenshot({ path: `${SHOTS}/legendary-crack.png` }); // the top just cracked off along the zigzag
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/legendary-burst.png` });
  await expect(show).toHaveAttribute('data-phase', 'land');
  await expect(show.getByRole('status')).toContainText('Legendary buddy');
  await expect(show.getByRole('status').getByText('NEW!', { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  // Cracked open: the top flown off and gone, the rest dropped away, what it held in their place.
  await expect(show.locator('.egg .ps-part.off')).toHaveCSS('opacity', '0');
  await expect(show.locator('.egg .ps-part.rest')).toHaveCSS('opacity', '0');
  await page.screenshot({ path: `${SHOTS}/legendary-landed.png` });
  await show.getByRole('button', { name: 'Done' }).click();
  await expect(show).toHaveCount(0);
  await expect.poll(() => tickets(page)).toBe(t0 - 1);

  // Again, skipped: a tap anywhere at once shows what landed, long before the show would have.
  await page.evaluate((s) => { (window as unknown as { __seed: number }).__seed = s; }, seedFor((g, r) => r === 4 && g !== pull(ledgerOf([]), 'buddy', 'pull', legendary, 1, '2026-11-01').got));
  await banner(page, 'Buddies').getByRole('button', { name: /^Pull with ticket/ }).click();
  await expect(show).toHaveAttribute('data-phase', /^(drop|charge)$/);
  const t = Date.now();
  await show.click({ position: { x: 180, y: 300 } });
  await expect(show).toHaveAttribute('data-phase', 'land', { timeout: 500 });
  expect(Date.now() - t).toBeLessThan(1000);
  await expect(show.getByRole('status')).toContainText('Legendary buddy');
  await show.getByRole('button', { name: 'Done' }).click();

  // A duplicate of the lead: ×2 and half the pull back, said plainly.
  const id = BUDDIES.find((b) => defaultName(b.id) === lead)!.id;
  expect(pull(ledgerOf([starter(id, 0, '2026-11-01')]), 'buddy', 'pull', seedFor((g) => g === id), 1, '2026-11-01').refund).toBe(Math.round(PULL.buddy / 2));
  await page.evaluate((s) => { (window as unknown as { __seed: number }).__seed = s; }, seedFor((g) => g === id));
  await banner(page, 'Buddies').getByRole('button', { name: /^Pull/ }).first().click();
  await show.click();
  await expect(show.getByRole('status')).toContainText(lead);
  await expect(show.locator('.ps-dupe')).toHaveText(`×2 · +${Math.round(PULL.buddy / 2)} back`);
  await expect(show.getByText('NEW!')).toHaveCount(0);
  await page.waitForTimeout(900); // what landed, settled
  await page.screenshot({ path: `${SHOTS}/dupe-landed.png` });
  await show.getByRole('button', { name: 'Done' }).click();

  // A tall older character twice (the same roll twice: the second a duplicate), then the Collection: ×2 on each, in a row
  // kept clear above the buddy, so the tall one never runs under it.
  const tall = seedFor((g) => { const b = BUDDY.get(g)!; return !!b.art && FRAMES[g].box[3] > FRAMES[g].box[2] * 1.3; });
  const tallId = pull(ledgerOf([]), 'buddy', 'pull', tall, 1, '2026-11-01').got!;
  // Under reduced motion: no show, what landed at once (a short fade), with no tap.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 2; i++) {
    await page.evaluate((s) => { (window as unknown as { __seed: number }).__seed = s; }, tall);
    await banner(page, 'Buddies').getByRole('button', { name: /^Pull/ }).first().click();
    await expect(show).toHaveAttribute('data-phase', 'land', { timeout: 300 });
    await expect(show.getByRole('status')).toContainText(i ? '×2' : 'NEW!');
    await show.getByRole('button', { name: 'Done' }).click();
    await expect(show).toHaveCount(0);
  }
  await page.getByRole('button', { name: /^Collection/ }).click();
  for (const name of [lead, defaultName(tallId)]) {
    const tile = page.getByRole('button', { name, exact: true });
    await expect(tile.locator('.bu-count')).toHaveText('×2');
    const [c, sp] = await Promise.all([tile.locator('.bu-count').boundingBox(), tile.locator('.bu-sprite').boundingBox()]);
    expect(c!.y + c!.height, name).toBeLessThanOrEqual(sp!.y); // above the buddy, never over it
  }
  await page.getByRole('button', { name: defaultName(tallId), exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/collection-counts.png` });
});

test('an accessory pull comes in a treasure chest: its gem climbs to the rarity, the lid creaks up and stays part-open', async ({ page }) => {
  test.setTimeout(90_000);
  await setUp(page);
  const epic = seedFor((_, r) => r === 3, 'acc');
  await page.evaluate((x) => { (window as unknown as { __seed: number }).__seed = x; }, epic);
  await banner(page, 'Accessories').getByRole('button', { name: /^Pull with ticket/ }).click();
  const show = page.getByRole('dialog', { name: 'Your pull' });
  await expect(show.locator('[data-vessel="chest"]')).toBeVisible();
  await expect(show.locator('[data-vessel="egg"]')).toHaveCount(0);
  const lid = show.locator('.chest .ps-part.off'), gem = show.locator('.chest .px-a').first();
  // Grey at the drop, purple by the burst; the lid shut till then.
  await expect(gem).toHaveCSS('fill', 'rgb(154, 164, 178)');
  await expect(lid).toHaveCSS('transform', 'none');
  await expect(show).toHaveAttribute('data-phase', 'burst', { timeout: 3000 });
  await expect(gem).toHaveCSS('fill', 'rgb(176, 124, 255)');
  await page.waitForTimeout(470); // the lid up and settling, the light pouring out, the chest not yet dimmed
  await page.screenshot({ path: `${SHOTS}/chest-epic-open.png` });
  await expect(show).toHaveAttribute('data-phase', 'land');
  await expect(show.getByRole('status')).toContainText(/^Epic /);
  await page.waitForTimeout(1300);
  // Settled part-open (up and tipped back, not flown off), and the chest dimmed behind what it held.
  const m = (await lid.evaluate((el) => getComputedStyle(el).transform)).match(/^matrix\(([^)]+)\)$/)![1].split(',').map(Number);
  expect(m[5]).toBeLessThan(-20); // up
  expect(m[1]).toBeLessThan(-0.1); // tipped back
  await expect(lid).toHaveCSS('opacity', '1');
  expect(Number(await show.locator('.chest .ps-part.rest .ps-ink').evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
  await page.screenshot({ path: `${SHOTS}/chest-epic-landed.png` });
  await show.getByRole('button', { name: 'Done' }).click();
  await expect(show).toHaveCount(0);
});
