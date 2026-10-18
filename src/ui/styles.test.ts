import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// iOS zooms the whole page into a field whose text is under 16px when it takes focus, and leaves it zoomed: the fixed
// tab bar and status backdrop then sit where the zoom put them. e2e/devices.spec.ts measures every field it can reach;
// this covers the ones it can't (the CSV fallback, a field behind a failed share) by reading the rules themselves.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = Object.fromEntries([...css.matchAll(/(--fs-[a-z]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
const px = (v: string): number | undefined => {
  // A clamp() is never smaller than its floor (the stepper's numerals scale with the field, from 18px).
  const c = /^clamp\(\s*([^,]+),/.exec(v.trim());
  if (c) return px(c[1]);
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
  return m ? vars[m[1]] : /^(\d+(?:\.\d+)?)px$/.test(v.trim()) ? parseFloat(v) : undefined;
};

/** Each rule whose selector lands on a field, with the font size it sets. */
function fieldRules() {
  const out: { selector: string; size: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const field = m[1].split(',').map((s) => s.trim()).filter((s) => /(^|[\s>+~])(input|select|textarea)(?![\w-])(?!\[type=(checkbox|radio|range)\])/.test(s) && !/::?[\w-]+$/.test(s.replace(/:(focus|focus-visible|disabled|not\([^)]*\))/g, '')));
    const size = /(?:^|;)\s*font-size:\s*([^;]+)/.exec(m[2])?.[1] ?? /(?:^|;)\s*font:\s*(?:\d+\s+)?(\d+px)/.exec(m[2])?.[1];
    if (field.length && size) out.push({ selector: field.join(', '), size });
  }
  return out;
}

describe('fields in styles.css', () => {
  it('finds the field rules it checks (the base rule among them)', () => {
    expect(fieldRules().map((r) => r.selector)).toContain('input, select, textarea');
  });
  it('sets no field’s text under 16px', () => {
    expect(fieldRules().filter((r) => !(px(r.size) !== undefined && px(r.size)! >= 16)).map((r) => `${r.selector}: ${r.size}`)).toEqual([]);
  });
});
