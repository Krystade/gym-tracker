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
 *
 * But a bounce takes a finger: it happens only while a touch is down or its fling is still scrolling. Coming back to the app
 * (a notification tapped on the Home Screen, owner's 13 mini, 2026-10-20) iOS can hand back a stale visual viewport past the
 * end of a page that got shorter in the background (a lift's card folded, the rest bar gone), with no touch at all: that
 * looked like a bounce, so the pin left the tab bar mid-screen with the page below it. Without a touch it is a stuck screen.
 *
 * A keyboard-short visual viewport (under four fifths of the layout's height) is a keyboard or picker only while a field that
 * raises one has focus. Without one there is no keyboard: iOS handed back the viewport a keyboard left (owner's 13 mini,
 * 2026-10-22: back to Friends › Board, the tab bar 318px up the screen and the page drawn whole below it). The stuck screens
 * seen are a few px short, never a keyboard's height, so a keyboard-short one with no field focused leaves the chrome on the
 * layout's edges, as a keyboard does.
 *
 * And while a keyboard is up, the sheets with a field in them (a thread's message box, Add a friend) ride on top of it, as a
 * compose box does in any app: --kb is the keyboard's top above the layout's bottom, --kb-top the visual viewport's offset
 * (iOS can pan the screen down the layout as well). The tab bar and the other chrome stay behind it.
 */
// A field that can raise a keyboard or picker. Read-only ones can't (the invite link), nor inputmode=none.
const FIELD = 'input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=image], [readonly], [inputmode=none]), '
  + 'select, textarea:not([readonly], [inputmode=none]), [contenteditable]:not([contenteditable=false])';
const POLL_MS = 500;
const LINGER_MS = 5000;
/** Anything focused that takes text or a pick, read-only or not: while one has focus it can leave the page unannounced. */
const ANY_FIELD = 'input, select, textarea, [contenteditable]';
/** How long after a finger lifts (or the fling's last scroll) the page can still be bouncing. */
const FLING_MS = 700;
let kick: (() => void) | null = null;
/** Look at the screen again now and for a few seconds (a notification tap's screen just came up). */
export const repinChrome = () => kick?.();

export function pinChromeToVisualViewport(root: HTMLElement = document.documentElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let last = '';
  // A select keeps focus after its picker closes, with no event once the screen settles: after a pick it no longer
  // counts as holding a picker up, until it is focused again.
  let picked: Element | null = null;
  // Mid-bounce: the visual viewport above the page, or at the full height past its end. scrollHeight only when it can be.
  let touching = false, flingUntil = 0;
  // Above the page: a pull past the top, or what one left behind. Never a stuck screen, finger or not (owner's 13 mini,
  // 2026-10-27: after a fling or coming back mid-rest, the viewport stayed 345px above the page with no touch, and the rest bar
  // and tab bar went 345px up the screen with the status backdrop off the top). The chrome stays on the screen edges.
  const above = () => scrollY < 0 || vv.offsetTop < 0 || vv.pageTop < 0;
  // Past the end at the full height: a bounce while a finger is down or its fling runs; without one, a stuck screen.
  const bouncing = () => (touching || Date.now() < flingUntil)
    && vv.offsetTop > 0 && vv.height >= innerHeight - 1 && vv.pageTop + vv.height > (document.scrollingElement ?? document.documentElement).scrollHeight + 1;
  const update = () => {
    const active = document.activeElement;
    const field = (active?.matches(FIELD) ?? false) && active !== picked;
    // A keyboard or picker takes a fifth of the screen or more; the stuck gap left behind is far smaller. Short by that much
    // with no field to raise one, it's no keyboard and no stuck screen: a viewport iOS forgot to give back.
    const short = vv.height < innerHeight * 0.8;
    const inputUp = field && short;
    const pinch = Math.abs(vv.scale - 1) > 0.01; // zoomed in by hand: the chrome is meant to stay put then
    if (!short && !pinch && bouncing()) return; // the bounce settles with a scroll event, and the poll looks again
    const still = short || pinch || above();
    const top = still ? 0 : vv.offsetTop;
    const bottom = still ? 0 : innerHeight - (vv.offsetTop + vv.height);
    const kb = inputUp && !pinch ? Math.max(0, innerHeight - (vv.offsetTop + vv.height)) : 0;
    const kbTop = inputUp && !pinch ? Math.max(0, vv.offsetTop) : 0;
    const next = `${Math.round(top)}px ${Math.round(bottom)}px ${Math.round(kb)}px ${Math.round(kbTop)}px`;
    if (next === last) return; // runs on every scroll: no style change unless the gap moved
    last = next;
    root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    root.style.setProperty('--vv-bottom', `${Math.round(bottom)}px`);
    root.style.setProperty('--kb', `${Math.round(kb)}px`);
    root.style.setProperty('--kb-top', `${Math.round(kbTop)}px`);
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
    if (!field && last === '0px 0px 0px 0px' && Date.now() > until) { clearInterval(poll); poll = 0; }
  };
  const wake = () => { until = Date.now() + LINGER_MS; if (!poll) poll = window.setInterval(tick, POLL_MS); };
  const later = () => { wake(); timers.forEach(clearTimeout); update(); timers = [100, 400, 800].map((ms) => window.setTimeout(update, ms)); };
  const moved = () => { if (touching || Date.now() < flingUntil) flingUntil = Date.now() + FLING_MS; update(); wake(); };
  const down = () => { touching = true; };
  const up = () => { touching = false; flingUntil = Date.now() + FLING_MS; later(); };
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
  document.addEventListener('touchstart', down, { passive: true, capture: true });
  document.addEventListener('touchend', up, { passive: true, capture: true });
  document.addEventListener('touchcancel', up, { passive: true, capture: true });
  // Back from the background: no finger is down, whatever the last one was doing when the app went.
  const resume = () => { touching = false; flingUntil = 0; later(); };
  const onShow = () => { if (document.visibilityState === 'visible') resume(); };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('hashchange', later);
  kick = later;
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
    document.removeEventListener('touchstart', down, true);
    document.removeEventListener('touchend', up, true);
    document.removeEventListener('touchcancel', up, true);
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('hashchange', later);
    if (kick === later) kick = null;
    clearInterval(poll);
    timers.forEach(clearTimeout);
  };
}
