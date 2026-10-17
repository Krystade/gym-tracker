/**
 * Keeps the fixed chrome (status backdrop, tab bar, the sheets docked on it) on the part of the screen you can see.
 *
 * iOS 26 (Safari and Home Screen apps alike) can leave the visual viewport offset from the layout viewport after a
 * keyboard or picker closes: visualViewport.offsetTop stays above 0 and its height short of innerHeight, and nothing
 * fires to say so. Fixed elements are laid out against the layout viewport, so the tab bar ends up partway up the
 * screen with the page showing below it, and the status backdrop slides off the top with the page drawn under the
 * clock. Apple's thread: https://developer.apple.com/forums/thread/800125 (FB19889436).
 *
 * The CSS moves those elements by --vv-top and --vv-bottom, the gap between the two viewports. While a field is
 * focused with a keyboard or picker up the gap is real and the chrome stays put, as it does in every app.
 */
const FIELD = 'input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit]), select, textarea, [contenteditable]';

export function pinChromeToVisualViewport(root: HTMLElement = document.documentElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let last = '';
  // A select keeps focus after its picker closes, with no event once the screen settles: after a pick it no longer
  // counts as holding a picker up, until it is focused again.
  let picked: Element | null = null;
  const update = () => {
    const active = document.activeElement;
    const field = (active?.matches(FIELD) ?? false) && active !== picked;
    // A keyboard or picker takes a fifth of the screen or more; the stuck gap left behind is far smaller, or has no focus.
    const inputUp = field && vv.height < innerHeight * 0.8;
    const pinch = Math.abs(vv.scale - 1) > 0.01; // zoomed in by hand: the chrome is meant to stay put then
    const top = inputUp || pinch ? 0 : vv.offsetTop;
    const bottom = inputUp || pinch ? 0 : innerHeight - (vv.offsetTop + vv.height);
    const next = `${Math.round(top)}px ${Math.round(bottom)}px`;
    if (next === last) return; // runs on every scroll: no style change unless the gap moved
    last = next;
    root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    root.style.setProperty('--vv-bottom', `${Math.round(bottom)}px`);
  };
  // The keyboard animates away over a few hundred ms, and the stuck state says nothing when it settles.
  let timers: number[] = [];
  const later = () => { timers.forEach(clearTimeout); update(); timers = [100, 400, 800].map((ms) => window.setTimeout(update, ms)); };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('scroll', update, { passive: true });
  const onFocus = () => { picked = null; later(); };
  const onChange = (e: Event) => { if (e.target instanceof HTMLSelectElement) { picked = e.target; later(); } };
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', later);
  document.addEventListener('change', onChange, true);
  update();
  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    window.removeEventListener('scroll', update);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', later);
    document.removeEventListener('change', onChange, true);
    timers.forEach(clearTimeout);
  };
}
