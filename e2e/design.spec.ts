import { expect, test } from '@playwright/test';
import { goto, statsSheet } from './nav';
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
  // Sunday, trained: no session left this week, so a muscle short of its target is behind ("under").
  await page.clock.install({ time: new Date('2026-10-04T18:00:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  await logBench(page, '135', '10');
  await goto(page, 'Stats');
  await statsSheet(page, 'muscles');
  const icon = page.locator('.mrow[aria-label^="Calves:"] .mstat.under b');
  await expect(icon).toBeVisible();
  const [fg] = await style(page, '.mrow[aria-label^="Calves:"] .mstat.under b', ['color']);
  const bg = await icon.evaluate((el) => getComputedStyle(el.closest('.card, .sheet') ?? document.body).backgroundColor);
  expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
});

test('input borders are visible (3:1), and a pressed chip stands out from the rest (3:1) with no border', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByRole('searchbox', { name: 'Search exercises' }).fill('Bench Press');
  await page.getByRole('button', { name: 'Bench Press', exact: true }).click();
  const [border, fill] = await style(page, 'input[aria-label="Weight"], input', ['border-top-color', 'background-color']);
  const surface = await page.locator('.card').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(ratio(border, fill), 'input border vs input fill').toBeGreaterThanOrEqual(3);
  expect(ratio(border, surface), 'input border vs card').toBeGreaterThanOrEqual(3);
  // Chips are borderless tonal pills (the 2026-10-17 redesign): the label identifies one, and the pressed fill shows its state.
  const [chipFill, chipText] = await style(page, '.chip:not([aria-pressed="true"])', ['background-color', 'color']);
  expect(ratio(chipText, chipFill), 'un-pressed chip label vs its fill').toBeGreaterThanOrEqual(4.5);
  await page.getByRole('group', { name: 'Energy' }).getByRole('button', { name: '3' }).click();
  const [pressedFill, pressedText] = await style(page, '.chip[aria-pressed="true"]', ['background-color', 'color']);
  expect(ratio(pressedFill, chipFill), 'pressed chip vs un-pressed').toBeGreaterThanOrEqual(3);
  expect(ratio(pressedText, pressedFill), 'pressed chip label vs its fill').toBeGreaterThanOrEqual(4.5);
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

test('Today: the header clears the Ready tile, arrows are readable and 44px, the disabled save reads as disabled', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-02T18:00:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fri, Oct 2' })).toBeVisible();
  const gap = await page.evaluate(() => {
    const head = document.querySelector('.today-head')!.getBoundingClientRect(), w = document.querySelector('.ready-card')!.getBoundingClientRect();
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

test('sheets slide up and their backdrop fades in, a pressed button scales; all of it is off under reduced motion', async ({ browser }) => {
  // The thread sheet needs two accounts; its classes on a probe element read the same rules.
  const motion = async (reducedMotion: 'reduce' | 'no-preference') => {
    const ctx = await browser.newContext({ reducedMotion, viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add exercise' })).toBeVisible();
    const out = await page.evaluate(() => {
      const read = (cls: string) => { const el = document.createElement('section'); el.className = cls; document.body.append(el); const cs = getComputedStyle(el); const r = { name: cs.animationName, ms: parseFloat(cs.animationDuration) * 1000 }; el.remove(); return r; };
      const b = getComputedStyle(document.querySelector('button')!);
      return { sheet: read('sheet'), backdrop: read('sheet-backdrop'), press: b.transitionProperty };
    });
    await ctx.close();
    return out;
  };
  const on = await motion('no-preference');
  expect(on.sheet).toEqual({ name: 'sheet-up', ms: 240 });
  expect(on.backdrop).toEqual({ name: 'fade-in', ms: 240 });
  expect(on.press).toContain('transform');
  const off = await motion('reduce');
  expect(off.sheet.name).toBe('none');
  expect(off.backdrop.name).toBe('none');
  expect(off.press).not.toContain('transform');
});
