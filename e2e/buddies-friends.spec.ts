import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { BUDDIES, ACCESSORIES, defaultName } from '../src/domain/buddies/roster';
import { publish, summaryOf } from './fixtures/compare';
import { check, clean, notched } from './layout';
import { goto } from './nav';
import { account, befriend, log, session, signedIn } from './seed';

// Gym Buddies stage 6 (plan §16.8): a friend's buddies ride their Compare summary. Their lead on Crew, their roster strip and
// lifetime points on their page (a buddy opens read-only), and Side by side: your lead and theirs, no winner. Synthetic only.
const T = new Date(new Date().setHours(18, 0, 0, 0));
test.use({ serviceWorkers: 'block' });
const SHOTS = 'screenshots/buddies';
mkdirSync(SHOTS, { recursive: true });

// Their lead: a grit buddy whose numbers tie Power and Size, so its best is Power (the tie goes to the order, not the trait).
const lead = BUDDIES.find((b) => b.trait === 'grit')!, other = BUDDIES.find((b) => b.rarity === 2 && b.id !== lead.id)!;
const held = ACCESSORIES.find((a) => a.slot === 'held')!;
const bud = {
  lead: lead.id, pts: 1530,
  r: [
    { i: lead.id, l: 21, s: [16, 16, 15, 10], e: [held.id, null, 'plinth-wood', 'bg-gym'] },
    { i: other.id, l: 5, s: [3, 6, 4, 0], e: [null, 'aura-mint', null, null] },
    { i: 'not-a-buddy', l: 99, s: [9, 9, 9, 9], e: [null, null, null, null] }, // a newer app's: dropped
  ],
};

test('a friend’s buddies: their lead on Crew, their roster and points, a buddy read-only, and Side by side with no winner', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const at = new Date(T); at.setHours(17, 0, 0, 0);
  const theirs = session(at, [['Bench Press', [[135, 5], [135, 5]]]]);
  await log(request, fr, theirs, { goal: 2 });
  await publish(request, fr, { ...summaryOf(theirs, T, 2), bud } as never);
  await befriend(request, me, fr);
  const page = await signedIn(browser, me, T, notched);

  // Your first buddy, so Side by side has yours to set beside theirs.
  await goto(page, 'Buddies');
  const offer = page.getByRole('group', { name: 'Your first buddy' }).getByRole('button');
  const mine = (await offer.first().locator('b').textContent())!;
  await offer.first().click();
  await page.getByRole('button', { name: `Pick ${mine}` }).click();
  await expect(page.getByRole('region', { name: `${mine}’s card` })).toBeVisible();

  // Crew: their lead and its Lv beside their name.
  await goto(page, 'Friends');
  const card = page.getByRole('region', { name: 'Crew' }).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Bench Press', { timeout: 20_000 });
  await expect(card.getByRole('img', { name: `Lead buddy ${defaultName(lead.id)}, Lv 21` })).toBeVisible();
  await card.screenshot({ path: `${SHOTS}/crew-lead.png` });

  // Their page: the strip (the unknown buddy dropped) and lifetime points.
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  const mates = fp.getByRole('region', { name: /buddies/ });
  await expect(mates.getByRole('heading')).toContainText('1,530 points earned');
  const strip = mates.getByRole('list').getByRole('button');
  await expect(strip).toHaveCount(2);
  await expect(strip.first()).toHaveAccessibleName(`${defaultName(lead.id)}, Lv 21, lead`);

  // Side by side: both leads, four stats each, each one's best named; nobody ahead.
  const sbs = fp.getByRole('region', { name: /^Side by side/ });
  await sbs.scrollIntoViewIfNeeded();
  await expect(sbs).toContainText(mine);
  await expect(sbs).toContainText(`@${fr.name}’s${defaultName(lead.id)}Lv 21 · best at Power`);
  const rows = sbs.getByRole('list').getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAccessibleName(`Power: yours 0, @${fr.name}’s 16`);
  await expect(sbs).not.toContainText(/win|ahead|lead[s ]|beat|vs/i);
  const found: string[] = [];
  await check(page, info, found, 'friend-side-by-side', [], '.sbs');
  await page.evaluate(() => { document.querySelector('.sbs')!.scrollIntoView({ block: 'start' }); scrollBy(0, -60); });
  await page.screenshot({ path: `${SHOTS}/side-by-side.png` });

  // A buddy of theirs, read only: its card, and no button in it but Done.
  await strip.nth(1).click();
  const sheet = page.getByRole('dialog', { name: `@${fr.name}’s ${defaultName(other.id)}` });
  await expect(sheet.getByRole('heading', { name: defaultName(other.id) })).toBeVisible();
  await expect(sheet.getByRole('list', { name: 'Stats' }).getByRole('listitem')).toHaveText(['3Power', '6Size', '4Grit', '0Stamina']);
  await expect(sheet).toContainText('Wearing: Mint aura (aura).');
  await expect(sheet.getByRole('button')).toHaveText(['Done']);
  await check(page, info, found, 'friend-buddy-card', [{ kind: 'overlap', a: '.bu-floor', b: '.bu-sprite img', why: 'a buddy stands on its floor shadow, as on its plinth' }]);
  await page.screenshot({ path: `${SHOTS}/friend-buddy-card.png` });
  clean(found);
});

test('a friend with no buddies yet (or an older app): no chip, no strip, no Side by side', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [me, fr] = await Promise.all(['me', 'fr'].map((n) => account(request, `${n}${Math.random().toString(36).slice(2, 8)}`)));
  const at = new Date(T); at.setHours(17, 0, 0, 0);
  const theirs = session(at, [['Bench Press', [[135, 5]]]]);
  await log(request, fr, theirs, { goal: 2 });
  await publish(request, fr, summaryOf(theirs, T, 2));
  await befriend(request, me, fr);
  const page: Page = await signedIn(browser, me, T);
  const card = page.getByRole('region', { name: 'Crew' }).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Bench Press', { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await expect(card.locator('.bud-chip')).toHaveCount(0);
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.locator('.fp-stats [data-tile="calendar"]')).toBeVisible();
  await expect(fp.locator('.fb-buddies, .sbs')).toHaveCount(0);
});
