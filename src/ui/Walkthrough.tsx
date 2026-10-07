import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const KEY = 'gym-tracker:walkthrough';
const PAD = 6; // room between the target and the ring

/** Each card names the `data-tour` targets it lights up; several targets light up as one box around them all. */
const CARDS: { title: string; body: string; at: string[] }[] = [
  { title: 'Today', body: 'Today is where you train. The arrows step to other days, to log one you missed.', at: ['day'] },
  { title: 'Log a set', body: 'Add exercise opens a lift. Type the weight and reps and tap Add set; the next set starts from the last one.', at: ['add'] },
  { title: 'The plan', body: 'Program builds a plan from your priorities. Today then lists what’s left; Skip or Swap any lift from its row.', at: ['program'] },
  { title: 'History, Lifts and Stats', body: 'History lists every session, Lifts shows your last and best sets, and Stats counts weekly sets per muscle against targets that fit your week.', at: ['history', 'lifts', 'stats'] },
  { title: 'Your data', body: 'Everything stays on this phone. Export a backup on Data now and then; this walkthrough is there too.', at: ['data'] },
];

/** Whether the walkthrough still has to be shown. Storage that can't be read counts as seen, so it never nags. */
export function walkthroughPending(): boolean {
  try { return localStorage.getItem(KEY) !== 'done'; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(KEY, 'done'); } catch { /* shown again next visit at worst */ }
}

interface Box { top: number; left: number; width: number; height: number }

function targetBox(at: string[]): { box: Box; fixed: boolean } | null {
  const els = at.flatMap((t) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)]);
  if (!els.length) return null;
  const rs = els.map((e) => e.getBoundingClientRect());
  // The ring stays on screen (the tabs touch its edges), 3px in so its glow shows.
  const top = Math.min(...rs.map((r) => r.top)) - PAD, left = Math.max(3, Math.min(...rs.map((r) => r.left)) - PAD);
  const right = Math.min(innerWidth - 3, Math.max(...rs.map((r) => r.right)) + PAD), bottom = Math.min(innerHeight - 3, Math.max(...rs.map((r) => r.bottom)) + PAD);
  const box = { top, left, width: right - left, height: bottom - top };
  return { box, fixed: els.every((e) => e.closest('.tabs')) };
}

/** A few short cards in a sheet above the tabs, each lighting up the part of the screen it talks about. Skip or Done closes it for good. */
export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const close = () => { markSeen(); onClose(); };
  const card = CARDS[i];
  const last = i === CARDS.length - 1;

  const measure = useCallback(() => {
    const t = targetBox(card.at);
    setBox(t?.box ?? null);
    return t;
  }, [card]);

  // Room under the page for the sheet, so the last thing on it can scroll up above the sheet.
  useLayoutEffect(() => {
    const root = document.documentElement, el = sheet.current!;
    const fit = new ResizeObserver(() => root.style.setProperty('--walk-h', `${el.offsetHeight + 8}px`));
    fit.observe(el);
    return () => { fit.disconnect(); root.style.removeProperty('--walk-h'); };
  }, []);

  // Follows the target as the page scrolls, resizes or renders (on a first visit the walkthrough opens before Today has).
  // The first time it's found, a target the sheet would cover, or above the screen, scrolls into the space above the sheet.
  useLayoutEffect(() => {
    let raf = 0, placed = false;
    const place = () => {
      const t = measure();
      if (!t || placed) return;
      placed = true;
      const sheetTop = sheet.current?.getBoundingClientRect().top ?? innerHeight;
      if (!t.fixed && (t.box.top < 8 || t.box.top + t.box.height > sheetTop - 8)) {
        window.scrollBy({ top: t.box.top - Math.max(8, (sheetTop - t.box.height) / 2), behavior: 'instant' });
        measure();
      }
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    place();
    const seen = new MutationObserver(on);
    seen.observe(document.body, { childList: true, subtree: true });
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => { cancelAnimationFrame(raf); seen.disconnect(); removeEventListener('scroll', on); removeEventListener('resize', on); };
  }, [measure]);

  return (
    <>
      {box && <div className="spotlight" aria-hidden="true" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />}
      <section ref={sheet} className="walkthrough" role="dialog" aria-label="Walkthrough">
        <div className="walk-dots" aria-hidden="true">{CARDS.map((_, n) => <span key={n} className={n === i ? 'on' : n < i ? 'past' : undefined} />)}</div>
        <div key={i} className="walk-card">
          <p className="muted small">{i + 1} of {CARDS.length}</p>
          <h2>{card.title}</h2>
          <p>{card.body}</p>
        </div>
        <div className="walk-actions">
          <button type="button" onClick={close}>Skip</button>
          <span>
            {i > 0 && <button type="button" onClick={() => setI(i - 1)}>Back</button>}
            <button type="button" className="primary" onClick={last ? close : () => setI(i + 1)}>{last ? 'Done' : 'Next'}</button>
          </span>
        </div>
      </section>
    </>
  );
}
