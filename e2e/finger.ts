import type { Locator } from '@playwright/test';

/**
 * One finger's drag on `on`, as touch events (WebKit here has no Touch constructor, and Playwright's touchscreen only taps):
 * a touchstart at (x, y) in the page, `steps` touchmoves to (x + dx, y + dy), a touchend. Says which moves had their default
 * prevented, that is, what iOS would not have scrolled. Synthetic, so nothing really scrolls: only what the app does with them.
 */
export function drag(on: Locator, at: { x: number; y: number }, dx: number, dy: number, steps = 6): Promise<boolean[]> {
  return on.evaluate((el, { at, dx, dy, steps }) => {
    const ev = (type: string, x: number, y: number, down: boolean) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      const t = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY, screenX: x, screenY: y };
      Object.defineProperties(e, { touches: { value: down ? [t] : [] }, targetTouches: { value: down ? [t] : [] }, changedTouches: { value: [t] } });
      return e;
    };
    el.dispatchEvent(ev('touchstart', at.x, at.y, true));
    const prevented: boolean[] = [];
    for (let i = 1; i <= steps; i++) {
      const m = ev('touchmove', at.x + (dx * i) / steps, at.y + (dy * i) / steps, true);
      el.dispatchEvent(m);
      prevented.push(m.defaultPrevented);
    }
    el.dispatchEvent(ev('touchend', at.x + dx, at.y + dy, false));
    return prevented;
  }, { at, dx, dy, steps });
}

/** The middle of a box, for `drag`. */
export const mid = async (l: Locator) => { const b = (await l.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
