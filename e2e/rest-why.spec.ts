import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { goto } from './nav';

// The rest bar's "?": why this rest is its length, on the 13 mini's 375×812 with its notch (insets faked as in e2e/superset),
// and on a 320px phone.
const TOP = 47, BOTTOM = 34;
const SHOTS = 'screenshots/rest-why';
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

type B = { x: number; y: number; width: number; height: number };
const overlaps = (a: B, b: B) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** The bar's buttons are 44px taps, side by side; the popover is above the bar, on the screen, below the notch, off the tabs. */
async function fits(page: Page, timer: Locator, why: Locator) {
  const vw = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);
  const bar = (await timer.boundingBox())!, tabs = (await page.getByRole('navigation', { name: 'Sections' }).boundingBox())!;
  const buttons = await timer.locator(':scope > button, .rest-main > button').all();
  expect(buttons).toHaveLength(4); // ?, −30 s, +30 s, ×
  const boxes: B[] = [];
  for (const b of buttons) {
    const box = (await b.boundingBox())!;
    expect(box.height, `${await b.getAttribute('aria-label') ?? await b.innerText()} height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${await b.getAttribute('aria-label') ?? await b.innerText()} width`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
    for (const o of boxes) expect(overlaps(box, o)).toBe(false);
    boxes.push(box);
  }
  // The time and its words show in full, apart: nothing truncated, nothing touching.
  const time = (await timer.locator('.rest-main b').boundingBox())!, words = (await timer.locator('.rest-words').boundingBox())!;
  expect(words.x - (time.x + time.width)).toBeGreaterThanOrEqual(8);
  for (const w of await timer.locator('.rest-words > span').all()) expect(await w.evaluate((el) => el.scrollWidth - el.clientWidth), `${await w.innerText()} cut short by`).toBe(0);
  if (!(await why.count())) return;
  const pop = (await why.boundingBox())!;
  expect(pop.y + pop.height).toBeLessThanOrEqual(bar.y);
  expect(pop.y).toBeGreaterThanOrEqual(TOP);
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(vw);
  expect(overlaps(pop, tabs)).toBe(false);
  for (const b of await why.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}

async function addCard(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  return page.locator(`[data-card="${name.toLowerCase()}"]`);
}

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
// Synthetic: last week's curls, 40 × 12 (an e1RM of 56), imported without times: today's 50 is a heavy set, and rests no longer for it.
const LAST_WEEK = [1, 2, 3].map((n) => `2026-10-09,Cable Curl,,${n},40,12,,,,sample`);

test('the “?” on the rest bar says why the rest is its length, above the bar, and goes on an outside tap or × without the timer', async ({ page }) => {
  await notched(page);
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await goto(page, 'More');
  await page.getByLabel('Import CSV').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from([HEADER, ...LAST_WEEK].join('\n')) });
  await expect(page.getByText(`✓ Imported ${LAST_WEEK.length} new sets`)).toBeVisible();
  await goto(page, 'Today');
  const curl = await addCard(page, 'Cable Curl');

  // 50 × 12 at RIR 0, 89 % of the e1RM: the research default's 2:00 and +30 s for the effort; nothing for the load.
  await curl.getByRole('textbox', { name: 'Weight' }).fill('50');
  await curl.getByRole('textbox', { name: 'Reps' }).fill('12');
  await curl.getByRole('group', { name: 'RIR' }).getByRole('button', { name: '0' }).click();
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await curl.getByRole('button', { name: /^Add set/ }).click();
  const timer = page.getByRole('timer', { name: 'Rest' }), time = timer.locator('.rest-main b');
  const why = page.getByRole('dialog', { name: 'Why this rest' });
  await expect(time).toHaveText('2:30');
  await fits(page, timer, why);
  await page.screenshot({ path: `${SHOTS}/1-bar-375.png` });

  const q = timer.getByRole('button', { name: /^Why this rest is / });
  await expect(q).toHaveAccessibleName('Why this rest is 2:30');
  await expect(q).toHaveAttribute('aria-expanded', 'false');
  await q.click();
  await expect(q).toHaveAttribute('aria-expanded', 'true');
  await expect(why.locator('li')).toHaveText([
    'Research defaultsmall lift2:00',
    'RIR 0+30 s',
    'Rest2:30',
  ]);
  await expect(why.getByText('Why 2:30')).toBeVisible();
  await fits(page, timer, why);
  await page.screenshot({ path: `${SHOTS}/2-why-375.png` });

  // +30 s leaves it up and adds a line: kept for the curl from now on.
  await timer.getByRole('button', { name: '+30 s' }).click();
  await expect(time).toHaveText('3:00');
  await expect(why.locator('li').nth(2)).toHaveText('Your ±30 skept for this lift+30 s');
  await expect(why.locator('li').last()).toHaveText('Rest3:00');
  await expect(timer.getByRole('button', { name: 'Why this rest is 3:00' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3-tapped-375.png` });

  // A tap elsewhere puts it away; the timer runs on.
  await page.getByRole('heading', { level: 1 }).click();
  await expect(why).toHaveCount(0);
  await expect(timer).toBeVisible();
  // So do its × and Escape.
  await q.click();
  await why.getByRole('button', { name: 'Close' }).click();
  await expect(why).toHaveCount(0);
  await expect(timer).toBeVisible();
  await q.click();
  await page.keyboard.press('Escape');
  await expect(why).toHaveCount(0);
  await page.clock.fastForward(10_000);
  await expect(time).toHaveText('2:50');

  // A 320px phone: the bar and the popover still fit.
  await page.setViewportSize({ width: 320, height: 640 });
  await q.click();
  await fits(page, timer, why);
  await page.screenshot({ path: `${SHOTS}/4-why-320.png` });
  await page.keyboard.press('Escape');

  // The next set starts from his setting, the 2:30 the tap kept, and says what research suggests.
  await page.setViewportSize({ width: 375, height: 812 });
  const rir2 = curl.getByRole('group', { name: 'RIR' }).getByRole('button', { name: '2' });
  await expect(rir2).toHaveAttribute('aria-pressed', 'false');
  await rir2.click(); // RIR 2 moves nothing
  await curl.getByRole('button', { name: /^Add set/ }).click();
  await expect(time).toHaveText('2:30');
  await timer.getByRole('button', { name: 'Why this rest is 2:30' }).click();
  await expect(why.locator('li')).toHaveText(['Your settingResearch suggests 2:002:30']);
  await fits(page, timer, why);
  await page.screenshot({ path: `${SHOTS}/5-setting-375.png` });
  await page.keyboard.press('Escape');

  // A warm-up: its fixed rest, one line.
  await curl.getByRole('textbox', { name: 'Weight' }).fill('20');
  await curl.getByRole('button', { name: /^Details/ }).click();
  await curl.getByRole('group', { name: 'Flags' }).getByRole('button', { name: 'Warm-up' }).click();
  await curl.getByRole('button', { name: /^Add set/ }).click();
  await expect(time).toHaveText('1:00');
  await timer.getByRole('button', { name: 'Why this rest is 1:00' }).click();
  await expect(why.locator('li')).toHaveText(['Warm-upisolation lift1:00']);
  await fits(page, timer, why);
  await page.screenshot({ path: `${SHOTS}/6-warmup-375.png` });
  // × on the bar puts the timer away, and the popover with it.
  await timer.getByRole('button', { name: 'Close rest timer' }).click();
  await expect(timer).toHaveCount(0);
  await expect(why).toHaveCount(0);
});
