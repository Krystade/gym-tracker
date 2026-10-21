import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// A layout audit for the 13 mini (375×812, notch 47 / home indicator 34): what a person sees overlapping, cut off, too small to
// tap, or stuck under the bars, found from the page's own boxes instead of from screenshots. One call audits the screen as it is
// now; the spec walks every screen and state (e2e/layout-audit.spec.ts).
//
// What counts as painted: an element's border box when it draws something (a background, a border, a ring, an outline, or it is
// an image, an icon or a field), grown by its rings (box-shadows with no blur) and outline; and each line of text, as the browser
// lays its glyphs out. Two painted things overlap when their boxes cross by a pixel or more each way and neither holds the other.
// Everything is measured against the boxes that clip it (overflow other than visible on the containing-block chain).

export const TOP = 47, BOTTOM = 34;

/** env(safe-area-inset-*) as the 13 mini reports it, written into the page's CSS as it loads (desktop browsers report 0). */
export async function notched(page: Page) {
  const inset = (s: string) => s.replace(/env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^)]*)?\)/g, (_, side: string) => `${side === 'top' ? TOP : side === 'bottom' ? BOTTOM : 0}px`);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith('http://127.0.0.1')) { if (process.env.LAYOUT_LOG) console.log('aborted', req.url()); return route.abort(); }
    // Only the stylesheet (index.html has no env()): a document served through the route counts as public to Chromium,
    // which then refuses its calls to the emulators on this machine (local network access).
    if (req.resourceType() !== 'stylesheet') return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, body: inset(await res.text()) });
  });
}

export type Kind =
  | 'overlap' // (a) two painted things cross
  | 'clipped' // (b) text cut off by a box that hides its overflow
  | 'spill' // (b) text running out of the pill, button or card it sits on
  | 'truncated' // (b) an ellipsis hiding part of a text that has a number in it
  | 'offscreen' // (b) painted past the left or right edge of the screen
  | 'side-scroll' // (b) the page scrolls sideways
  | 'target' // (c) a tap target under 44 px either way, with no hit area round it making up the difference
  | 'notch' // (d) text or a control under the status bar with the page at the top
  | 'under-bar' // (d) text or a control the page can't scroll out from under the tab bar (and the rest bar on it)
  | 'home' // (d) a control on a sheet or bar inside the home indicator's strip
  // The render check (renderCheck, below): stricter rules for a screen built to the stat-tile contract (Stats v2's tiles and sheets).
  | 'text-text' // two lines of text cross (SVG <text> included), by more than 1×3 px
  | 'text-chart' // text crosses a chart, an icon, a bar, a meter or a dot it isn't part of, by more than 1×2 px
  | 'escape' // text sits partly outside its nearest container (a tile, a sheet, a button, a chip)
  | 'clip' // text cut by a box that hides its overflow, or any ellipsis
  | 'tap'; // a button or link under 44×44, whatever hit area it has

/** An intended finding: kind, the element (a CSS selector it matches), for an overlap the other one, and why it's meant. */
export interface Allow { kind: Kind; a: string; b?: string; why: string }

export interface Finding { kind: Kind; a: string; b?: string; detail: string }

// Stacking the design means, each with its reason. Matched against both orders of a pair.
export const ALLOW: Allow[] = [
  { kind: 'overlap', a: '.ring, .ring *', b: '.avatar, .avatar *, .char-face, .char-face *', why: 'a progress ring is drawn round its avatar by design (an inset: 0 layer over the same box)' },
  { kind: 'overlap', a: '.tab-dot', b: '.tabs svg', why: 'the tab bar’s news dot sits on its tab’s icon corner, inside the tab (a badge)' },
  { kind: 'overlap', a: '.unread-dot, .unread-dot *', b: 'button > svg', why: 'an unread count is a badge on its own button’s icon, inside the button' },
  { kind: 'overlap', a: '.fd-corner, .fd-corner *', b: '.fd-ringwrap > .ring, .fd-ringwrap > .ring *, .fd-ringwrap > .avatar, .fd-ringwrap > .avatar *', why: 'a feed avatar’s done/live corner badge sits on its own ring, inside the ring’s box' },
  { kind: 'overlap', a: '.st-ringwrap > .ring, .st-ringwrap > .ring *', b: '.st-rc, .st-rc *', why: 'the week’s count is centred in the hole of its 76px ring (a 1-or-2-digit count out of the goal fits inside it)' },
  { kind: 'overlap', a: '.mband', b: '.mbar, .mtrack', why: 'the muscle-volume band brackets the bar it marks (3px above and below it, by design)' },
];

/** Every finding on the screen as it is now; `extra` adds allowances for this screen only. */
export async function audit(page: Page, extra: Allow[] = []): Promise<Finding[]> {
  // Animations run to their end first, so nothing is measured mid-slide; the page goes to its top, where sticky bars sit in flow.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (t && t.iterations !== Infinity) try { a.finish(); } catch { /* not finishable */ }
    }
  });
  return page.evaluate(({ allow, sat, sab, size }) => {
    // At the top of the page, in this same task: a smooth scroll the app started can't move it between here and the measuring.
    scrollTo({ top: 0, left: 0, behavior: 'instant' });
    type R = { l: number; t: number; r: number; b: number };
    type Item = { el: Element; ps?: string; raw: R; own: R; vis: R; text: boolean; layer: Element | null; clipBy: Element | null };
    const out: { kind: string; a: string; b?: string; detail: string }[] = [];
    // The phone's screen, not innerWidth: a mobile browser widens its layout viewport to fit a page that spills sideways.
    const vw = size.width, vh = size.height;
    const css = (el: Element) => getComputedStyle(el);
    const rr = (d: DOMRect | R): R => ('left' in d ? { l: d.left, t: d.top, r: d.right, b: d.bottom } : d);
    const cut = (a: R, b: R): R => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
    const w = (a: R) => a.r - a.l, h = (a: R) => a.b - a.t;
    const empty = (a: R) => w(a) <= 0.5 || h(a) <= 0.5;
    const n = (x: number) => Math.round(x * 10) / 10;
    const name = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label.slice(0, 40)}"` : ''}`;
    };
    const box = (a: R) => `[${n(a.l)},${n(a.t)} ${n(w(a))}×${n(h(a))}]`;
    const alpha = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    const shown = (el: Element) => {
      const e = el as Element & { checkVisibility?: (o: object) => boolean };
      if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      const s = css(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0;
    };
    // Hidden for screen readers only: a 1px box clipped to nothing.
    const srOnly = (el: Element) => { for (let p: Element | null = el; p; p = p.parentElement) { const r = p.getBoundingClientRect(); if (r.width <= 1 && r.height <= 1 && css(p).overflow !== 'visible') return true; if (css(p).clipPath === 'inset(50%)') return true; } return false; };
    const inSvg = (el: Element) => el.parentElement?.closest('svg') != null;
    const REPLACED = new Set(['IMG', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER', 'IFRAME', 'PICTURE']);

    // The box an element's descendants are cut to, and the nearest element doing it, along the containing-block chain (the body's
    // sideways clip is left to the screen's edge, below).
    const establishes = (s: CSSStyleDeclaration) => s.transform !== 'none' || (s.translate !== 'none' && s.translate !== '') || s.filter !== 'none' || /paint|strict|content/.test(s.contain);
    function clipOf(el: Element, self: boolean): { r: R; by: Element | null } {
      let r: R = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity }, by: Element | null = null;
      const apply = (p: Element) => {
        if (p === document.body) return;
        const s = css(p), cx = s.overflowX !== 'visible', cy = s.overflowY !== 'visible';
        if (!cx && !cy) return;
        const b = p.getBoundingClientRect(), hp = p as HTMLElement;
        const l = b.left + hp.clientLeft, t = b.top + hp.clientTop;
        r = cut(r, { l: cx ? l : -Infinity, r: cx ? l + hp.clientWidth : Infinity, t: cy ? t : -Infinity, b: cy ? t + hp.clientHeight : Infinity });
        by ??= p;
      };
      if (self) apply(el);
      let pos = css(el).position;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const s = css(p);
        if (pos === 'fixed' && !establishes(s)) continue;
        if (pos === 'absolute' && s.position === 'static' && !establishes(s)) continue;
        apply(p);
        pos = s.position === 'fixed' || s.position === 'absolute' ? s.position : 'static';
      }
      return { r, by };
    }
    // What the person can see of a box: cut by its own clipping boxes, then by the screen (a fixed layer top and bottom too).
    const onScreen = (el: Element, a: R) => cut(a, { l: 0, r: vw, t: layerOf(el) ? 0 : -Infinity, b: layerOf(el) ? vh : Infinity });
    // The fixed layer an element paints in (the fixed ancestor-or-self), or null for the page.
    const layerOf = (el: Element): Element | null => { for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) if (css(p).position === 'fixed') return p; return null; };
    // A sticky bar pinned to the bottom paints over the page as a fixed one does.
    const stickyBottom = (el: Element) => { for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) { const s = css(p); if (s.position === 'sticky' && s.bottom !== 'auto') return p; } return null; };

    // Rings: box-shadows with no blur and no inset paint a solid band round the box; an outline does too.
    function grown(el: Element, b: R): R {
      const s = css(el);
      const g = { l: 0, t: 0, r: 0, b: 0 };
      if (s.boxShadow && s.boxShadow !== 'none') {
        for (const part of s.boxShadow.split(/,(?![^(]*\))/)) {
          if (/inset/.test(part)) continue;
          const nums = (part.replace(/rgba?\([^)]*\)|#[0-9a-f]+|oklch\([^)]*\)/gi, '').match(/-?[\d.]+px|\b0\b/g) ?? []).map((x) => parseFloat(x));
          const [x = 0, y = 0, blur = 0, spread = 0] = nums;
          if (blur > 0) continue; // a soft drop shadow: decoration, not a band
          const col = part.match(/rgba?\([^)]*\)/)?.[0] ?? '';
          if (col && alpha(col) === 0) continue;
          g.l = Math.max(g.l, spread - x); g.r = Math.max(g.r, spread + x); g.t = Math.max(g.t, spread - y); g.b = Math.max(g.b, spread + y);
        }
      }
      if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) {
        const o = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset || '0');
        g.l = Math.max(g.l, o); g.r = Math.max(g.r, o); g.t = Math.max(g.t, o); g.b = Math.max(g.b, o);
      }
      return { l: b.l - g.l, t: b.t - g.t, r: b.r + g.r, b: b.b + g.b };
    }
    const paints = (el: Element, ps?: string) => {
      if (!ps && REPLACED.has(el.tagName)) return true;
      const s = getComputedStyle(el, ps);
      if (alpha(s.backgroundColor) > 0 || s.backgroundImage !== 'none') return true;
      if (s.boxShadow !== 'none' && !s.boxShadow.split(/,(?![^(]*\))/).every((p) => /inset/.test(p))) return true;
      if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) return true;
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' && alpha(s.getPropertyValue(`border-${side.toLowerCase()}-color`)) > 0) return true;
      }
      return false;
    };

    // A modal open (a backdrop over the whole screen): only what's above it is looked at.
    const fixedAll = [...document.querySelectorAll('body *')].filter((el) => css(el).position === 'fixed' && shown(el));
    const z = (el: Element) => parseInt(css(el).zIndex) || 0;
    const backdrop = fixedAll.find((el) => { const r = el.getBoundingClientRect(); return r.width >= vw * 0.95 && r.height >= vh * 0.95 && alpha(css(el).backgroundColor) > 0; });
    const above = (layer: Element | null) => !backdrop || (layer != null && layer !== backdrop && z(layer) > z(backdrop));

    const items: Item[] = [];
    const all = [...document.querySelectorAll('body *')].filter((el) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'BR', 'NOSCRIPT'].includes(el.tagName) && !inSvg(el));
    const visible = new Map<Element, boolean>();
    for (const el of all) {
      const ok = shown(el) && !srOnly(el);
      visible.set(el, ok);
      if (!ok) continue;
      const layer = layerOf(el);
      if (!above(layer)) continue;
      if (el.classList.contains('status-backdrop')) continue;
      const b = el.getBoundingClientRect();
      if (b.width >= 0.5 && b.height >= 0.5 && paints(el)) {
        const raw = grown(el, rr(b)), c = clipOf(el, false), own = cut(raw, c.r);
        items.push({ el, raw, own, vis: onScreen(el, own), text: false, layer, clipBy: c.by });
      }
      // An absolutely placed ::before or ::after that paints (a ring, a dot, a hairline): its box from its offsets.
      for (const ps of ['::before', '::after']) {
        const s = getComputedStyle(el, ps);
        if (s.content === 'none' || s.content === 'normal' || s.display === 'none' || s.position !== 'absolute' || parseFloat(s.opacity) === 0 || !paints(el, ps)) continue;
        if (css(el).position === 'static') continue; // placed against some other box: rare here, left out
        const he = el as HTMLElement, pl = b.left + he.clientLeft, pt = b.top + he.clientTop, pw = he.clientWidth, ph = he.clientHeight;
        const px = (v: string) => (v === 'auto' ? null : parseFloat(v));
        const [L, Rt, Tp, Bt, W, Hh] = [px(s.left), px(s.right), px(s.top), px(s.bottom), px(s.width), px(s.height)];
        const l = L != null ? pl + L : Rt != null && W != null ? pl + pw - Rt - W : null;
        const r = Rt != null ? pl + pw - Rt : L != null && W != null ? pl + L + W : null;
        const t = Tp != null ? pt + Tp : Bt != null && Hh != null ? pt + ph - Bt - Hh : null;
        const bo = Bt != null ? pt + ph - Bt : Tp != null && Hh != null ? pt + Tp + Hh : null;
        if (l == null || r == null || t == null || bo == null || r - l < 0.5 || bo - t < 0.5) continue;
        const c = clipOf(el, true), raw = { l, t, r, b: bo }, own = cut(raw, c.r);
        items.push({ el, ps, raw, own, vis: onScreen(el, own), text: false, layer, clipBy: c.by });
      }
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? '')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const c = clipOf(el, true);
        // A line's glyph box is the font's full ascent and descent, taller than a tight line-height: two lines set 1px apart
        // would read as crossing. The line box (centred on the glyphs) is what the design spaces.
        const lh = parseFloat(css(el).lineHeight);
        for (const d of range.getClientRects()) {
          if (d.width < 0.5 || d.height < 0.5) continue;
          const raw = rr(d);
          if (lh > 0 && lh < h(raw)) { const mid = (raw.t + raw.b) / 2; raw.t = mid - lh / 2; raw.b = mid + lh / 2; }
          const own = cut(raw, c.r);
          items.push({ el, raw, own, vis: onScreen(el, own), text: true, layer, clipBy: c.by });
        }
      }
    }

    const matches = (el: Element, sel?: string) => !!sel && (el.matches(sel) || el.closest(sel) === el);
    const allowed = (kind: string, a: Element, b?: Element) => allow.some((x) => x.kind === kind && (b
      ? (matches(a, x.a) && matches(b, x.b)) || (matches(b, x.a) && matches(a, x.b))
      : matches(a, x.a)));
    const seen = new Set<string>();
    const add = (kind: string, a: Element, detail: string, b?: Element, aps = '', bps = '') => {
      if (allowed(kind, a, b)) return;
      const an = name(a) + aps, bn = b ? name(b) + bps : '';
      const key = `${kind}|${an}|${bn}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ kind, a: an, ...(b && { b: bn }), detail });
    };

    // (a) Overlaps: painted things in the same layer (the page, or one fixed bar), or in two fixed layers, crossing by 1px+ each way.
    const live = items.filter((i) => !empty(i.vis));
    live.sort((p, q) => p.vis.t - q.vis.t);
    const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      for (let j = i + 1; j < live.length && live[j].vis.t < p.vis.b - 1; j++) {
        const q = live[j];
        if (related(p.el, q.el)) continue;
        // The page against a fixed bar is scrolling under it: that's (d), not an overlap.
        if ((p.layer == null) !== (q.layer == null)) continue;
        if (p.layer == null && (stickyBottom(p.el) != null) !== (stickyBottom(q.el) != null)) continue;
        const x = cut(p.vis, q.vis);
        if (w(x) < 1 || h(x) < 1) continue;
        // Two lines of the same text run, or text in a label over its own control's text: the same words, not a collision.
        if (p.text && q.text && p.el.parentElement === q.el.parentElement && Math.abs(p.raw.t - q.raw.t) < 1) continue;
        add('overlap', p.el, `${box(p.vis)} × ${box(q.vis)}: ${n(w(x))}×${n(h(x))}px`, q.el, p.ps, q.ps);
      }
    }

    // (b) The page scrolling sideways; painted things past either edge; text clipped, spilling, or an ellipsis hiding a number.
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (sw > vw + 0.5) out.push({ kind: 'side-scroll', a: 'page', detail: `scrollWidth ${sw} > ${vw}` });
    const scrollerX = (el: Element) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = css(p); if (/auto|scroll/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p; } return null; };
    for (const i of items) {
      if (scrollerX(i.el)) continue;
      // Past the screen's edge (the body's sideways clip hides the rest), unless a box of its own cuts it short of the edge.
      if (!empty(i.own) && (i.own.r > vw + 1 || i.own.l < -1)) {
        add('offscreen', i.el, `${box(i.own)} past the screen (0–${vw})`);
        continue;
      }
      if (i.text) {
        const lost = { l: i.own.l - i.raw.l, r: i.raw.r - i.own.r, t: i.own.t - i.raw.t, b: i.raw.b - i.own.b };
        const s = css(i.el);
        const clamp = s.getPropertyValue('-webkit-line-clamp');
        // An ellipsis cut is the truncation check's (below); a scroller's hidden part scrolls into view.
        const by = i.clipBy;
        if (Math.max(lost.l, lost.r, lost.t, lost.b) > 1 && !(clamp && clamp !== 'none') && by && css(by).textOverflow !== 'ellipsis' && !/auto|scroll/.test(css(by).overflowX + css(by).overflowY)) {
          add('clipped', i.el, `${box(i.raw)} cut to ${box(i.vis)} by ${name(by)}`);
        }
        // Out of the pill or card it sits on: the nearest painted ancestor that isn't the page's own background.
        for (let p = i.el as Element | null; p && p !== document.body; p = p.parentElement) {
          if (!paints(p) || p.tagName === 'MAIN' || REPLACED.has(p.tagName)) continue;
          const pb = rr(p.getBoundingClientRect());
          const o = Math.max(pb.l - i.own.l, i.own.r - pb.r, pb.t - i.own.t, i.own.b - pb.b);
          // Glyph boxes run a little past a tight line box (descenders, a tall line-height): 2px of slack.
          if (o > 2 && css(p).overflow === 'visible') add('spill', i.el, `${box(i.own)} out of ${name(p)} ${box(pb)} by ${n(o)}px`);
          break;
        }
      }
    }
    for (const el of all) {
      if (!visible.get(el) || !above(layerOf(el))) continue;
      const s = css(el);
      if (s.textOverflow !== 'ellipsis' || el.scrollWidth <= el.clientWidth + 1) continue;
      // A name cut short is the design; a number cut short (not digits inside a username) or a text squeezed to nothing isn't.
      const text = el.textContent ?? '';
      const number = /(?<![\p{L}_\d])\d+(?:[.,]\d+)*(?![\p{L}_\d])/u.test(text);
      const gone = el.clientWidth < 24 && el.scrollWidth > 2 * el.clientWidth;
      if (number || gone) add('truncated', el, `${el.scrollWidth}px of text in ${el.clientWidth}px${gone ? ' (squeezed out)' : ''}`);
    }

    // (d) Under the bars. The bottom chrome: the fixed navigation bar at the screen's foot, and fixed bars across the screen
    // stacked on it (the rest bar). A sheet is not chrome: it's checked against the home indicator instead.
    const bars = fixedAll.filter((el) => { const r = el.getBoundingClientRect(); return el.matches('nav, [role=navigation]') && r.bottom >= vh - 1 && above(el); });
    for (let grew = true; grew;) {
      grew = false;
      for (const el of fixedAll) {
        if (bars.includes(el) || !above(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw * 0.9 && r.height < vh * 0.3 && bars.some((b) => Math.abs(b.getBoundingClientRect().top - r.bottom) <= 1)) { bars.push(el); grew = true; }
      }
    }
    const barTop = Math.min(vh, ...bars.map((b) => b.getBoundingClientRect().top));
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    const control = (el: Element) => el.matches('button, a[href], input, select, textarea, summary, [role=button], [role=link], [role=tab], label');
    for (const i of live) {
      const meaningful = i.text || control(i.el) || REPLACED.has(i.el.tagName);
      if (!meaningful) continue;
      // The status bar: at the top of the page, nothing to read or tap starts above the inset (sheets and bars included).
      if (i.vis.t < sat - 0.5 && i.vis.b > 0 && !bars.includes(i.layer as Element)) add('notch', i.el, `${box(i.vis)} under the ${sat}px status bar`);
      if (i.layer == null && !stickyBottom(i.el)) {
        // The page: scrolled to its end, nothing is left under the bottom bars.
        const atEnd = i.vis.b - maxScroll;
        if (atEnd > barTop + 0.5 && i.vis.t - maxScroll < vh) add('under-bar', i.el, `${box(i.vis)} ends at ${n(atEnd)} scrolled to the end; the bars start at ${n(barTop)}`);
      } else if (i.layer && !bars.includes(i.layer) && control(i.el) && i.vis.b > vh - sab + 0.5) {
        add('home', i.el, `${box(i.vis)} inside the ${sab}px home-indicator strip`);
      }
    }

    // A bar that sticks to the top (a picker's search, the profile bar): stuck, with the page scrolled under it, its words and
    // controls sit below the status bar, not under it.
    const y00 = scrollY;
    for (const st of all) {
      if (!visible.get(st) || !above(layerOf(st))) continue;
      const s = css(st);
      if (s.position !== 'sticky' || s.top === 'auto') continue;
      const top0 = st.getBoundingClientRect().top + scrollY;
      const y = Math.min(Math.max(0, document.documentElement.scrollHeight - vh), top0 + 300);
      if (y <= top0) continue;
      scrollTo({ top: y, behavior: 'instant' });
      if (Math.abs(st.getBoundingClientRect().top - parseFloat(s.top || '0')) > 1) continue; // not stuck at this scroll
      for (const el of [st, ...st.querySelectorAll('*')]) {
        if (!visible.get(el)) continue;
        const rects = [...el.childNodes].filter((t) => t.nodeType === Node.TEXT_NODE && /\S/.test(t.textContent ?? '')).flatMap((t) => { const g = document.createRange(); g.selectNodeContents(t); return [...g.getClientRects()]; });
        if (control(el) || REPLACED.has(el.tagName)) rects.push(el.getBoundingClientRect());
        for (const d of rects) if (d.height > 0.5 && d.top < sat - 0.5 && d.bottom > 0) add('notch', el, `${box(rr(d))} under the ${sat}px status bar with the page scrolled to ${n(y)} (a sticky bar)`);
      }
    }
    scrollTo({ top: y00, behavior: 'instant' });

    // (c) Tap targets. Under 44px either way, its hit area is probed 22px out from its middle (a ::before can make one up).
    const TARGETS = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [role=radio]';
    const y0 = scrollY;
    for (const el0 of document.querySelectorAll(TARGETS)) {
      let el: Element = el0;
      const lab = el.tagName === 'INPUT' ? (el as HTMLInputElement).labels?.[0] : undefined;
      if (lab && visible.get(lab) && (!visible.get(el) || lab.contains(el))) {
        // A field hidden under its styled label, or a checkbox inside its row's label: the label is what's tapped.
        el = lab;
      } else if (!visible.get(el) && el.tagName === 'INPUT') continue;
      else if (!visible.get(el) || el.closest('[inert], [aria-hidden=true]') || (el as HTMLButtonElement).disabled) continue;
      if (!above(layerOf(el))) continue;
      const b = el.getBoundingClientRect();
      if (b.width >= 44 - 0.5 && b.height >= 44 - 0.5) continue;
      if (b.width < 1 || b.height < 1) continue;
      if (el.closest('.sr-only')) continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const c = el.getBoundingClientRect();
      const cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2;
      const probes: [number, number][] = [];
      if (c.width < 43.5) probes.push([cx - 21.5, cy], [cx + 21.5, cy]);
      if (c.height < 43.5) probes.push([cx, cy - 21.5], [cx, cy + 21.5]);
      const hits = probes.map(([x, y]) => document.elementFromPoint(x, y));
      // A tap on a field's label is a tap on the field.
      const labels = [...((el0 as HTMLInputElement).labels ?? [])];
      const mine = (hit: Element | null) => !!hit && (hit === el || el.contains(hit) || hit === el0 || labels.some((l) => l === hit || l.contains(hit)));
      if (!hits.every(mine)) {
        const lost = probes.filter((_, k) => !mine(hits[k])).map(([x, y]) => `${n(x - c.left)},${n(y - c.top)}`);
        add('target', el, `${n(c.width)}×${n(c.height)}px; no hit at ${lost.join(' ')}`);
      }
    }
    scrollTo({ top: y0, behavior: 'instant' });
    return out;
  }, { allow: [...ALLOW, ...extra], sat: TOP, sab: BOTTOM, size: page.viewportSize() ?? { width: 375, height: 812 } }) as Promise<Finding[]>;
}

/**
 * The render check from the Stats v2 mockups (.superpowers/redesign/stats-v2/render.mjs), over what `scope` matches: text against
 * text (SVG labels too) and against charts and icons, text leaving its container, any clipped or ellipsised text, and every
 * button and link at 44×44 or more on its own (no hit-area allowance).
 */
export async function renderCheck(page: Page, scope: string): Promise<Finding[]> {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (t && t.iterations !== Infinity) try { a.finish(); } catch { /* not finishable */ }
    }
  });
  return page.evaluate((scope) => {
    const out: { kind: string; a: string; b?: string; detail: string }[] = [];
    type B = { left: number; right: number; top: number; bottom: number; width: number; height: number };
    const inter = (a: B, b: B) => ({ w: Math.min(a.right, b.right) - Math.max(a.left, b.left), h: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) });
    const name = (el: Element) => {
      const c = el instanceof SVGElement ? el.className.baseVal : typeof el.className === 'string' ? el.className : '';
      return `${el.tagName.toLowerCase()}${c.trim() ? `.${c.trim().split(/\s+/).join('.')}` : ''}`;
    };
    const f1 = (n: number) => n.toFixed(1);
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) return false;
      // Inside a closed <details>, among other things: laid out, never painted.
      const e = el as Element & { checkVisibility?: (o: object) => boolean };
      if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0' || s.clipPath === 'inset(50%)') return false;
      }
      return true;
    };
    const sr = (el: Element) => el.closest('.sr-only') != null;
    const inView = (el: Element, r: B) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (!/auto|scroll/.test(getComputedStyle(p).overflowY)) continue;
        const v = p.getBoundingClientRect();
        if (r.top < v.top - 0.5 || r.bottom > v.bottom + 0.5) return false;
      }
      return true;
    };
    const seen = new Set<string>();
    const add = (kind: string, a: string, detail: string, b?: string) => {
      const k = `${kind}|${a}|${b ?? ''}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ kind, a, ...(b && { b }), detail });
    };
    for (const root of document.querySelectorAll(scope)) {
      // Clip: text in a box that hides its overflow and has more than it shows (a sheet's scrolling body excepted), or an ellipsis.
      for (const el of [root, ...root.querySelectorAll('*')]) {
        if (el instanceof SVGElement || !shown(el) || sr(el)) continue;
        const cs = getComputedStyle(el), txt = (el.textContent ?? '').trim();
        if (/hidden|clip/.test(cs.overflowX + cs.overflowY) && txt && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) add('clip', name(el), `"${txt.slice(0, 30)}" ${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`);
        if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) add('clip', name(el), `ellipsis on "${txt.slice(0, 30)}"`);
      }
      // Text boxes: each line of each text node (its line box, as the audit measures it), and SVG <text>.
      const texts: { el: Element; node: Node; r: B; t: string }[] = [];
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        const n = tw.currentNode, el = n.parentElement!;
        if (!n.textContent?.trim() || el.closest('svg') || sr(el) || !shown(el)) continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        for (const rc of rg.getClientRects()) {
          if (rc.width <= 0.5 || rc.height <= 0.5) continue;
          const r = { left: rc.left, right: rc.right, top: rc.top, bottom: rc.bottom, width: rc.width, height: rc.height };
          if (lh > 0 && lh < rc.height) { const m = (rc.top + rc.bottom) / 2; r.top = m - lh / 2; r.bottom = m + lh / 2; r.height = lh; }
          // Scrolled out of a scroller's view (a sheet's body): not on screen now; it's checked where it scrolls into view.
          if (!inView(el, r)) continue;
          texts.push({ el, node: n, r, t: n.textContent.trim().slice(0, 28) });
        }
      }
      for (const t of root.querySelectorAll('svg text')) if (shown(t) && inView(t, t.getBoundingClientRect())) texts.push({ el: t, node: t, r: t.getBoundingClientRect(), t: (t.textContent ?? '').trim() });
      // Graphics: icons, charts, bars, meters and dots (a ring is drawn round its centre count on purpose).
      const gfx = [...root.querySelectorAll('svg')].filter((g) => !g.classList.contains('ring') && !g.parentElement?.closest('svg') && shown(g) && inView(g, g.getBoundingClientRect())).map((g) => ({ el: g as Element, r: g.getBoundingClientRect() as B }))
        .concat([...root.querySelectorAll('.st-t-new, .st-meter, .st-status-ic, .mbar, .mtrack, .cal-legend i, .avatar')].filter((e) => shown(e) && inView(e, e.getBoundingClientRect())).map((e) => ({ el: e, r: e.getBoundingClientRect() })));
      for (let i = 0; i < texts.length; i++) {
        const a = texts[i];
        for (let j = i + 1; j < texts.length; j++) {
          const b = texts[j];
          if (a.node === b.node) continue;
          const o = inter(a.r, b.r);
          if (o.w > 1 && o.h > 3) add('text-text', `"${a.t}" in ${name(a.el)}`, `${f1(o.w)}×${f1(o.h)}px`, `"${b.t}" in ${name(b.el)}`);
        }
        for (const g of gfx) {
          if (g.el.contains(a.el) || a.el.contains(g.el)) continue;
          const o = inter(a.r, g.r);
          if (o.w > 1 && o.h > 2) add('text-chart', `"${a.t}" in ${name(a.el)}`, `${f1(o.w)}×${f1(o.h)}px`, name(g.el));
        }
        // Escape: a text box must sit inside its nearest container.
        if (a.el.closest('svg')) continue;
        const box = a.el.closest('.st-tile, .st-week, .st-sheet, .st-chip, .st-cells3 > div, .st-pr, .st-behind, .more-row, button, a, .chip');
        if (box) {
          const b = box.getBoundingClientRect(), r = a.r;
          if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) add('escape', `"${a.t}" in ${name(a.el)}`, `[${f1(r.left)},${f1(r.top)} ${f1(r.width)}×${f1(r.height)}] out of [${f1(b.left)},${f1(b.top)} ${f1(b.width)}×${f1(b.height)}]`, name(box));
        }
      }
      // Taps: 44×44 on their own.
      for (const t of root.querySelectorAll('button, a[href], [role=button]')) {
        if (!shown(t) || sr(t) || (t as HTMLButtonElement).disabled) continue;
        const r = t.getBoundingClientRect();
        if (r.width < 43.5 || r.height < 43.5) add('tap', name(t), `"${(t.getAttribute('aria-label') ?? t.textContent ?? '').trim().slice(0, 24)}" ${f1(r.width)}×${f1(r.height)}`);
      }
    }
    return out;
  }, scope) as Promise<Finding[]>;
}

/** Findings as lines a failure message can show. */
export const lines = (fs: Finding[]) => fs.map((f) => `${f.kind}: ${f.a}${f.b ? ` ⨯ ${f.b}` : ''} — ${f.detail}`);

/**
 * Audits `state`, keeps its full-page PNG under screenshots/layout/<project>/, and adds its findings to `found` (the spec
 * asserts it empty at the end, so one run lists every finding rather than the first).
 */
export async function check(page: Page, info: TestInfo, found: string[], state: string, extra: Allow[] = [], strict?: string) {
  const t0 = Date.now();
  const fs = await audit(page, extra);
  // A screen built to the stat-tile contract: the render check's stricter rules too, over `strict` (or the open dialog).
  if (strict) fs.push(...await renderCheck(page, await page.locator('[role=dialog]').count() ? '[role=dialog]' : strict));
  if (process.env.LAYOUT_LOG) console.log(`${state}: ${fs.length} findings in ${Date.now() - t0} ms`);
  const dir = path.join('screenshots', 'layout', info.project.name || 'default');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${state}.png`), fullPage: true });
  found.push(...lines(fs).map((l) => `${state}: ${l}`));
  return fs;
}

export const clean = (found: string[]) => expect(found, found.join('\n')).toEqual([]);
