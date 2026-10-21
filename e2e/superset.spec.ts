import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// Supersets, noticed from alternating lifts (no taps), at the 13 mini's 375×812 with its notch (insets faked as in e2e/records).
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/superset';
mkdirSync(SHOTS, { recursive: true });
test.use({ serviceWorkers: 'block' });

async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) return route.abort();
    if (!['document', 'stylesheet'].includes(req.resourceType())) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

/** Nothing scrolls sideways, every field is 16px or more, and the superset's line and button fit and are big enough to tap. */
async function fits(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`scrolls sideways: ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll('input:not([type=hidden], [type=checkbox], [type=radio], [type=range]), select, textarea')) {
      if (el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${el.getAttribute('aria-label')} under 16px`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('.superset-line button, .rest-timer button')) if (el.offsetHeight < 44) out.push(`${el.textContent} is ${el.offsetHeight}px tall`);
    for (const el of document.querySelectorAll('.superset-line, .superset-line *, .superset-mark')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}

/**
 * A set on `card` at `at` (the clock is held there; a time alone is on Oct 16): with weight and reps the first time, as the
 * form keeps them after.
 */
async function logSet(page: Page, card: Locator, at: string, weight?: string) {
  if (weight) {
    await card.getByRole('textbox', { name: 'Weight' }).fill(weight);
    await card.getByRole('textbox', { name: 'Reps' }).fill('12');
  }
  await page.clock.pauseAt(new Date(at.includes('T') ? at : `2026-10-16T${at}`));
  await card.getByRole('button', { name: /^Add set/ }).click();
}

/** The card the switch brought up: focused, its top at the top of the screen, its Add set in view above the timer's bar. */
async function cameUp(page: Page, card: Locator) {
  await expect(card.locator('.card-head .link')).toBeFocused();
  expect((await card.boundingBox())!.y).toBeLessThan(TOP + 140);
  const add = (await card.getByRole('button', { name: /^Add set/ }).boundingBox())!;
  expect(add.y).toBeGreaterThanOrEqual(TOP);
  expect(add.y + add.height).toBeLessThanOrEqual((await page.locator('.rest-timer').boundingBox())!.y);
}

test('two lifts alternated become a pair: a switch to the other card, the full rest after the round; “Not a superset” goes back for the day', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sat').trim())).toBe(`${TOP}px`);
  const curl = await addCard(page, 'Cable Curl'), push = await addCard(page, 'Cable Pushdown');
  const rest = page.getByRole('timer', { name: 'Rest' }), sw = page.getByRole('timer', { name: 'Switch' });
  const lines = page.locator('.superset-line');

  // Curl, then a pushdown a minute later: nothing says superset yet.
  await logSet(page, curl, '18:30:00', '40');
  await expect(rest).toContainText('2:00');
  await logSet(page, push, '18:31:00', '50');
  await expect(rest).toContainText('2:00');
  await expect(lines).toHaveCount(0);

  // Back to curls after the rest: it's a pair. A short switch, and the pushdown card comes up.
  await logSet(page, curl, '18:33:30');
  await expect(sw).toContainText('0:15');
  await expect(rest).toHaveCount(0);
  await expect(curl.locator('.superset-line')).toHaveText(/^Superset with Cable Pushdown/);
  await expect(push.locator('.superset-line')).toHaveText(/^Superset with Cable Curl/);
  await cameUp(page, push);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1-switch.png` });
  // Its “?” says why the switch is short.
  const why = (w: string) => page.getByRole('dialog', { name: `Why this ${w}` }).locator('li');
  await sw.getByRole('button', { name: 'Why this switch is 0:15' }).click();
  // His switch so far (the trials’ 0:45 moved by today’s 1:00), less the set itself.
  await expect(why('switch')).toHaveText(['Your switchfrom 1 timed, set included0:55', 'Less the set itself−40 s', 'Switch0:15']);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/1b-switch-why.png` });
  await page.keyboard.press('Escape');

  // The pushdown ends the round: the full rest.
  await logSet(page, push, '18:34:30');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/2-full-rest.png` });

  // History marks the day's grouped lifts.
  await goto(page, 'History');
  const day = page.locator('details.day').first();
  await expect(day.getByRole('button', { name: /^Cable Curl/ })).toContainText('Superset with Cable Pushdown');
  await expect(day.getByRole('button', { name: /^Cable Pushdown/ })).toContainText('Superset with Cable Curl');
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/3-history.png` });
  await goto(page, 'Today');

  // A switch running, then "Not a superset": it becomes the curl's full rest, and the lines go.
  await logSet(page, curl, '18:37:00');
  await expect(sw).toContainText('0:17');
  await page.clock.fastForward(5_000);
  await push.getByRole('button', { name: 'Not a superset' }).click();
  await expect(rest).toContainText('1:55');
  // Its “?” now explains the full rest.
  await rest.getByRole('button', { name: 'Why this rest is 2:00' }).click();
  await expect(why('rest')).toHaveText(['Research defaultsmall lift2:00']);
  await page.keyboard.press('Escape');
  await expect(lines).toHaveCount(0);
  // Alternating on: plain rests from here.
  await logSet(page, push, '18:38:00');
  await expect(rest).toContainText('2:00');
  await logSet(page, curl, '18:40:30');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);
  await expect(lines).toHaveCount(0);

  // Remembered for the day: after a reload, and in History.
  await page.clock.resume();
  await page.reload();
  await expect(page.locator('[data-card="cable curl"]')).toBeVisible();
  await expect(lines).toHaveCount(0);
  await goto(page, 'History');
  await expect(page.locator('details.day').first().getByRole('button', { name: /^Cable Curl/ })).toBeVisible();
  await expect(page.locator('.superset-mark')).toHaveCount(0);
});

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
// Synthetic: last week's session of the same three lifts, imported without times, so each card has its Last and target lines.
const LAST_WEEK = ['Cable Curl,,{n},40,12', 'Cable Pushdown,,{n},50,12', 'Face Pull,,{n},30,12']
  .flatMap((r) => [1, 2, 3].map((n) => `2026-10-09,${r.replace('{n}', String(n))},,,,sample`));

test('a tri-set: a switch after each of the first two lifts, the full rest after the third', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...LAST_WEEK].join('\n')) });
  await expect(page.getByText(`✓ Imported ${LAST_WEEK.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  const curl = await addCard(page, 'Cable Curl'), push = await addCard(page, 'Cable Pushdown'), pull = await addCard(page, 'Face Pull');
  const rest = page.getByRole('timer', { name: 'Rest' }), sw = page.getByRole('timer', { name: 'Switch' });

  await logSet(page, curl, '18:30:00', '40');
  await logSet(page, push, '18:31:00', '50');
  await logSet(page, pull, '18:32:00', '30');
  await expect(rest).toContainText('2:00');

  await logSet(page, curl, '18:34:30');
  await expect(sw).toContainText('0:15');
  await cameUp(page, push);
  await expect(curl.locator('.superset-line')).toHaveText(/^Superset with Cable Pushdown and Face Pull/);
  await logSet(page, push, '18:35:30');
  await expect(sw).toContainText('0:15');
  await cameUp(page, pull);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/4-tri-set.png` });
  await logSet(page, pull, '18:36:30');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);

  // Three more rounds: the cards grow, and the one that comes up still has its Add set clear of the bar.
  // Each round's switches move his switch (today's so far): 0:17, then 0:18.
  for (const [a, b, c, sws] of [['18:39:00', '18:40:00', '18:41:00', '0:17'], ['18:43:30', '18:44:30', '18:45:30', '0:18'], ['18:48:00', '18:49:00', '18:50:00', '0:18']]) {
    await logSet(page, curl, a);
    await expect(sw).toContainText(sws);
    await cameUp(page, push);
    await logSet(page, push, b);
    await expect(sw).toContainText(sws);
    await cameUp(page, pull);
    await logSet(page, pull, c);
    await expect(rest).toContainText('2:00');
  }
  await expect(pull.getByRole('list', { name: 'Sets for Face Pull' }).getByRole('listitem')).toHaveCount(5);
  await expect(pull.locator('.card-last')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/5-tri-set-round-5.png` });
});

test('last session’s superset holds from the first round; done separately today, it goes', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  const rest = page.getByRole('timer', { name: 'Rest' }), sw = page.getByRole('timer', { name: 'Switch' });
  const lines = page.locator('.superset-line');
  /** A new day: the clock moved on and the app opened again, with the day's two cards added. */
  async function day(date: string) {
    if (date !== '2026-10-02') {
      await page.clock.resume();
      await page.clock.setSystemTime(new Date(`${date}T18:00:00`));
      await page.reload();
    }
    return [await addCard(page, 'Cable Curl'), await addCard(page, 'Cable Pushdown')];
  }

  // Oct 2: the pair, noticed once the curls come back round.
  let [curl, push] = await day('2026-10-02');
  await expect(lines).toHaveCount(0);
  await logSet(page, curl, '2026-10-02T18:30:00', '40');
  await expect(rest).toContainText('2:00');
  await logSet(page, push, '2026-10-02T18:31:00', '50');
  await logSet(page, curl, '2026-10-02T18:33:30');
  await expect(sw).toContainText('0:15');
  await logSet(page, push, '2026-10-02T18:34:30');
  await expect(rest).toContainText('2:00');

  // Oct 9, the same two lifts: a superset before the first set, and the first curl switches to the pushdown.
  [curl, push] = await day('2026-10-09');
  await expect(curl.locator('.superset-line')).toHaveText(/^Superset with Cable Pushdown/);
  await expect(push.locator('.superset-line')).toHaveText(/^Superset with Cable Curl/);
  await logSet(page, curl, '2026-10-09T18:30:00', '40');
  await expect(sw).toContainText('0:19');
  await expect(rest).toHaveCount(0);
  await cameUp(page, push);
  await fits(page);
  await page.screenshot({ path: `${SHOTS}/6-carried-first-round.png` });
  await logSet(page, push, '2026-10-09T18:31:00', '50');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);
  await logSet(page, curl, '2026-10-09T18:33:30');
  await expect(sw).toContainText('0:19');
  await logSet(page, push, '2026-10-09T18:34:30');
  await expect(rest).toContainText('2:00');

  // Oct 16: carried again, so the first curl switches; a second curl instead says they're done separately today.
  [curl, push] = await day('2026-10-16');
  await expect(lines).toHaveCount(2);
  await logSet(page, curl, '2026-10-16T18:30:00', '40');
  await expect(sw).toContainText('0:20');
  await logSet(page, curl, '2026-10-16T18:32:30');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);
  await expect(lines).toHaveCount(0);
  await logSet(page, push, '2026-10-16T18:35:00', '50');
  await expect(rest).toContainText('2:00');
  await logSet(page, push, '2026-10-16T18:37:30');
  await expect(rest).toContainText('2:00');
  await expect(sw).toHaveCount(0);
  await expect(lines).toHaveCount(0);
});
