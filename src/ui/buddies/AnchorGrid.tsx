import { HEAD } from '../../domain/buddies/anchors';
import { BUDDIES, defaultName } from '../../domain/buddies/roster';
import { spriteUrl, SPRITE } from './BuddySprite';

// The head anchors' check grid (plan §16.3): every pose of every buddy at 3×, with its anchor (domain/buddies/anchors, worked
// out from the sprite's top-most pixels) marked red and a stand-in cap sat on it, to be read by eye at 320 and 375 wide.
// Opened at ?check=anchors; nothing in the app links to it.

const S = 3, CAP_W = 8, CAP_H = 3, SINK = 2;

export default function AnchorGrid() {
  const poses = BUDDIES.flatMap((b) => b.poses.map((p, i) => ({ p, b, i })));
  return (
    <main className="screen anchor-check">
      <h1>Head anchors</h1>
      <p className="muted small">{poses.length} poses of {BUDDIES.length} buddies at {S}×. Red: the anchor (the top-most pixels, centred over the top three rows). Blue: an {CAP_W}-pixel cap sat {SINK} pixels into the head.</p>
      <ul className="anchor-grid">
        {poses.map(({ p, b, i }) => {
          const [x, y] = HEAD[p];
          return (
            <li key={p} data-pose={p}>
              <span className="anchor-box" style={{ width: SPRITE * S, height: SPRITE * S }}>
                <img src={spriteUrl(p)} width={SPRITE * S} height={SPRITE * S} alt="" />
                <i className="anchor-cap" style={{ left: (x - CAP_W / 2) * S, top: (y + SINK - CAP_H) * S, width: CAP_W * S, height: CAP_H * S }} />
                <i className="anchor-dot" style={{ left: x * S - 2, top: y * S - 2 }} />
              </span>
              <small>{defaultName(b.id)}{b.poses.length > 1 ? ` ${i + 1}` : ''}<br />{p}</small>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
