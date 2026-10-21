import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { goto, openProgram } from './nav';

type B = { x: number; y: number; width: number; height: number };
const overlaps = (a: B, b: B) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const openCurl = async (page: Page) => {
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Cable Curl');
  await page.getByRole('button', { name: /^Cable Curl/ }).first().click();
  return page.locator('[data-card="cable curl"]');
};

test('a rest timer starts on Add set, clear of the form, and starts over on the next set', async ({ page }) => {
  // The Wake Lock API, recorded: the screen stays on while the timer runs.
  await page.addInitScript(() => {
    const w = window as unknown as { locks: string[] };
    w.locks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      w.locks.push('on');
      return { release: async () => { w.locks.push('off'); }, addEventListener() {} };
    } } });
  });
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toHaveCount(0); // nothing before a set
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  // From here the clock moves only when the test moves it, so a loaded machine can't eat into the 2:00.
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  // No history for this lift: 2:00.
  await expect(timer).toContainText('2:00');
  expect(await page.evaluate(() => (window as unknown as { locks: string[] }).locks)).toEqual(['on']);
  await page.clock.fastForward(30_000);
  await expect(timer).toContainText('1:30');

  // It doesn't cover the form: not its steppers, Add set or More.
  const t = (await timer.boundingBox())!;
  for (const b of await card.locator('.set-form button').all()) {
    const box = await b.boundingBox();
    if (box) expect(overlaps(box, t), `${await b.innerText()} under the timer`).toBe(false);
  }
  await page.screenshot({ path: 'screenshots/r7-rest-timer.png' });

  await timer.getByRole('button', { name: '+30 s' }).click();
  await expect(timer).toContainText('2:00');

  // The next set ends this rest and starts the next one, with the 30 s added kept: 2:30.
  await page.clock.fastForward(45_000);
  await expect(timer).toContainText('1:15');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(timer).toContainText('2:30');

  // A tap on the bar leaves it running (owner, 2026-10-19: it sits where a thumb lands); only × puts it away, and lets the screen sleep.
  await timer.getByText('Rest', { exact: true }).click();
  await timer.locator('b').click();
  await expect(timer).toContainText('2:30');
  await timer.getByRole('button', { name: 'Close rest timer' }).click();
  await expect(timer).toHaveCount(0);
  expect((await page.evaluate(() => (window as unknown as { locks: string[] }).locks)).at(-1)).toBe('off');
});

test('the rest timer runs out to “Rest done”, then goes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  // fastForward jumps, firing the 250 ms tick once rather than ~600 renders' worth of runFor.
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await page.clock.fastForward(121_000);
  await expect(timer).toContainText('Rest done');
  await page.screenshot({ path: 'screenshots/r7-rest-done.png' });
  await page.clock.fastForward(31_000);
  await expect(timer).toHaveCount(0);
});

test('a set entered for an earlier time starts no rest timer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Previous day' }).click();
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(card.getByRole('list', { name: 'Sets for Cable Curl' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('timer', { name: 'Rest' })).toHaveCount(0);
});

test('−30 s and +30 s change the rest, and the lift starts its next rest there, after a reload too', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await card.getByRole('textbox', { name: 'Reps' }).fill('10');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await expect(timer).toContainText('Set 2 next');
  const less = timer.getByRole('button', { name: '−30 s' });
  await less.click();
  await less.click();
  await less.click();
  await expect(timer).toContainText('0:30');
  await page.screenshot({ path: 'screenshots/r16-rest-timer.png' });
  // Never under 0: the last −30 s ends it, and then there's nothing to take off.
  await less.click();
  await expect(timer).toContainText('Rest done');
  await expect(less).toHaveCount(0); // nothing to take off: its room goes to "Rest done"
  const more = timer.getByRole('button', { name: '+30 s' });
  await more.click();
  await expect(timer).toContainText('0:30');
  await more.click();
  await expect(timer).toContainText('1:00');
  // The next set rests what the timer was last set to.
  await card.getByRole('button', { name: /^Add set/ }).click();
  await expect(timer).toContainText('1:00');
  await page.reload();
  const again = page.locator('[data-card="cable curl"]');
  await again.getByRole('button', { name: /^Add set/ }).click();
  await expect(timer).toContainText('1:00');
});

test('the rest bar fits a 375 px phone: time, words, −30 s, +30 s and ×, every tap 44 px', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  const bad = await timer.evaluate((bar) => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push('page scrolls sideways');
    for (const el of bar.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) out.push(`off the side: ${el.className || el.tagName}`);
    }
    for (const b of bar.querySelectorAll<HTMLElement>('button')) if (b.offsetHeight < 44 || b.offsetWidth < 44) out.push(`${b.textContent || b.getAttribute('aria-label')} is ${b.offsetWidth}×${b.offsetHeight}`);
    const words = bar.querySelector<HTMLElement>('.rest-words span');
    if (!words || words.scrollWidth > words.clientWidth) out.push('“Rest” is cut off');
    return out;
  });
  expect(bad).toEqual([]);
});

// Owner, 2026-10-20: the last of 4 planned Cable Pushdown sets started a rest that said "set 5 next". A planned lift's last set
// names the plan's next lift instead; the last set of the day's plan starts no rest (e2e/finish).
test('the last planned set of a lift names the plan’s next lift, never a set past the plan', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  await goto(page, 'Backup');
  await page.getByLabel('Import CSV').setInputFiles(path.join(import.meta.dirname, 'fixtures', 'history.sample.csv'));
  await expect(page.getByText(/Imported 6 new/)).toBeVisible();
  await goto(page, 'Today');
  await openProgram(page);
  await page.getByRole('textbox', { name: 'Days per week' }).fill('2');
  await page.getByRole('textbox', { name: 'Sets per session' }).fill('14');
  await page.getByRole('button', { name: 'Build program' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  const rows = page.getByRole('list', { name: 'Planned exercises' }).getByRole('listitem');
  expect(await rows.count(), 'a plan of two lifts or more').toBeGreaterThanOrEqual(2);
  const names = await rows.locator('.plan-name').evaluateAll((els) => els.map((e) => e.getAttribute('data-exercise')!));
  // All but the first two skipped: the first lift's last set leads to the second; the second's, to the plan's end.
  for (let i = (await rows.count()) - 1; i >= 2; i--) await rows.nth(i).getByRole('button', { name: 'Skip' }).click();
  const timer = page.getByRole('timer', { name: 'Rest' });
  const sub = timer.locator('.rest-words');
  for (const [k, name] of names.slice(0, 2).entries()) {
    const sets = Number((await rows.nth(k).locator('.plan-count').textContent())!.split('/')[1]);
    expect(sets, `${name}: a planned count`).toBeGreaterThan(1);
    await rows.nth(k).locator('.plan-name').click();
    const card = page.locator(`[data-card="${name.toLowerCase()}"]`);
    for (let i = 1; i <= sets; i++) {
      const w = card.getByRole('textbox', { name: 'Weight' });
      if ((await w.inputValue()) === '') await w.fill('50');
      await card.getByRole('button', { name: /^Add set/ }).click();
      if (i < sets) {
        await expect(sub).toContainText(`Set ${i + 1} next`);
        await expect(card.getByRole('list', { name: `Sets for ${name}` }).getByRole('listitem')).toHaveCount(i);
      }
    }
    // The last planned set: no "Set n+1 next", and what comes next instead.
    if (k === 0) { await expect(timer.locator('.rest-next')).toHaveText(`Next ${names[1]}`); await page.screenshot({ path: 'test-results/rest-next-lift.png' }); }
    // The plan's last set: no rest at all (e2e/finish), so nothing to say a set comes next.
    else { await expect(page.getByRole('group', { name: 'Plan done' })).toBeVisible(); await expect(timer).toHaveCount(0); }
    await expect(page.locator('.rest-timer')).not.toContainText(`Set ${sets + 1} next`);
  }
  await page.screenshot({ path: 'test-results/rest-plan-done.png' });
});

// Owner, 2026-10-20: "most of the text on the timer message is cut off, I see 'Rest d…'". At 375 px the words beside the time
// had about 77 px, so "Rest done" was cut, and a lift's name would be.
test('done, the rest bar shows “Rest done” and the next lift in full at 375 px', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T18:00:00') });
  await page.goto('/');
  const card = await openCurl(page);
  await card.getByRole('textbox', { name: 'Weight' }).fill('50');
  await page.clock.pauseAt(new Date('2026-10-16T18:30:00'));
  await card.getByRole('button', { name: /^Add set/ }).click();
  const timer = page.getByRole('timer', { name: 'Rest' });
  await expect(timer).toContainText('2:00');
  await page.clock.fastForward(121_000);
  await expect(timer).toContainText('Rest done');
  const cut = () => timer.evaluate((bar) => [...bar.querySelectorAll<HTMLElement>('.rest-words > span, .rest-next')]
    .map((el) => {
      // The text's whole width, laid out uncut on one line (scrollWidth rounds, and an ellipsis can hide under it).
      const probe = el.cloneNode(true) as HTMLElement;
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', width: 'auto', maxWidth: 'none', whiteSpace: 'nowrap', overflow: 'visible' });
      el.parentElement!.append(probe);
      const whole = probe.getBoundingClientRect().width;
      probe.remove();
      const lines = Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '20'));
      return { text: el.textContent, over: whole - el.getBoundingClientRect().width * Math.max(1, lines) };
    }));
  const done = await cut();
  expect(done.length, 'words found').toBeGreaterThanOrEqual(2);
  expect(done.filter((x) => x.over > 0.5)).toEqual([]);
  // This engine's fallback font is narrower than the phone's SF Pro, where "Rest done" alone takes about 78 px and "Switch
  // done" about 92: the words need room to spare, not just to fit here (they had 77 px).
  const room = await timer.evaluate((bar) => bar.querySelector('.rest-main')!.getBoundingClientRect().right - bar.querySelector('.rest-words')!.getBoundingClientRect().left);
  expect(room, 'room for the words').toBeGreaterThanOrEqual(110);
  await page.screenshot({ path: 'test-results/rest-done-375.png' });
});
