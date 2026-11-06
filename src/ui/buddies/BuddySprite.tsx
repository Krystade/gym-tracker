import { useEffect, useState } from 'react';
import { headOf } from '../../domain/buddies/anchorFix';
import { FRAMES, HELD } from '../../domain/buddies/anchors';
import type { BuddyDef } from '../../domain/buddies/roster';

// A buddy's sprite (public/buddies/<pose>.png, 16 × 16) at a whole-number scale, drawn pixelated. A buddy of several poses
// cycles through them (owner: a group cycles); under reduced motion it holds its first. Every pose is in the page from the
// start, so a change of pose never waits on a load. A held item (stage 5) rests on the head anchor of the pose showing, at half
// the buddy's scale (a whole number, so it stays crisp), its base (anchors HELD) sunk into the head's two-pixel outline.
// An older character (roster Art) is a strip of frames at its own size and pixel density (owner 2026-11-06: the big trucks
// and the fine-pixelled Dudes are the joke), stepped frame by frame; only its pixels' box shows. It's drawn at the Tiny scale
// asked for where that fits the room it's given (`box`), else as large as fits with each of its pixels a whole number of
// device pixels, so it stays crisp. A held item on one is the size it would be on a Tiny buddy there, on its frame's anchor.

export const SPRITE = 16;
export const POSE_MS = 650;
export const spriteUrl = (pose: string) => `${import.meta.env.BASE_URL}buddies/${pose}.png`;

/** How far a held item sits into the head: the sprites' outline is two pixels thick (the older characters', one). */
export const SINK = 2, SINK_OLD = 1;
/** A held item's scale for a buddy drawn at `scale`: half, never below 1. */
export const heldScale = (scale: number) => Math.max(1, Math.floor(scale / 2));

/** The room an older character has, css px (w × h), where each kind of place draws a buddy. A Tiny sprite always fits. */
export const BOX = {
  /** Collection's and Choose's tiles (60 px at their narrowest, less padding). */ tile: [52, 64],
  /** The roster's and a friend's strip tiles (76 px). */ wide: [68, 64],
  /** A feed post's chip. */ chip: [48, 28],
  /** Today's head (ui/styles .today-buddy): leftwards over the arrows' empty row, up 12 px to the status backdrop, and past 60 px
   *  tall into the title's right end. */ today: [160, 84],
  /** The card's hero (288 px across at 320 wide), with room above for a held item when there's one. */ hero: [280, 176], heroHeld: [280, 144],
  /** A friend's card, in its sheet. */ friend: [280, 156], friendHeld: [280, 128],
  /** A pull's reveal: in full, as big as the sheet allows. */ reveal: [300, 240],
} as const satisfies Record<string, readonly [number, number]>;

const devicePixels = () => Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
/** The scale (css px an art pixel) for art of w × h: `want` when it fits `box`, else the largest that fits in whole device pixels. */
export function fitScale(want: number, w: number, h: number, box?: readonly [number, number], dpr = devicePixels()): number {
  if (!box || (w * want <= box[0] && h * want <= box[1])) return want;
  return Math.max(1, Math.floor(Math.min(box[0] / w, box[1] / h) * dpr + 1e-9)) / dpr;
}
/** How big a buddy is drawn, css px: what fitScale gives, over its pixels' box (a Tiny sprite: 16 × 16 at `scale`). */
export function drawnSize(def: BuddyDef, scale: number, box?: readonly [number, number]): [number, number] {
  if (!def.art) return [SPRITE * scale, SPRITE * scale];
  const [, , w, h] = FRAMES[def.id].box, s = fitScale(scale, w, h, box);
  return [w * s, h * s];
}

const stepping = (n: number, still?: boolean) => n > 1 && !still && !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function BuddySprite({ def, scale, box, still, shadow, className, held }: {
  def: BuddyDef;
  /** A Tiny sprite's whole-number scale here. */ scale: number;
  /** The most room an older character has here (BOX), css px. */ box?: readonly [number, number];
  /** Hold its first pose or frame. */ still?: boolean;
  /** Not yours yet: its shape only. */ shadow?: boolean; className?: string;
  /** The held item it wears (an accessory id with a sprite). */ held?: string | null;
}) {
  const art = def.art, poses = still ? def.poses.slice(0, 1) : def.poses;
  const n = art ? art.n : poses.length, ms = art ? art.ms : POSE_MS;
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!stepping(n, still)) return;
    const t = setInterval(() => setAt((k) => k + 1), ms);
    return () => clearInterval(t);
  }, [n, ms, still]);
  const on = stepping(n, still) ? at % n : 0, cls = `bu-sprite${shadow ? ' shadow' : ''}${className ? ` ${className}` : ''}`;
  const item = held && HELD[held] ? held : null, k = heldScale(scale);
  /** The held item, its base on (ax, ay): the anchor in css px from the sprite's top left. */
  const heldAt = (ax: number, ay: number) => {
    if (!item) return null;
    const [bx, by] = HELD[item];
    return <img className="bu-held" src={spriteUrl(item)} width={SPRITE * k} height={SPRITE * k} alt="" draggable={false} data-held={item}
      style={{ width: SPRITE * k, height: SPRITE * k, left: Math.round(ax - bx * k), top: Math.round(ay - by * k) }} />;
  };
  if (art) {
    const [x0, y0, w, h] = FRAMES[def.id].box, s = fitScale(scale, w, h, box), [ax, ay] = headOf(def.id, on);
    return (
      <span className={`${cls} old`} style={{ width: w * s, height: h * s }} aria-hidden="true" data-art={def.id}>
        <span className="bu-frame">
          <img src={spriteUrl(def.id)} width={Math.round(art.n * art.w * s)} height={Math.round(art.h * s)} alt="" draggable={false}
            style={{ width: art.n * art.w * s, height: art.h * s, left: -(on * art.w + x0) * s, top: -y0 * s }} />
        </span>
        {heldAt((ax - x0) * s, (ay - y0 + SINK_OLD) * s)}
      </span>
    );
  }
  const px = SPRITE * scale, [ax, ay] = headOf(poses[on]);
  return (
    <span className={cls} style={{ width: px, height: px }} aria-hidden="true">
      {poses.map((p, i) => <img key={p} src={spriteUrl(p)} width={px} height={px} alt="" draggable={false} hidden={i !== on} />)}
      {heldAt(ax * scale, (ay + SINK) * scale)}
    </span>
  );
}
