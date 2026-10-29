import { useEffect, useState } from 'react';
import { headOf } from '../../domain/buddies/anchorFix';
import { HELD } from '../../domain/buddies/anchors';

// A buddy's sprite (public/buddies/<pose>.png, 16 × 16) at a whole-number scale, drawn pixelated. A buddy of several poses
// cycles through them (owner: a group cycles); under reduced motion it holds its first. Every pose is in the page from the
// start, so a change of pose never waits on a load. A held item (stage 5) rests on the head anchor of the pose showing, at half
// the buddy's scale (a whole number, so it stays crisp), its base (anchors HELD) sunk into the head's two-pixel outline.

export const SPRITE = 16;
export const POSE_MS = 650;
export const spriteUrl = (pose: string) => `${import.meta.env.BASE_URL}buddies/${pose}.png`;

/** How far a held item sits into the head: the sprites' outline is two pixels thick. */
export const SINK = 2;
/** A held item's scale for a buddy drawn at `scale`: half, never below 1. */
export const heldScale = (scale: number) => Math.max(1, Math.floor(scale / 2));

export function BuddySprite({ poses, scale, shadow, className, held }: {
  poses: readonly string[]; scale: number;
  /** Not yours yet: its shape only. */ shadow?: boolean; className?: string;
  /** The held item it wears (an accessory id with a sprite). */ held?: string | null;
}) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (poses.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setAt((n) => n + 1), POSE_MS);
    return () => clearInterval(t);
  }, [poses.length]);
  const px = SPRITE * scale, on = at % poses.length;
  return (
    <span className={`bu-sprite${shadow ? ' shadow' : ''}${className ? ` ${className}` : ''}`} style={{ width: px, height: px }} aria-hidden="true">
      {poses.map((p, i) => <img key={p} src={spriteUrl(p)} width={px} height={px} alt="" draggable={false} hidden={i !== on} />)}
      {held && HELD[held] && (() => {
        const [ax, ay] = headOf(poses[on]), [bx, by] = HELD[held], k = heldScale(scale);
        return <img className="bu-held" src={spriteUrl(held)} width={SPRITE * k} height={SPRITE * k} alt="" draggable={false} data-held={held}
          style={{ width: SPRITE * k, height: SPRITE * k, left: Math.round(ax * scale - bx * k), top: Math.round((ay + SINK) * scale - by * k) }} />;
      })()}
    </span>
  );
}
