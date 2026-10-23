import { useRef, useState, type ReactNode } from 'react';

/** How far the card slides to show Remove. */
const OPEN = 96;
/** How far a finger moves before the drag is read as across or down. */
const SLOP = 8;

/**
 * A Today card that a swipe right to left slides aside to show Remove (item 8, owner). Scrolling stays the browser's: the face
 * is `touch-action: pan-y`, and a drag that goes more down than across is never taken, so it scrolls as ever. A swipe back, or a
 * tap on the card, closes it. A drag started in a text field is the field's.
 */
export function SwipeRemove({ onRemove, children }: { onRemove: () => void; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const [dx, setDx] = useState<number | null>(null);
  // The drag so far, in a ref: a quick flick lifts before a render has the last move.
  const g = useRef<{ id: number; x0: number; y0: number; dir: 'h' | 'v' | null; dx: number } | null>(null);
  // A swipe ends with a click on whatever it started on: that click (by its event time) is the swipe's, not the card's.
  const swallow = useRef(-Infinity);
  const base = shown ? -OPEN : 0;
  const off = dx == null ? base : Math.max(-OPEN * 1.25, Math.min(0, base + dx));
  const end = (keep: boolean, at = 0) => {
    const s = g.current;
    if (s?.dir === 'h' && keep) { setShown(base + s.dx < -OPEN / 2); swallow.current = at; }
    g.current = null;
    setDx(null);
  };
  return (
    <div className="swipe" data-open={shown || undefined} data-moving={dx != null || undefined}>
      <button type="button" className="swipe-remove" tabIndex={shown ? 0 : -1} aria-hidden={!shown && dx == null}
        onClick={() => { setShown(false); onRemove(); }}>Remove</button>
      <div className="swipe-face" style={off ? { transform: `translateX(${off}px)` } : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('input, textarea, select')) return;
          g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: null, dx: 0 };
        }}
        onPointerMove={(e) => {
          const s = g.current;
          if (!s || s.id !== e.pointerId || s.dir === 'v') return;
          const x = e.clientX - s.x0, y = e.clientY - s.y0;
          if (s.dir == null) {
            if (Math.abs(x) < SLOP && Math.abs(y) < SLOP) return;
            // Across, and toward Remove (or back from it when shown): the card's. Anything else is a scroll.
            s.dir = Math.abs(x) > Math.abs(y) && (x < 0 || shown) ? 'h' : 'v';
            if (s.dir === 'v') return;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer already gone: the moves still bubble here */ }
            // Never pointerdown's preventDefault (it would keep focus where it was); a mouse's selection is dropped here instead.
            getSelection()?.removeAllRanges();
          }
          s.dx = x;
          setDx(x);
        }}
        onPointerUp={(e) => end(true, e.timeStamp)}
        onPointerCancel={() => end(false)}
        onClickCapture={(e) => {
          if (e.timeStamp - swallow.current < 400) { swallow.current = -Infinity; e.preventDefault(); e.stopPropagation(); return; }
          // Shown: a tap on the card closes it, and does nothing else.
          if (shown) { setShown(false); e.preventDefault(); e.stopPropagation(); }
        }}>
        {children}
      </div>
    </div>
  );
}
