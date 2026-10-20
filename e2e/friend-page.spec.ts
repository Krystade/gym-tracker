import { mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { account, befriend, iso, log, session, signedIn, type Seeded } from './seed';

// A friend's page inside Friends (round 18) against the local emulators: synthetic accounts and numbers only (e2e/seed.ts).
// Today at 18:00 (Sunday when today is a Monday, so yesterday is in the same week).
const now = new Date(new Date().setHours(18, 0, 0, 0));
const T = new Date(now.getDay() === 1 ? now.getTime() - 864e5 : now.getTime());
const at = (daysAgo: number, h: number, m = 0) => { const d = new Date(T.getTime() - daysAgo * 864e5); d.setHours(h, m, 0, 0); return d; };
const SHOTS = 'screenshots/friend-page';
mkdirSync(SHOTS, { recursive: true });
const crew = (page: Page) => page.getByRole('region', { name: 'Crew' });
const TOP = 47;
test.use({ serviceWorkers: 'block' });
async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? 34 : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

/** You, and a friend who's stronger at nothing in particular: you both squat and bench over the 8 weeks, each from your own start. */
async function pair(request: APIRequestContext) {
  const [me, fr] = await Promise.all([account(request, `me${Math.random().toString(36).slice(2, 8)}`), account(request, `fr${Math.random().toString(36).slice(2, 8)}`)]);
  const mine = [
    ...session(at(40, 17), [['Barbell Squat', [[185, 5], [185, 5]]], ['Bench Press', [[155, 5]]]]),
    ...session(at(20, 17), [['Barbell Squat', [[195, 5], [195, 5]]], ['Bench Press', [[160, 5]]]]),
    ...session(at(3, 17), [['Barbell Squat', [[205, 5], [205, 5]]], ['Bench Press', [[160, 5]]]]),
  ];
  const theirs = [
    ...session(at(41, 9), [['Barbell Squat', [[95, 5], [95, 5]]], ['Bench Press', [[65, 8]]]]),
    ...session(at(27, 9), [['Barbell Squat', [[105, 5]]], ['Pull Up', [[0, 6]]]]),
    ...session(at(12, 9), [['Barbell Squat', [[110, 5]]]]),
    ...session(at(1, 9), [['Barbell Squat', [[115, 5], [115, 5]]], ['Bench Press', [[75, 8]]]]),
    ...session(at(0, 17, 40), [['Bench Press', [[75, 8], [80, 6]]], ['Cable Fly', [[20, 12], [20, 12]]]]),
  ];
  const month = iso(T).slice(0, 7);
  await Promise.all([
    log(request, me, mine),
    log(request, fr, theirs, { goal: 2, status: 'Deload week', prs: { [month]: [`app|${iso(T)}|bench press|2`] } }),
  ]);
  await befriend(request, me, fr);
  return { me, fr };
}
const open = (browser: Browser, who: Seeded, width = 375) => signedIn(browser, who, T, async (page) => {
  await page.setViewportSize({ width, height: 812 });
  await notched(page);
});

test('a friend’s page opens inside Friends from what the phone keeps, compares only each one’s own change, and its board opens a day', async ({ browser, request }, info) => {
  const { me, fr } = await pair(request);
  const page = await open(browser, me);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Cable Fly', { timeout: 15_000 });

  // Opening the page reads nothing: it's built from the line the list already has.
  const reads: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith('http://127.0.0.1:8080/')) reads.push(`${r.url()} ${r.postData() ?? ''}`); });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  const fp = page.getByRole('region', { name: `@${fr.name}`, exact: true });
  await expect(fp.getByRole('heading', { name: `@${fr.name}`, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Viewing a friend' })).toHaveCount(0);
  expect((await fp.getByRole('heading', { level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(TOP);

  await expect(fp.getByRole('list', { name: 'This week' })).toContainText('2 of 2 this week');
  await expect(fp.getByRole('list', { name: 'This week' })).toContainText('PR1 this week');
  await expect(fp).toContainText('Deload week');
  // LIVE: their last set was at 17:49.
  const pill = fp.locator('.fp-live');
  await expect(pill).toHaveText('LIVE');
  expect((await pill.boundingBox())!.y).toBeGreaterThanOrEqual((await fp.locator('.fp-ring').boundingBox())!.y + 92);
  await expect(fp.getByRole('article', { name: /^Now, Push/ })).toContainText('80 × 6');

  // You and them: percentages against each one's own start, and no load at all.
  const shared = fp.getByRole('region', { name: `You and @${fr.name}` });
  await expect(shared.locator('.fp-vs')).toHaveCount(2);
  await expect(shared.locator('.fp-vs').first()).toContainText('Barbell Squat');
  await expect(shared.getByRole('img', { name: 'You +11%' })).toBeVisible();
  await expect(shared.getByRole('img', { name: `@${fr.name} +21%` })).toBeVisible();
  await expect(shared).not.toContainText(/\b(95|115|185|205|lb)\b/);

  // The board: 8 weeks, today's tile with its count and its PR; a tap opens that day's session.
  const boardCard = fp.getByRole('region', { name: 'Last 8 weeks' });
  await expect(boardCard.locator('.fp-week')).toHaveCount(8);
  const todayTile = boardCard.getByRole('button', { name: /Push, 4 sets, PR, training now$/ });
  await expect(todayTile).toHaveText('4');
  const tile = (await todayTile.evaluate((el) => { const s = getComputedStyle(el); return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), color: s.color }; }));
  expect(tile).toEqual({ size: 19, weight: 700, color: 'rgb(255, 255, 255)' });
  expect(await todayTile.evaluate((el) => (el as HTMLElement).offsetWidth)).toBeGreaterThanOrEqual(44); // laid out, not mid stamp-in
  const yesterday = boardCard.locator('.fp-week').last().getByRole('button', { name: /Legs.*, 3 sets$/ }); // this week's row
  await yesterday.click();
  await expect(yesterday).toHaveAttribute('aria-pressed', 'true');
  await expect(boardCard.locator('.fp-picked')).toContainText('115 × 5');
  await expect(fp.getByRole('region', { name: 'Recent PRs' })).toContainText('Bench Press80 × 6Today');
  // Nothing of their log or settings is read to open it (what the app reads anyway for lists and news isn't the page's).
  expect(reads.filter((r) => r.includes(`users/${fr.uid}/`)), 'their log read on opening the page').toEqual([]);
  expect(await noSideScroll(page)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/friend-375.png` });
  await page.screenshot({ path: `${SHOTS}/friend-375-full.png`, fullPage: true });
  await info.attach('friend', { path: `${SHOTS}/friend-375.png`, contentType: 'image/png' });

  // Their whole log only when asked for: Stats reads it, Back comes back to the page, Friends back to the list.
  await fp.getByRole('button', { name: 'Stats', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Chest' })).toBeDisabled();
  expect(reads.some((u) => u.includes(fr.uid))).toBe(true);
  await page.getByRole('button', { name: `@${fr.name}` }).first().click();
  await fp.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button', { name: /Bench Press/ }).first()).toBeVisible();
  await page.getByRole('button', { name: `@${fr.name}` }).first().click();
  await fp.getByRole('button', { name: 'Friends', exact: true }).click();
  await expect(crew(page)).toBeVisible();
  // Another tab leaves their page; Friends then shows the list.
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Today' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Friends' }).click();
  await expect(crew(page)).toBeVisible();
});

test('a friend’s page at 320 wide: nothing spills sideways', async ({ browser, request }) => {
  const { me, fr } = await pair(request);
  const page = await open(browser, me, 320);
  const card = crew(page).getByTestId(`crew-${fr.name}`);
  await expect(card).toContainText('Cable Fly', { timeout: 15_000 });
  await card.getByRole('button', { name: `@${fr.name}`, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Last 8 weeks' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/friend-320-full.png`, fullPage: true });
});
