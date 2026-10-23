import { lazy, Suspense, type MouseEvent, type ReactNode } from 'react';
import { MUSCLES, type Muscle } from '../../domain/muscles';
import { legendOf, LIST_ONLY, TONE_WORD, type Tone } from './regions';
import './body.css';

// The front/back body map (owner, 2026-10-22; geometry MIT, see THIRD_PARTY_NOTICES.md). The drawing and its paths load as their
// own chunk the first time a map shows (precached with the rest, so offline too); until then a box of the same size holds the place.
const BodyFigure = lazy(() => import('./BodyFigure'));

/** Finger-sized: a tap this close to a muscle (in px) counts for it, nearest ring first, so a forearm needn't be hit dead on. */
const NEAR = [0, 8, 16];

function muscleNear(x: number, y: number, root: Element): Muscle | null {
  for (const r of NEAR) {
    const n = r ? 8 : 1;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      for (const el of document.elementsFromPoint(x + r * Math.cos(a), y + r * Math.sin(a))) {
        if (!root.contains(el)) continue;
        const m = el.getAttribute('data-m');
        if (m && (MUSCLES as readonly string[]).includes(m)) return m as Muscle;
      }
    }
  }
  return null;
}

/**
 * The body front and back, each muscle in its tone, with a legend that names every colour shown and a line naming any muscle the
 * map can't draw. `label`: what the map says, for a screen reader (the list beside it has the numbers). `onMuscle`: a tap on or
 * near a muscle (the list beside it is the way there by keyboard). `outlined`: the muscles were guessed from a name.
 */
export function BodyMap({ tones, label, onMuscle, outlined = false, size = 'md', extra }: {
  tones: Partial<Record<Muscle, Tone>>; label: string; onMuscle?: (m: Muscle) => void; outlined?: boolean; size?: 'md' | 'sm';
  /** More in the legend's row (the lift page's outline key). */ extra?: ReactNode;
}) {
  const legend = legendOf(tones);
  // A muscle the map can't draw, named with its word when that says something (no target says nothing).
  const unseen = LIST_ONLY.filter((m) => tones[m] && tones[m] !== 'none');
  const tap = onMuscle ? (e: MouseEvent<HTMLDivElement>) => {
    const m = muscleNear(e.clientX, e.clientY, e.currentTarget);
    if (m) onMuscle(m);
  } : undefined;
  return (
    <figure className={`bodymap bm-${size}`} data-tappable={onMuscle ? '' : undefined}>
      <div className="bm-figs" role="img" aria-label={label} onClick={tap}>
        <Suspense fallback={<><span className="bm-side bm-wait" /><span className="bm-side bm-wait" /></>}>
          <BodyFigure tones={tones} outlined={outlined} />
        </Suspense>
      </div>
      {(legend.length > 0 || extra) && (
        <figcaption className="bm-legend">
          {legend.map((t) => <span key={t} className="bm-key"><i className={`bm-sw bm-${t}`} aria-hidden="true" />{TONE_WORD[t]}</span>)}
          {extra}
        </figcaption>
      )}
      {unseen.length > 0 && <p className="bm-note">Not drawn: {unseen.map((m) => `${m.toLowerCase()} (${TONE_WORD[tones[m]!]})`).join(', ')}</p>}
    </figure>
  );
}
