import { HEAD_FIX, headOf } from '../../domain/buddies/anchorFix';
import { FRAMES } from '../../domain/buddies/anchors';
import { BUDDIES, defaultName } from '../../domain/buddies/roster';
import { fitScale, spriteUrl, SPRITE } from './BuddySprite';

// The head anchors' check grid (plan §16.3): every pose of every buddy at 3×, with its anchor (domain/buddies/anchors, worked
// out from the sprite's top-most pixels) marked red and a stand-in cap sat on it, to be read by eye at 320 and 375 wide. An
// older character shows every frame of its strip, its pixels' box only, at 3× where that fits a cell (else smaller, crisp).
// Opened at ?check=anchors; nothing in the app links to it.

const S = 3, CAP_W = 8, CAP_H = 3, SINK = 2, CELL = [60, 72] as const;

export default function AnchorGrid() {
  const cells = BUDDIES.flatMap((b) => (b.art ? Array.from({ length: b.art.n }, (_, i) => ({ p: b.id, b, i })) : b.poses.map((p, i) => ({ p, b, i }))));
  return (
    <main className="screen anchor-check">
      <h1>Head anchors</h1>
      <p className="muted small">{cells.length} poses and frames of {BUDDIES.length} buddies at {S}×. Red: the anchor (the top-most pixels, centred over the top three rows). Blue: an {CAP_W}-pixel cap sat {SINK} pixels into the head. “fixed”: placed by hand (anchorFix).</p>
      <ul className="anchor-grid">
        {cells.map(({ p, b, i }) => {
          const [x, y] = headOf(p, i), art = b.art;
          const [x0, y0, w, h] = art ? FRAMES[b.id].box : [0, 0, SPRITE, SPRITE], s = art ? fitScale(S, w, h, CELL) : S;
          return (
            <li key={`${p}.${i}`} data-pose={p}>
              <span className="anchor-box" style={{ width: w * s, height: h * s }}>
                {art
                  ? <span className="bu-frame"><img src={spriteUrl(p)} alt="" style={{ position: 'absolute', maxWidth: 'none', width: art.n * art.w * s, height: art.h * s, left: -(i * art.w + x0) * s, top: -y0 * s }} /></span>
                  : <img src={spriteUrl(p)} width={SPRITE * S} height={SPRITE * S} alt="" />}
                <i className="anchor-cap" style={{ left: (x - x0 - CAP_W / 2) * s, top: (y - y0 + SINK - CAP_H) * s, width: CAP_W * s, height: CAP_H * s }} />
                <i className="anchor-dot" style={{ left: (x - x0) * s - 2, top: (y - y0) * s - 2 }} />
              </span>
              <small>{defaultName(b.id)}{b.art ? (b.art.n > 1 ? ` ${i + 1}` : '') : b.poses.length > 1 ? ` ${i + 1}` : ''}<br />{p}{HEAD_FIX[p] ? ' fixed' : ''}</small>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
