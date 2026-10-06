// Headless WebKit harness for UX walkthroughs at iPhone 13 mini size.
// Usage (from the repo root, after `npm ci`):
//   import { open } from './.claude/skills/auditing-gym-tracker-ux/harness.mjs';
//   const h = await open({ out: '.superpowers/ux-audit/S2', history: 'month', program: true });
// history: 'none' | 'week' | 'month' | 'year'. program: build the default program first.
//   await h.tap('Log set', h.page.getByRole('button', { name: 'Save' }));
//   await h.shot('after-save'); console.log(h.report()); await h.close();
// Env: BASE (default: the deployed site), OUT. Never seed real data: the
// fixture below is generated, synthetic and deterministic.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { webkit, devices } = require('@playwright/test');

const HEADER = 'date,exercise,as_written,set,weight_lb,reps,rir,flags,note,source';
const DAYS = {
  A: [['Bench Press', 135, 8], ['Lat Pulldown', 110, 10], ['Seated Cable Row', 120, 10], ['Cable Curl', 40, 12]],
  B: [['Leg Press', 270, 10], ['Romanian Deadlift', 155, 8], ['Seated Leg Curl', 90, 12], ['Plank', 0, 45, 'hold']],
  C: [['Overhead Press', 85, 8], ['Pull-up', 0, 8], ['Lateral Raise', 20, 12], ['Triceps Pushdown', 50, 12]],
};
const SPAN = { none: 0, week: 7, month: 30, year: 365 };

// Three sessions a week (Mon/Wed/Fri) rotating A/B/C, with slow progression.
export function fixture(today, history = 'month') {
  const rows = [], end = new Date(`${today}T12:00:00`);
  let k = 0;
  for (let d = SPAN[history]; d >= 1; d--) {
    const day = new Date(end); day.setDate(end.getDate() - d);
    if (![1, 3, 5].includes(day.getDay())) continue;
    const iso = day.toISOString().slice(0, 10), plan = DAYS['ABC'[k++ % 3]], weeks = Math.floor((SPAN[history] - d) / 7);
    for (const [name, w, r, flag = ''] of plan)
      for (let s = 1; s <= 3; s++)
        rows.push(`${iso},${name},,${s},${w ? w + 5 * Math.floor(weeks / 3) : 0},${r - (s === 3 ? 1 : 0)},,${flag},,sample`);
  }
  return [HEADER, ...rows].join('\n');
}

export async function open({ program = false, out = process.env.OUT ?? '.superpowers/ux-audit', history = 'month', today = '2026-10-05', time = '18:00:00', base = process.env.BASE ?? 'https://krystade.github.io/gym-tracker/' } = {}) {
  mkdirSync(out, { recursive: true });
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13 Mini'], viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const log = [], counts = { taps: 0, keys: 0, scrolls: 0, dialogs: 0 };
  // Native confirm()/alert() is a finding in itself (standards E): record it, then accept.
  page.on('dialog', (d) => { counts.dialogs++; log.push({ act: 'dialog', type: d.type(), message: d.message() }); void d.accept(); });
  // Pin the date, then let time flow: a paused fake clock stalls IndexedDB-driven re-renders.
  await page.clock.install({ time: new Date(`${today}T${time}`) });
  await page.goto(base);
  await page.clock.resume();
  const nav = (t) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: t, exact: true });
  if (history !== 'none') {
    await nav('Data').click();
    await page.getByLabel('Import CSV').setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture(today, history)) });
    await page.getByText(/Imported/).waitFor();
    await nav('Today').click();
    await page.evaluate(() => scrollTo(0, 0));
  }
  if (program) { // build the default program, then return to Today
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    await page.getByRole('button', { name: 'Build program' }).click();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await page.evaluate(() => scrollTo(0, 0));
  }
  // Every user action goes through one of these so the counts are honest.
  // "Visible" means above the fixed tab bar, not merely inside the viewport.
  const inView = async (loc) => {
    const b = await loc.boundingBox(); if (!b) return false;
    const bar = await page.evaluate(() => document.querySelector('nav.tabs')?.getBoundingClientRect().top ?? innerHeight);
    return b.y >= 0 && b.y + b.height <= bar;
  };
  const h = {
    page, nav,
    async tap(label, loc) {
      const visible = await inView(loc); if (!visible) { counts.scrolls++; await loc.scrollIntoViewIfNeeded(); }
      const b = await loc.boundingBox();
      await loc.click(); counts.taps++;
      log.push({ act: 'tap', label, visibleWithoutScroll: visible, target: b && { w: Math.round(b.width), h: Math.round(b.height) } });
    },
    async type(label, loc, text) {
      const visible = await inView(loc); if (!visible) { counts.scrolls++; await loc.scrollIntoViewIfNeeded(); }
      await loc.fill(text); counts.taps++; counts.keys += text.length;
      log.push({ act: 'type', label, text, visibleWithoutScroll: visible });
    },
    async shot(name, opts = {}) { const path = `${out}/${name}.png`; await page.screenshot({ path, ...opts }); log.push({ act: 'shot', path }); return path; },
    // Mechanical measurements of the current screen: small targets, type scale,
    // spacing scale, and low-contrast text. Feed these to findings as evidence.
    measure: () => page.evaluate(() => {
      const bar = document.querySelector('nav.tabs')?.getBoundingClientRect().top ?? innerHeight;
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const bg = (el) => { for (; el; el = el.parentElement) { const c = rgb(getComputedStyle(el).backgroundColor); if (c.length === 3 || c[3] > 0) return c.slice(0, 3); } return [255, 255, 255]; };
      const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < bar; };
      const targets = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role=button]')].filter(shown).map((el) => {
        const r = el.getBoundingClientRect(); return { name: name(el), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top) };
      });
      const texts = [...document.querySelectorAll('body *')].filter((el) => shown(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const sizes = {}, low = [];
      for (const el of texts) {
        const cs = getComputedStyle(el), px = parseFloat(cs.fontSize); sizes[px] = (sizes[px] || 0) + 1;
        const a = lum(rgb(cs.color).slice(0, 3)), b = lum(bg(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const large = px >= 24 || (px >= 18.5 && +cs.fontWeight >= 700);
        if (ratio < (large ? 3 : 4.5)) low.push({ text: name(el), ratio: +ratio.toFixed(2), px });
      }
      const spacing = {};
      for (const el of document.querySelectorAll('body *')) { if (!shown(el)) continue; const cs = getComputedStyle(el);
        for (const p of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) { const v = parseFloat(cs[p]); if (v > 0) spacing[v] = (spacing[v] || 0) + 1; } }
      return { visibleHeight: Math.round(bar), under44: targets.filter((t) => t.w < 44 || t.h < 44), under24: targets.filter((t) => t.w < 24 || t.h < 24), targets: targets.length, fontSizes: sizes, spacing, lowContrast: low };
    }),
    note(text) { log.push({ act: 'note', text }); },
    report() { return { ...counts, steps: log }; },
    save(name = 'report') { writeFileSync(`${out}/${name}.json`, JSON.stringify(h.report(), null, 2)); },
    close: () => browser.close(),
  };
  return h;
}
