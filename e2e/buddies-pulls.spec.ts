import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';
import { audit, notched, type Allow } from './layout';
import { iso } from './seed';
import { CHOOSE, PULL } from '../src/domain/buddies/gacha';

// Gym Buddies stage 5 (plan §16.10): pulls and the wardrobe. With points from sets logged today: the pull sheet's odds and pity,
// an accessory pull revealed and worn, choosing one saved up for, the wardrobe sheet from a card's slot, and a buddy wearing a
// held item (on its head anchor), an aura, a plinth and a backdrop. On the 13 mini, notch and home indicator included.

const SHOTS = 'screenshots/buddies';
const WORN: Allow[] = [];
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source,logged_at';
const points = async (page: Page) => Number((await page.locator('.bu-wallet').textContent())!.match(/^[\d,]+/)![0].replace(/,/g, ''));
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });
/** Nothing wider than the screen, and nothing overlapping, cut off or under the bars. */
const fits = async (page: Page, what: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), what).toBeLessThanOrEqual(375);
  expect((await audit(page, WORN)).map((f) => `${f.kind}: ${f.a} × ${f.b ?? ""} ${f.detail}`), what).toEqual([]);
};

test('pull, choose and wear: odds and pity shown, a pull revealed and worn, a held item on the head', async ({ page }) => {
  await notched(page);
  await page.goto('/');
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const first = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${first}` }).click();
  await expect(page.getByRole('region', { name: `${first}’s card` })).toBeVisible();

  // 120 sets today: 120 points for the sets and 5 for the session, before any achievements.
  const today = iso(new Date());
  const rows = Array.from({ length: 120 }, (_, i) => `${today},Bench Press,,${i + 1},135,8,,,,sample,${today}T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...rows].join('\n')) });
  await expect(page.getByText('✓ Imported 120 new sets')).toBeVisible();
  await goto(page, 'Buddies');
  await expect.poll(() => points(page)).toBeGreaterThanOrEqual(125);
  const start = await points(page);

  // The pull sheet: odds, what's left, pity; the banner switch; a ticket needs a ticket.
  await page.getByRole('region', { name: 'Get more' }).getByRole('button', { name: /^Pull/ }).click();
  const pull = page.getByRole('dialog', { name: /^(Pull|Use a ticket|Choose one)$/ }); // named for its mode
  await expect(pull.getByRole('table', { name: 'Odds, buddies' })).toContainText('60%');
  await expect(pull.getByRole('row', { name: /^Legendary 1%/ })).toBeVisible();
  await expect(pull.getByText(/^Rare or better within 10 pulls · epic or better within 40\./)).toBeVisible();
  await pull.getByRole('button', { name: 'Ticket' }).click();
  await expect(pull.getByRole('button', { name: 'No tickets yet' })).toBeDisabled();
  await pull.getByRole('button', { name: 'Pull', exact: true }).click();
  await pull.getByRole('button', { name: 'Accessories' }).click();
  await expect(pull.getByRole('table', { name: 'Odds, accessories' })).toBeVisible();
  await pull.getByRole('button', { name: `Pull for ${PULL.acc} points` }).click();
  const shown = pull.getByRole('status');
  await expect(shown).toContainText(/(Common|Uncommon|Rare|Epic|Legendary) (held|aura|plinth|backdrop)/);
  await expect(pull.getByText(/^Rare or better within (9|10) pulls?/)).toBeVisible(); // one pull nearer, or reset by a rare
  // The reveal lasts under a second: its animations, delays included, end by 1,000 ms.
  expect(await shown.evaluate((el) => Math.max(0, ...[...el.querySelectorAll('*')].map((x) => {
    const s = getComputedStyle(x);
    if (s.animationName === 'none') return 0;
    return parseFloat(s.animationDuration) * 1000 + parseFloat(s.animationDelay) * 1000;
  })))).toBeLessThanOrEqual(1000);
  await expect.poll(() => page.locator('.bu-sheet-wallet').textContent()).toContain(`${(start - PULL.acc).toLocaleString('en-US')}`);
  await fits(page, 'the pull sheet');
  await page.screenshot({ path: `${SHOTS}/pull-sheet.png` });
  const got = (await shown.locator('b').textContent())!;
  await shown.getByRole('button', { name: 'Wear it' }).click();
  await expect(pull).toHaveCount(0);
  const card = page.getByRole('region', { name: `${first}’s card` });
  await expect(card.getByRole('list', { name: 'Wearing' }).getByRole('button', { name: new RegExp(`: ${got}\\. Change$`) })).toBeVisible();

  // Choosing, saved up for: a held item, a common aura, plinth and backdrop (whichever the pull didn't land on).
  let chosen = 0;
  for (const [banner, name] of [['Accessories', 'Short sword'], ['Accessories', 'Mint aura'], ['Accessories', 'Stump'], ['Accessories', 'Dawn']] as const) {
    await page.getByRole('region', { name: 'Get more' }).getByRole('button', { name: /^Choose/ }).click();
    const ch = sheet(page, 'Choose one');
    await ch.getByRole('button', { name: banner }).click();
    if (got === name) { await ch.getByRole('button', { name: 'Done' }).click(); continue; }
    await ch.getByRole('button', { name, exact: true }).click();
    await ch.getByRole('button', { name: `Choose ${name} for ${CHOOSE.acc[0]} points` }).click();
    await expect(ch.getByRole('status')).toContainText(name);
    chosen++;
    await ch.getByRole('button', { name: 'Done' }).click();
  }

  // The wardrobe: each slot's sheet lists what you own of it; a tap puts it on.
  for (const [slot, name] of [['Held', 'Short sword'], ['Aura', 'Mint aura'], ['Plinth', 'Stump'], ['Backdrop', 'Dawn']] as const) {
    await card.getByRole('button', { name: new RegExp(`^${slot}: .*\\. Change$`) }).click();
    const w = page.getByRole('dialog', { name: new RegExp(`’s ${slot.toLowerCase()}$`) });
    await expect(w.getByRole('button', { name: 'None' })).toBeVisible();
    await w.getByRole('button', { name, exact: true }).click();
    await expect(w.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (slot === 'Held') await fits(page, 'the wardrobe sheet');
    await w.getByRole('button', { name: 'Done' }).click();
    await expect(card.getByRole('button', { name: `${slot}: ${name}. Change` })).toBeVisible();
  }
  // Worn: the sword's sprite on the hero (drawn), the aura on the sprite, the stump and the dawn backdrop.
  const hero = card.locator('.bu-hero');
  await expect(hero).toHaveClass(/w-bg-dawn/);
  await expect(hero.locator('.bu-sprite')).toHaveClass(/w-aura-mint/);
  await expect(hero.locator('.bu-plinth.w-plinth-wood')).toBeVisible();
  const held = hero.locator('img.bu-held[data-held="d105"]');
  await expect(held).toBeVisible();
  expect(await held.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(16);
  // The sword rests on the head: its foot within the sprite's top half, and inside the hero.
  const [h, s, b] = await Promise.all([held.boundingBox(), hero.locator('.bu-sprite').boundingBox(), hero.boundingBox()]);
  expect(h!.y + h!.height).toBeGreaterThan(s!.y);
  expect(h!.y + h!.height).toBeLessThan(s!.y + s!.height / 2);
  expect(h!.y).toBeGreaterThanOrEqual(b!.y);
  // Spent: one pull and the choices; nothing below zero.
  expect(await points(page)).toBeLessThanOrEqual(start - PULL.acc - chosen * CHOOSE.acc[0]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await fits(page, 'the card, worn');
  await page.screenshot({ path: `${SHOTS}/worn.png` });

  // What's worn is kept: a reload shows the same.
  await page.reload();
  await goto(page, 'Buddies');
  await expect(page.getByRole('region', { name: `${first}’s card` }).getByRole('button', { name: 'Held: Short sword. Change' })).toBeVisible();
});
