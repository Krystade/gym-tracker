import { useEffect, useState } from 'react';

// A buddy's sprite (public/buddies/<pose>.png, 16 × 16) at a whole-number scale, drawn pixelated. A buddy of several poses
// cycles through them (owner: a group cycles); under reduced motion it holds its first. Every pose is in the page from the
// start, so a change of pose never waits on a load.

export const SPRITE = 16;
export const POSE_MS = 650;
export const spriteUrl = (pose: string) => `${import.meta.env.BASE_URL}buddies/${pose}.png`;

export function BuddySprite({ poses, scale, shadow, className }: {
  poses: readonly string[]; scale: number;
  /** Not yours yet: its shape only. */ shadow?: boolean; className?: string;
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
    </span>
  );
}
