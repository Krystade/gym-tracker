import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// WCAG 2.x relative-luminance contrast of two computed `rgb(...)` colours.
const ratio = (a: string, b: string) => {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const style = (page: Page, sel: string, props: string[]) =>
  page.locator(sel).first().evaluate((el, ps) => { const cs = getComputedStyle(el); return ps.map((p) => cs.getPropertyValue(p)); }, props);

const logBench = async (page: Page, weight: string, reps: string) => {
  const rows = page.getByRole('list', { name: 'Sets for Bench Press' }).getByRole('listitem');
  const before = await rows.count();
  await page.getByRole('textbox', { name: 'Weight' }).fill(weight);
  await page.getByRole('textbox', { name: 'Reps' }).fill(reps);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(rows).toHaveCount(before + 1);
};

test('the error banner text is readable (4.5:1)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => { const d = document.createElement('div'); d.className = 'banner'; d.id = 'probe-banner'; d.textContent = 'Could not save'; document.body.append(d); });
  const [fg, bg] = await style(page, '#probe-banner', ['color', 'background-color']);
  expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
});

test('the "under" status icon in Stats is readable (4.5:1) on its card', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await page.clock.setFixedTime(new Date('2026-09-30T09:00:00'));
  await page.reload();
  await page.getByRole('button', { name: 'Stats' }).click();
  const icon = page.locator('.mrow[aria-label^="Calves:"] .mstat.under b');
  await expect(icon).toBeVisible();
  const [fg] = await style(page, '.mrow[aria-label^="Calves:"] .mstat.under b', ['color']);
  const bg = await icon.evaluate((el) => getComputedStyle(el.closest('.card') ?? document.body).backgroundColor);
  expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
});

test('input and un-pressed chip borders are visible (3:1); card borders stay decorative', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  const [border, fill] = await style(page, 'input[aria-label="Weight"], input', ['border-top-color', 'background-color']);
  const surface = await page.locator('.card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(ratio(border, fill), 'input border vs input fill').toBeGreaterThanOrEqual(3);
  expect(ratio(border, surface), 'input border vs card').toBeGreaterThanOrEqual(3);
  const [chipBorder] = await style(page, '.chip:not([aria-pressed="true"])', ['border-top-color']);
  expect(ratio(chipBorder, surface), 'chip border vs card').toBeGreaterThanOrEqual(3);
});

test('keyboard focus on a button shows the accent outline, and buttons have a pressed state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.tagName === 'BUTTON')) break;
  }
  const f = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return { tag: document.activeElement!.tagName, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, accent: a }; });
  expect(f.tag).toBe('BUTTON');
  expect(f.style).not.toBe('none');
  // WebKit already draws a default ring, so pin the colour and width too.
  const probe = await page.evaluate((hex) => { const d = document.createElement('i'); d.style.color = hex; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, f.accent);
  expect(f.color).toBe(probe);
  expect(f.width).toBe('2px');
  await page.screenshot({ path: 'screenshots/51-focus.png' });
  // :active is not drivable from a test; the transition that animates it is.
  const [tr] = await style(page, 'button', ['transition-property']);
  expect(tr).toContain('transform');
});

test('Today: the header clears the weigh-in card, arrows are readable and 44px, the disabled save reads as disabled', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  const gap = await page.evaluate(() => {
    const head = document.querySelector('.today-head')!.getBoundingClientRect(), w = document.querySelector('.weigh')!.getBoundingClientRect();
    return w.top - head.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(12);
  const prev = page.getByRole('button', { name: 'Previous day' });
  const box = (await prev.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const glyph = await prev.evaluate((el) => { const svg = el.querySelector('svg'); return svg ? svg.getBoundingClientRect().height : parseFloat(getComputedStyle(el).fontSize); });
  expect(glyph).toBeGreaterThanOrEqual(24);
  const save = page.getByRole('button', { name: 'Save weight' });
  await expect(save).toBeDisabled();
  const [bg, fg, op] = await style(page, 'button.primary:disabled', ['background-color', 'color', 'opacity']);
  expect(op).toBe('1');
  expect(bg).not.toBe(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')));
  expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  await page.getByRole('textbox', { name: 'Weigh-in (lb)' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/52-disabled.png' });
  await page.screenshot({ path: 'screenshots/50-today-design.png' });
});

test('a first button in a card has no extra top margin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  // A temporary card: no screen reliably opens with a wide button first.
  const m = await page.evaluate(() => {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<button class="wide" id="first">A</button><button class="wide" id="second">B</button>';
    document.body.append(c);
    return [getComputedStyle(document.getElementById('first')!).marginTop, getComputedStyle(document.getElementById('second')!).marginTop];
  });
  expect(m).toEqual(['0px', '12px']);
});

test('landscape: content is capped and centred, tabs span the width', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
  const w = await page.evaluate(() => document.querySelector('.screen')!.getBoundingClientRect().width);
  expect(w).toBeLessThanOrEqual(720);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'screenshots/49-landscape.png' });
});
