// Every frame of every buddy that moves, its held item kept on its hand (owner 2026-11-16: "fix all the animations and accessory
// placements for all the sprites"): writes src/domain/buddies/tracked.ts from the owner's marks (src/domain/buddies/marks.ts) and
// the sprites themselves (public/buddies). Run it after baking a new Copy (scripts/bake-marks.mjs), then
// `UPDATE_PLACER=1 npx vitest run src/domain/buddies/guess.test.ts` so the placer shows the same.
//
//   node scripts/track-held.mjs           write tracked.ts, and say what moved
//   node scripts/track-held.mjs --check   exit 1 if tracked.ts isn't what this would write (tracked.test runs it)
//
// A strip whose frames are one drawing moving (an older character's idle) has its hand followed pixel for pixel
// (domain/buddies/track): the hand is the sprite's pixels along the first stretch of the handle on a frame the owner placed, found
// again on every frame near where it was. The item's place on the hand is the middle of where his marks put it, frame by frame
// (so one stray mark doesn't pull the rest), at the size, tilt and mirror most of his frames share. A Tiny buddy's poses are
// separate drawings, so each says by hand what holds the item (WAYS). His own mark stays wherever it is within half a pixel of
// that; a mark further off is moved onto the hand, and SUPERSEDED keeps it as he placed it.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PLACED } from '../src/domain/buddies/marks.ts';
import { crop, decodePng, follow, gripBox } from '../src/domain/buddies/track.ts';

const check = process.argv.includes('--check');
const OUT = new URL('../src/domain/buddies/tracked.ts', import.meta.url);
const page = readFileSync(new URL('../public/tools/accessory-placer.html', import.meta.url), 'utf8');
// The app's buddies as the placer has them (guess.test keeps that copy exact): each one's files, frame width and frames.
const { world, buddies } = JSON.parse(page.split('\n').find((l) => l.startsWith('const APP = ')).slice('const APP = '.length, -1));

/** How far off the hand one of his marks may sit and stay as he placed it: the placer's own grain, half a pixel. */
export const KEEP = 0.5;

// The birds (c131–c140): wings up in their first pose, perched with wings folded in their second, the feet one pixel higher
// there. He placed the item in the perched bird's feet; up in the raised wing on the first pose (owner 2026-11-16, "fix all":
// a flap, not a grip). So the first pose holds it as the second does, carried by the feet.
const FEET = { from: 1, hand: [[6, 13], [6, 12]], why: 'in its feet, as he placed the perched pose' };
/** What holds the item where the frames are separate drawings (a Tiny buddy's poses): `from` the pose whose mark the rest follow,
 *  and each pose's hand, a pixel of the same colour in each (checked) that moves as the grip does; or `keep`, his marks as placed. */
const WAYS = {
  c131: FEET, c133: FEET, c135: FEET, c137: FEET, c139: FEET,
  // No hands: the item leans on the ground beside them, the body squashing over it; he placed both poses so.
  c066: { keep: true, why: 'no hands: leaning on the ground, both poses as he placed them' },
  c114: { keep: true, why: 'no hands: leaning on the ground, both poses as he placed them' },
  // The mimic: no hands; its foot stays put while the lid opens (his last two poses had followed the lid up two pixels).
  d090: { from: 0, hand: [[2, 15], [2, 15], [2, 15], [2, 15]], why: 'no hands: on its foot, which stays put as the lid opens' },
  // Mr. Dude, never placed: his arms are Mrs. Dude's, pixel for pixel in outline, so he holds it as she does, found by outline.
  dudemr: { twin: 'dudemrs', why: 'his arms are Mrs. Dude’s: held as she holds it' },
};

const png = (f) => decodePng(readFileSync(new URL(`../public/buddies/${f}.png`, import.meta.url)), inflateSync);
const framesOf = (b) => (world[b.id].strip === 'poses' ? b.files.map(png) : ((s) => world[b.id].looks.map((_, f) => crop(s, f * b.w, b.w)))(png(b.id)));
const cent = (v) => Math.round(v * 100) / 100;
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (vs) => { const s = [...vs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const gripOf = (m) => `${m.w} ${m.h} ${m.r} ${m.f}`;
const at = (m, dx, dy) => ({ x: cent(m.x + dx), y: cent(m.y + dy), w: m.w, h: m.h, r: m.r, f: m.f });

/** One drawing moving: the hand followed from the placed frame that agrees best with his others, the item at the middle of his. */
function followed(frames, marks) {
  const set = Object.keys(marks).map(Number).sort((a, b) => a - b), count = new Map();
  for (const f of set) count.set(gripOf(marks[f]), (count.get(gripOf(marks[f])) ?? 0) + 1);
  const grip = [...count].sort((a, b) => b[1] - a[1])[0][0], same = set.filter((f) => gripOf(marks[f]) === grip);
  const reach = Math.max(3, Math.round(Math.max(frames[0].w, frames[0].h) / 6));
  let best = null;
  for (const r of same) {
    const box = gripBox(frames[r], marks[r]);
    if (!box) continue;
    const moved = frames.map((fr) => follow(frames[r], fr, box, reach));
    const errs = same.filter((k) => k !== r).map((k) => apart(marks[k], { x: marks[r].x + moved[k].dx, y: marks[r].y + moved[k].dy }));
    const err = errs.length ? median(errs) : 0;
    if (!best || err < best.err - 1e-9) best = { r, moved, err };
  }
  if (!best) throw new Error('no placed frame has a hand near its handle');
  // Where on the hand: where most of his marks put it exactly, a third of them at least (the earliest such frame's on a tie: he
  // placed one and took the guesses for the rest, which moved with the head, not the hand); else (each placed by hand, a little
  // apart) the middle of them.
  const rel = same.map((k) => ({ k, x: marks[k].x - best.moved[k].dx, y: marks[k].y - best.moved[k].dy }));
  const agree = rel.map((a) => ({ ...a, n: rel.filter((b) => apart(a, b) <= 0.01).length })).sort((a, b) => b.n - a.n || a.k - b.k)[0];
  const enough = agree.n >= Math.max(2, Math.ceil(rel.length / 3)), o = enough ? agree : { x: median(rel.map((a) => a.x)), y: median(rel.map((a) => a.y)) };
  const m = marks[same[0]], how = enough ? `where ${agree.n} of his ${rel.length} marks put it` : `the middle of his ${rel.length} marks`;
  return { why: `hand followed from frame ${best.r + 1}, ${how}`, at: frames.map((_, k) => at({ ...m, x: o.x, y: o.y }, best.moved[k].dx, best.moved[k].dy)) };
}

const pixel = (img, [x, y]) => Array.from(img.px.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)).join();

const TRACKED = {}, SUPERSEDED = {}, notes = [], done = {};
const order = [...buddies].sort((a, b) => (WAYS[a.id]?.twin ? 1 : 0) - (WAYS[b.id]?.twin ? 1 : 0)); // a twin after its other
for (const b of order) {
  const body = world[b.id], n = body.looks.length;
  if (n < 2) continue;
  const way = WAYS[b.id], mine = PLACED[b.id] ?? {}, frames = framesOf(b);
  let out, why;
  if (way?.keep) {
    if (Object.keys(mine).length !== n) throw new Error(`${b.id}: kept as placed, but not every frame is`);
    out = frames.map((_, f) => mine[f]); why = way.why;
  } else if (way?.twin) {
    const other = buddies.find((x) => x.id === way.twin), theirs = framesOf(other), held = done[way.twin];
    out = frames.map((fr, f) => {
      const t = follow(theirs[f], fr, gripBox(theirs[f], held[f]), 4, true);
      return at(held[f], t.dx, t.dy);
    });
    why = way.why;
  } else if (way) {
    const from = mine[way.from];
    if (!from) throw new Error(`${b.id}: pose ${way.from + 1} isn't placed`);
    const [hx, hy] = way.hand[way.from];
    out = frames.map((fr, f) => {
      if (pixel(fr, way.hand[f]) !== pixel(frames[way.from], way.hand[way.from]) || fr.px[(way.hand[f][1] * fr.w + way.hand[f][0]) * 4 + 3] < 128)
        throw new Error(`${b.id}: pose ${f + 1}'s hand pixel isn't pose ${way.from + 1}'s`);
      return at(from, way.hand[f][0] - hx, way.hand[f][1] - hy);
    });
    why = way.why;
  } else if (body.strip === 'poses') throw new Error(`${b.id}: a Tiny buddy of several poses needs a way (WAYS)`);
  else ({ at: out, why } = followed(frames, mine));
  // His mark wherever it's within KEEP of the hand's place and has the animation's size, tilt and mirror.
  const fin = out.map((p, f) => (mine[f] && gripOf(mine[f]) === gripOf(p) && apart(mine[f], p) <= KEEP + 1e-9 ? mine[f] : p));
  done[b.id] = fin;
  TRACKED[b.id] = fin;
  fin.forEach((p, f) => {
    if (mine[f] && p !== mine[f]) (SUPERSEDED[b.id] ??= {})[f] = mine[f];
  });
  const moved = fin.filter((p, f) => mine[f] && p !== mine[f]).length, filled = fin.filter((_, f) => !mine[f]).length;
  notes.push({ id: b.id, n, kept: n - moved - filled, moved, filled, why });
}

const mark = (w) => `{ x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h}, r: ${w.r}, f: ${w.f} }`;
const key = (k) => (/^[a-z_$][\w$]*$/i.test(k) ? k : JSON.stringify(k));
const rows = (m, say) => buddies.filter((b) => m[b.id]).map((b) =>
  `${say ? `  // ${b.id}: ${say(b.id)}\n` : ''}  ${key(b.id)}: { ${Object.entries(m[b.id]).map(([f, w]) => `${f}: ${mark(w)}`).join(', ')} },`);
const said = (id) => { const t = notes.find((x) => x.id === id); return `${t.why}; ${t.kept} as placed, ${t.moved} moved, ${t.filled} filled`; };
const sum = (k) => notes.reduce((s, t) => s + t[k], 0);
const text = `// GENERATED by scripts/track-held.mjs from the owner's marks (domain/buddies/marks) and the sprites (public/buddies); run it again
// after baking a new Copy, and change its ways rather than this.
import type { Marks } from './guess';

/** Every frame of every buddy that moves (${notes.length} buddies, ${sum('n')} frames), its held item on its hand (domain/buddies/track): the owner's mark
 *  where it sits within half a pixel of the hand's place (${sum('kept')}), else moved there (${sum('moved')}) or filled in (${sum('filled')}). Frame (a Tiny
 *  buddy's pose) → placement, in the frame's own pixels, as domain/buddies/guess Wear. Over the owner's marks in WEAR. */
export const TRACKED: Marks = {
${rows(TRACKED, said).join('\n')}
};

/** His marks that TRACKED moved, as he placed them: a phone whose placer copy still has one of these exactly draws TRACKED's
 *  (domain/buddies/wear unmoved, and the placer). */
export const SUPERSEDED: Marks = {
${rows(SUPERSEDED).join('\n')}
};
`;
if (check) {
  let was = '';
  try { was = readFileSync(OUT, 'utf8'); } catch { /* none yet */ }
  if (was !== text) { console.error('src/domain/buddies/tracked.ts is out of date: run node scripts/track-held.mjs'); process.exit(1); }
  console.log('tracked.ts is up to date.');
} else {
  writeFileSync(OUT, text);
  for (const t of notes) console.log(`${t.id.padEnd(10)} ${String(t.n).padStart(2)} frames: ${t.kept} kept, ${t.moved} moved, ${t.filled} filled; ${t.why}`);
  for (const [id, fs] of Object.entries(SUPERSEDED)) for (const [f, w] of Object.entries(fs)) {
    const now = TRACKED[id][f];
    console.log(`  ${id} ${world[id].strip === 'poses' ? 'pose' : 'frame'} ${Number(f) + 1}: (${w.x}, ${w.y}) w ${w.w} r ${w.r} → (${now.x}, ${now.y}) w ${now.w} r ${now.r}`);
  }
  console.log(`Wrote tracked.ts: ${notes.length} buddies, ${sum('n')} frames; ${sum('kept')} as placed, ${sum('moved')} moved, ${sum('filled')} filled.`);
}
