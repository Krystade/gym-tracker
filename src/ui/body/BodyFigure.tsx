import type { Muscle } from '../../domain/muscles';
import { BACK, FRONT } from './paths';
import { muscleAt, type Side, type Slug, type Tone } from './regions';

// The drawing itself, loaded lazily with its paths (BodyMap holds the legend, the taps and the fallback).

/** Each side cropped to the body (hands out to the sides, hair to feet), so the figure fills its box. */
const CROP: Record<Side, string> = { front: '48 92 632 1254', back: '766 92 632 1254' };
const SHAPES: Record<Side, readonly (readonly [Slug, string])[]> = { front: FRONT, back: BACK };

/** One side: the body around the muscles in one quiet fill, each muscle in its tone (or idle), named by data-m for taps. */
function Side({ side, tones, outlined }: { side: Side; tones: Partial<Record<Muscle, Tone>>; outlined: boolean }) {
  return (
    <svg className="bm-side" viewBox={CROP[side]} aria-hidden="true" focusable="false" data-side={side}>
      {SHAPES[side].map(([slug, d]) => {
        const m = muscleAt(side, slug);
        if (!m) return <path key={slug} d={d} className="bm-body" />;
        const t = tones[m];
        return <path key={slug} d={d} data-m={m} className={t ? `bm-${t}${outlined ? ' bm-out' : ''}` : 'bm-idle'} />;
      })}
    </svg>
  );
}

export default function BodyFigure({ tones, outlined = false }: { tones: Partial<Record<Muscle, Tone>>; outlined?: boolean }) {
  return <><Side side="front" tones={tones} outlined={outlined} /><Side side="back" tones={tones} outlined={outlined} /></>;
}
