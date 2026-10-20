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
 *
 * Nothing can be trusted to fire when the screen sticks, so the gap is also measured twice a second while it can move: while
 * a field is focused, while there is a gap, and for a few seconds after any focus change, tap, viewport event or return to
 * the app (and a tap anywhere checks at once). Focus and blur alone missed it on Friends: a field that leaves the page while
 * focused (a username saved, a status set) gets no blur or focusout in WebKit, and a screen can stick when the request a
 * field sent comes back, after the last check that followed the blur.
 *
 * A rubber-band bounce is no stuck screen. Pulled past the top or pushed past the end, the visual viewport leaves the page,
 * and translating the chrome by that put the tab bar 400px up the screen and the backdrop off the top (the owner's 13 mini,
 * on More). A stuck screen is never above the page, nor past its end at the full height, so while the visual viewport is
 * there the gap is left as it was. (overscroll-behavior on body doesn't stop the bounce: only the root's reaches the viewport.)
 */
// A field that can raise a keyboard or picker. Read-only ones can't (the invite link), nor inputmode=none.
const FIELD = 'input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=image], [readonly], [inputmode=none]), '
  + 'select, textarea:not([readonly], [inputmode=none]), [contenteditable]:not([contenteditable=false])';
const POLL_MS = 500;
const LINGER_MS = 5000;
/** Anything focused that takes text or a pick, read-only or not: while one has focus it can leave the page unannounced. */
const ANY_FIELD = 'input, select, textarea, [contenteditable]';

export function pinChromeToVisualViewport(root: HTMLElement = document.documentElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let last = '';
  // A select keeps focus after its picker closes, with no event once the screen settles: after a pick it no longer
  // counts as holding a picker up, until it is focused again.
  let picked: Element | null = null;
  // Mid-bounce: the visual viewport above the page, or at the full height past its end. scrollHeight only when it can be.
  const bouncing = () => scrollY < 0 || vv.offsetTop < 0 || vv.pageTop < 0
    || (vv.offsetTop > 0 && vv.height >= innerHeight - 1 && vv.pageTop + vv.height > (document.scrollingElement ?? document.documentElement).scrollHeight + 1);
  const update = () => {
    const active = document.activeElement;
    const field = (active?.matches(FIELD) ?? false) && active !== picked;
    // A keyboard or picker takes a fifth of the screen or more; the stuck gap left behind is far smaller, or has no focus.
    const inputUp = field && vv.height < innerHeight * 0.8;
    const pinch = Math.abs(vv.scale - 1) > 0.01; // zoomed in by hand: the chrome is meant to stay put then
    if (!inputUp && !pinch && bouncing()) return; // the bounce settles with a scroll event, and the poll looks again
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
  // Measuring twice a second while it can move; idle otherwise (a phone left on a screen, or a clock run on in a test).
  let poll = 0, until = 0, hadField = false;
  const tick = () => {
    update();
    if (document.visibilityState !== 'visible') { clearInterval(poll); poll = 0; return; }
    const field = document.activeElement?.matches(ANY_FIELD) ?? false;
    if (hadField && !field) until = Date.now() + LINGER_MS; // it blurred or left the page: watch the screen settle
    hadField = field;
    if (!field && last === '0px 0px' && Date.now() > until) { clearInterval(poll); poll = 0; }
  };
  const wake = () => { until = Date.now() + LINGER_MS; if (!poll) poll = window.setInterval(tick, POLL_MS); };
  const later = () => { wake(); timers.forEach(clearTimeout); update(); timers = [100, 400, 800].map((ms) => window.setTimeout(update, ms)); };
  const moved = () => { update(); wake(); };
  vv.addEventListener('resize', moved);
  vv.addEventListener('scroll', moved);
  window.addEventListener('scroll', moved, { passive: true });
  window.addEventListener('resize', moved);
  const onFocus = () => { picked = null; later(); };
  const onChange = (e: Event) => { if (e.target instanceof HTMLSelectElement) { picked = e.target; later(); } };
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', later);
  document.addEventListener('change', onChange, true);
  // A tap anywhere, and coming back to the app (from a share sheet, say), look again straight away.
  document.addEventListener('touchend', later, { passive: true });
  const onShow = () => { if (document.visibilityState === 'visible') later(); };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('pageshow', later);
  update();
  wake();
  return () => {
    vv.removeEventListener('resize', moved);
    vv.removeEventListener('scroll', moved);
    window.removeEventListener('scroll', moved);
    window.removeEventListener('resize', moved);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', later);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('touchend', later);
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('pageshow', later);
    clearInterval(poll);
    timers.forEach(clearTimeout);
  };
}
