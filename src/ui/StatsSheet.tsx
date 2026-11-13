import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSheet } from './useSheet';
import './stats.css';

// A Stats tile's detail, in a sheet from the bottom (owner, 2026-10-20: a sheet, not a drawer under the row). What the plan held
// against sheets on a 13 mini, and what this does about each:
// - Close sits at the top, out of one-hand reach: Done sits at the sheet's foot as well, in thumb reach.
// - Swipe-to-dismiss fights a chart's scrub: a drag down closes it (ui/useSheet, as every sheet) from the grabber and title, or
//   from the body while that's at its top; a sideways one is the chart's (touch-action: pan-y), and further down the body scrolls.
// - A second scroll container brings back the rubber-band bugs (r18-overscroll, 34a0f92): the page under it can't scroll while
//   it's open (ui/useSheet), the sheet's own body contains its overscroll, and the sheet stays on the visible viewport the way
//   the thread sheet does (--vv-bottom, viewportPin.ts).
// - The home indicator: the foot is padded by the bottom safe-area inset.

export function StatsSheet({ title, link, onClose, children }: { title: string; /** A way on from the head (Open lift, Priorities). */ link?: ReactNode; onClose: () => void; children: ReactNode }) {
  const box = useSheet<HTMLElement>(onClose);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<>
    <div className="sheet-backdrop st-backdrop" aria-hidden="true" onClick={onClose} />
    <section ref={box} className="sheet st-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header className="st-sh-head">
        <span className="st-grab" aria-hidden="true" />
        <div className="st-sh-top"><h2>{title}</h2>{link}</div>
      </header>
      <div className="st-sh-body">{children}</div>
      <footer className="st-sh-foot"><button type="button" className="st-done" onClick={onClose}>Done</button></footer>
    </section>
  </>, document.body);
}
