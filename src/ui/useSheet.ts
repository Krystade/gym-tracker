import { useEffect, useRef, type RefObject } from 'react';

// Every bottom sheet's two behaviours (owner's 13 mini, 2026-11-12: the page behind an open chat scrolled, and a swipe down
// closed neither the chat nor a buddy sheet), in one place so each sheet gets both:
// - The page under it stays still. The root's overflow (the only one that reaches the viewport) holds it, and a touchmove
//   that nothing in the sheet can scroll is refused, so neither iOS's rubber band nor a fling chains through to the page. The
//   page is never moved or made fixed (no jump under the dim). Should a finger move it after all, it goes straight back; should
//   the keyboard (a field in the sheet brought into view), it goes back on close. The app's own scrollTo (a sheet's link to
//   another screen) stands.
// - A downward swipe closes it: from its head, grabber or any part that doesn't scroll, or from its scrolling body once that's
//   at the top (further down, the swipe scrolls the body up as ever). Mostly sideways, or from a field, it's never a close.

const CLOSE_AT = 96; // dragged this far down, it closes
const FLICK = 0.6; // px per ms: a quick flick closes from a shorter drag
const SLOP = 8; // px before a touch is a drag at all, so a tap stays a tap
/** A drag that starts here is the field's (the caret, a selection, a slider), never the sheet's. */
const OWN = 'input, textarea, select, [contenteditable]:not([contenteditable=false])';

/** Every open sheet's close, so something outside them (the rest banner's tap) can close them all. */
const closers = new Set<{ current: () => void }>();
/** Closes every open sheet, as its own close would (a swipe down, its Done). */
export const closeSheets = () => { for (const c of [...closers]) c.current(); };

let open = 0, keptY = 0, drift = false, from: { x: number; y: number } | null = null;
const overflows = (o: string) => o === 'auto' || o === 'scroll';
/** Something from `el` up (short of the page itself) can scroll the way a finger moved by dx, dy from where it went down. */
function canScroll(el: Element | null, dx: number, dy: number): boolean {
  const down = Math.abs(dy) >= Math.abs(dx);
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (down ? overflows(s.overflowY) && (dy > 0 ? e.scrollTop > 0 : e.scrollTop + e.clientHeight < e.scrollHeight - 1)
      : overflows(s.overflowX) && (dx > 0 ? e.scrollLeft > 0 : e.scrollLeft + e.clientWidth < e.scrollWidth - 1)) return true;
  }
  return false;
}
/** The nearest box from `el` up to `sheet` that scrolls up and down, or null. */
function scrollerIn(el: Element | null, sheet: Element): Element | null {
  for (let e = el; e && e !== sheet; e = e.parentElement) if (overflows(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
  return null;
}
const onStart = (e: TouchEvent) => { from = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; };
const onEnd = (e: TouchEvent) => { if (!e.touches.length) from = null; };
const onScroll = () => {
  if (from) window.scrollTo({ top: keptY, behavior: 'instant' });
  else if (document.activeElement?.matches(OWN)) drift = true;
  else keptY = window.scrollY;
};
const guard = (e: TouchEvent) => {
  if (!from || e.touches.length !== 1 || !e.cancelable) return; // two fingers: a pinch zoom is still yours
  const t = e.touches[0], el = e.target instanceof Element ? e.target : null;
  if (el?.closest(OWN) || canScroll(el, t.clientX - from.x, t.clientY - from.y)) return;
  e.preventDefault();
};

/** While any sheet is open (they stack: a report over a post's sheet), the page under them can't scroll. */
function lock() {
  if (open++) return;
  keptY = window.scrollY;
  drift = false;
  document.documentElement.classList.add('sheet-lock');
  document.addEventListener('touchstart', onStart, { passive: true, capture: true });
  document.addEventListener('touchend', onEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', onEnd, { passive: true, capture: true });
  document.addEventListener('touchmove', guard, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
}
function unlock() {
  if (--open) return;
  document.documentElement.classList.remove('sheet-lock');
  document.removeEventListener('touchstart', onStart, true);
  document.removeEventListener('touchend', onEnd, true);
  document.removeEventListener('touchcancel', onEnd, true);
  document.removeEventListener('touchmove', guard);
  window.removeEventListener('scroll', onScroll);
  from = null;
  if (drift && Math.abs(window.scrollY - keptY) > 1) window.scrollTo({ top: keptY, behavior: 'instant' });
}

/**
 * A bottom sheet's scroll lock and swipe to close: put the ref on its `.sheet` section. It moves by --drag (styles.css: the
 * sheet's translate) and data-drag says what it's doing: "on" under the finger, "settle" springing back.
 */
export function useSheet<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { closers.add(close); return () => { closers.delete(close); }; }, []);
  useEffect(() => {
    const el = ref.current;
    lock();
    if (!el) return unlock;
    let g: { x: number; y: number; t: number; on: boolean } | null = null, settle = 0;
    const set = (px: number) => el.style.setProperty('--drag', `${Math.round(px)}px`);
    const begin = (x: number, y: number, t: number, target: EventTarget | null) => {
      const at = target instanceof Element ? target : null;
      // In a body scrolled down, a swipe down scrolls it back up: the sheet only drags from its top.
      g = at?.closest(OWN) || (scrollerIn(at, el)?.scrollTop ?? 0) > 0 ? null : { x, y, t, on: false };
    };
    /** True while the sheet has the drag (the caller then keeps the browser from scrolling with it). */
    const drag = (x: number, y: number) => {
      if (!g) return false;
      const dx = x - g.x, dy = y - g.y;
      if (!g.on) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
        if (dy <= Math.abs(dx)) { g = null; return false; } // up, or sideways: a scroll or a rail's, not ours
        g.on = true;
        clearTimeout(settle);
        el.dataset.drag = 'on';
      }
      set(Math.max(0, dy));
      return true;
    };
    const end = (y: number, t: number) => {
      const f = g;
      g = null;
      if (!f?.on) return false;
      const dy = Math.max(0, y - f.y), v = dy / Math.max(1, t - f.t);
      if (dy >= CLOSE_AT || (dy > 24 && v > FLICK)) { close.current(); return true; }
      el.dataset.drag = 'settle';
      set(0);
      settle = window.setTimeout(() => { delete el.dataset.drag; }, 250);
      return true;
    };
    const cancel = () => { if (g?.on) { el.dataset.drag = 'settle'; set(0); settle = window.setTimeout(() => { delete el.dataset.drag; }, 250); } g = null; };

    const ts = (e: TouchEvent) => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp, e.target); else cancel(); };
    const tm = (e: TouchEvent) => { if (e.touches.length === 1 && drag(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault(); };
    const te = (e: TouchEvent) => { const t = e.changedTouches[0]; if (t) end(t.clientY, e.timeStamp); };
    // A mouse drags it too (a desktop, or a phone's test): touches arrive as touch events, so only the mouse's pointer counts.
    const pm = (e: PointerEvent) => { if (drag(e.clientX, e.clientY)) e.preventDefault(); };
    const swallow = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
    const pu = (e: PointerEvent) => {
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      // A drag let go over a button isn't a click on it.
      if (end(e.clientY, e.timeStamp)) { window.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => window.removeEventListener('click', swallow, true), 0); }
    };
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      begin(e.clientX, e.clientY, e.timeStamp, e.target);
      if (!g) return;
      window.addEventListener('pointermove', pm);
      window.addEventListener('pointerup', pu);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', cancel);
    el.addEventListener('pointerdown', pd);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', cancel);
      el.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      clearTimeout(settle);
      unlock();
    };
  }, []);
  return ref;
}
