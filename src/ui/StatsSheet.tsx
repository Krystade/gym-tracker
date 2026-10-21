import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A Stats tile's detail, in a sheet from the bottom (owner, 2026-10-20: a sheet, not a drawer under the row). What the plan held
// against sheets on a 13 mini, and what this does about each:
// - Close sits at the top, out of one-hand reach: Done sits at the sheet's foot as well, in thumb reach.
// - Swipe-to-dismiss fights a chart's scrub: only the grabber and the title drag it down; the body scrolls, and a chart in it
//   scrubs sideways (touch-action: pan-y).
// - A second scroll container brings back the rubber-band bugs (r18-overscroll, 34a0f92): the page under it can't scroll while
//   it's open (the root's overflow and overscroll, the only ones that reach the viewport), the sheet's own body contains its
//   overscroll, and the sheet stays on the visible viewport the way the thread sheet does (--vv-bottom, viewportPin.ts).
// - The home indicator: the foot is padded by the bottom safe-area inset.

const CLOSE_AT = 96; // dragged this far down, it closes
const FLICK = 0.6; // px per ms: a quick flick closes from a shorter drag

export function StatsSheet({ title, link, onClose, children }: { title: string; /** A way on from the head (Open lift, Priorities). */ link?: ReactNode; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [drag, setDrag] = useState(0);
  const from = useRef<{ y: number; t: number; id: number } | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('sheet-lock');
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      root.classList.remove('sheet-lock');
      document.removeEventListener('keydown', onKey);
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  const down = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button, a')) return;
    from.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (from.current?.id !== e.pointerId) return;
    setDrag(Math.max(0, e.clientY - from.current.y));
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    const f = from.current;
    if (f?.id !== e.pointerId) return;
    from.current = null;
    const dy = Math.max(0, e.clientY - f.y), v = dy / Math.max(1, e.timeStamp - f.t);
    if (dy >= CLOSE_AT || (dy > 24 && v > FLICK)) close.current();
    else setDrag(0);
  };

  return createPortal(<>
    <div className="sheet-backdrop st-backdrop" aria-hidden="true" onClick={onClose} />
    <section ref={box} className={`sheet st-sheet${drag ? ' dragging' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      style={{ '--drag': `${drag}px` } as CSSProperties}>
      <header className="st-sh-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { from.current = null; setDrag(0); }}>
        <span className="st-grab" aria-hidden="true" />
        <div className="st-sh-top"><h2>{title}</h2>{link}</div>
      </header>
      <div className="st-sh-body">{children}</div>
      <footer className="st-sh-foot"><button type="button" className="st-done" onClick={onClose}>Done</button></footer>
    </section>
  </>, document.body);
}
