import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';
import { POSE_MS } from '../../ui/buddies/BuddySprite';
import { accName } from '../../ui/buddies/Worn';
import { HELD } from './anchors';
import { guess, leaveOneOut, MOST, NEAR, plainWear, type Body, type Look, type Marks, type Wear, type World } from './guess';
import { ACCESSORIES, BUDDIES, CREDIT_ROWS, defaultName, packOf } from './roster';
import { WORLD } from './wear';

// The learned guesses (domain/buddies/guess): which marks teach a frame, how a mark moves from one shape to another, the
// leave-one-out check on synthetic marks, and the placer's generated copy of the maths and of the app's buddies.
// `UPDATE_PLACER=1 npx vitest run src/domain/buddies/guess.test.ts` writes that copy into public/tools/accessory-placer.html.

const look = (head: [number, number], k = 1, top = [4, 2, 0, 0, 0, 0, 2, 4]): Look =>
  ({ head: [head[0] * k, head[1] * k], box: [0, 0, 12 * k, 12 * k], neck: 8 * k, top: top.map((t) => t * k) });
const body = (looks: Look[], pack = 'P'): Body => ({ pack, strip: 'idle', sink: 1, size: 8, looks });
const mark = (x: Partial<Wear> = {}): Wear => ({ x: 7, y: 2, w: 6, h: 4, r: 30, f: false, ...x });

describe('a held item’s guess', () => {
  it('the same buddy first: its nearest placed frame, before it first, moved with the head', () => {
    const world: World = { a: body([look([6, 0]), look([7, 1]), look([5, 0])]), b: body([look([6, 0])]) };
    const marks: Marks = { a: { 1: mark() }, b: { 0: mark({ x: 1 }) } };
    expect(guess(marks, world, 'a', 1)).toEqual({ wear: mark(), how: 'own', from: ['a'] });
    expect(guess(marks, world, 'a', 2)).toEqual({ wear: mark({ x: 5, y: 1 }), how: 'own', from: ['a'] });
    expect(guess(marks, world, 'a', 0)).toEqual({ wear: mark({ x: 6, y: 1 }), how: 'own', from: ['a'] });
  });
  it('else a buddy shaped like it: read from the head anchor in units of its size, so twice as big is twice as far and as big', () => {
    const world: World = { a: body([look([6, 0])]), big: body([look([6, 0], 2)], 'Q') };
    const g = guess({ a: { 0: mark({ x: 7, y: 2 }) } }, world, 'big', 0);
    expect(g).toEqual({ wear: { x: 14, y: 4, w: 12, h: 8, r: 30, f: false }, how: 'like', from: ['a'] });
  });
  it('the nearer in shape counts more, and no more than MOST teach', () => {
    const near = look([6, 0], 1, [4, 2, 0, 0, 0, 0, 2, 4]), far = look([6, 0], 1, [4, 2, 0, 0, 0, 0, 2, 6]);
    const world: World = { me: body([near]), n: body([near]), f: body([far]) };
    const g = guess({ n: { 0: mark({ x: 6 }) }, f: { 0: mark({ x: 8 }) } }, world, 'me', 0)!;
    expect(g.how).toBe('like');
    expect(g.from).toEqual(['n', 'f']);
    expect(g.wear.x).toBeGreaterThan(6);
    expect(g.wear.x).toBeLessThan(7); // between, nearer n's
    const many: World = Object.fromEntries(['me', 'p', 'q', 'r', 's'].map((id) => [id, body([near])]));
    const m4 = Object.fromEntries(['p', 'q', 'r', 's'].map((id, i) => [id, { 0: mark({ x: 6 + i }) }]));
    expect(guess(m4, many, 'me', 0)!.from).toEqual(['p', 'q', 'r'].slice(0, MOST));
    expect(guess(m4, many, 'me', 0)!.wear.x).toBe(7); // p, q, r alike: their mean
  });
  it('tilts average round the turn, not through zero', () => {
    const l = look([6, 0]), world: World = { me: body([l]), p: body([l]), q: body([l]) };
    expect(guess({ p: { 0: mark({ r: 170 }) }, q: { 0: mark({ r: -170 }) } }, world, 'me', 0)!.wear.r).toBe(180);
  });
  it('else its own pack’s nearest, mirrored when the two face opposite ways; nothing near and none of its pack: null', () => {
    const right = look([10, 1]), left = look([2, 1]);
    const world: World = { r: body([right]), l: body([left]), other: body([left], 'Q') };
    const marks: Marks = { r: { 0: mark({ x: 12, y: 3, r: 30, f: false }) } };
    const g = guess(marks, world, 'l', 0)!;
    expect(g.how).toBe('pack');
    expect(g).toEqual({ wear: { x: 0, y: 3, w: 6, h: 4, r: -30, f: true }, how: 'pack', from: ['r'] });
    expect(guess(marks, world, 'other', 0)).toBeNull();
    expect(guess({}, world, 'l', 0)).toBeNull();
    expect(guess(marks, world, 'nobody', 0)).toBeNull();
    expect(guess(marks, world, 'l', 5)).toBeNull();
  });
  it('NEAR lets about a tenth of the roster’s pairs teach each other, each buddy’s nearest almost always among them', () => {
    // Not a number to tune here: a check that the threshold still means "shaped alike" on the sprites as they are.
    const ids = Object.keys(WORLD), d = (a: string, b: string) => {
      const g = guess({ [b]: { 0: { x: 0, y: 0, w: 1, h: 1, r: 0, f: false } } }, WORLD, a, 0);
      return g?.how === 'like';
    };
    let pairs = 0, near = 0;
    for (let i = 0; i < ids.length; i += 3) for (let j = 0; j < ids.length; j += 3) if (i !== j) { pairs++; if (d(ids[i], ids[j])) near++; }
    expect(near / pairs).toBeGreaterThan(0.04);
    expect(near / pairs).toBeLessThan(0.25);
    expect(NEAR).toBeGreaterThan(0);
  });
});

/** Synthetic marks on the real roster by a rule read in each frame's own units: what a hand that follows one idea would place. */
const unitOf = (l: Look) => Math.sqrt(l.box[2] * l.box[3]);
const ruled = (rule: (id: string, l: Look, f: number) => { dx: number; dy: number; s: number; r: number }, frames: (id: string) => number[] = () => [0]): Marks =>
  Object.fromEntries(Object.entries(WORLD).map(([id, b]) => [id, Object.fromEntries(frames(id).filter((f) => b.looks[f]).map((f) => {
    const l = b.looks[f], u = unitOf(l), { dx, dy, s, r } = rule(id, l, f), c = (v: number) => Math.round(v * 100) / 100;
    return [f, { x: c(l.head[0] + dx * u), y: c(l.head[1] + dy * u), w: c(s * u), h: c(s * u), r, f: false }];
  }))]));
const seeded = (id: string) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h / 9973; };

describe('leave one out', () => {
  it('one idea held to everywhere (a cap just above the head, half the body’s size): learned back almost exactly', () => {
    const rep = leaveOneOut(ruled(() => ({ dx: 0, dy: -0.05, s: 0.5, r: 0 })), WORLD);
    expect(rep.n).toBe(BUDDIES.length);
    expect(rep.by.like.n + rep.by.pack.n).toBe(rep.n); // every buddy has some neighbour or pack-mate
    expect(rep.pos).toBeLessThan(0.02);
    expect(rep.size).toBeLessThan(0.005);
    expect(rep.tilt).toBe(0);
    expect(rep.flips).toBe(0);
  });
  it('a hand with no idea (each buddy its own random place, size and tilt): far off, so the check can tell', () => {
    const rep = leaveOneOut(ruled((id) => ({ dx: seeded(id) - 0.5, dy: seeded(id + 'y') - 0.5, s: 0.2 + seeded(id + 's'), r: Math.round(seeded(id + 'r') * 360 - 180) })), WORLD);
    expect(rep.pos).toBeGreaterThan(2);
    expect(rep.size).toBeGreaterThan(0.2);
    expect(rep.tilt).toBeGreaterThan(40);
  });
  it('every frame of a character placed, moving with its head: its own other frames teach it exactly', () => {
    const old = BUDDIES.filter((b) => b.art && b.art.n > 1).map((b) => b.id);
    const marks = Object.fromEntries(Object.entries(ruled(() => ({ dx: 0.1, dy: 0, s: 0.4, r: 15 }), (id) => WORLD[id].looks.map((_, f) => f))).filter(([id]) => old.includes(id)));
    // The rule in each frame's own units; the same buddy's frames teach by the head's move alone, so a frame whose box changed
    // size lands a little off: within half a pixel on the little ones, a few on the Dudes' fine pixels.
    const rep = leaveOneOut(marks, WORLD);
    expect(rep.by.own.n).toBe(rep.n);
    for (const m of rep.misses) expect(m.pos, `${m.id} ${m.f}`).toBeLessThan(m.id.startsWith('dude') ? 6 : 0.75);
    expect(rep.tilt).toBe(0);
  });
  it('a mark nobody could teach is scored against the head anchor the app falls back on', () => {
    const world: World = { a: body([look([6, 1])]) }, truth = mark({ x: 9, y: 6, w: 8, h: 8, r: 0 });
    const rep = leaveOneOut({ a: { 0: truth } }, world), plain = plainWear(world.a, 0);
    expect(rep.by.anchor.n).toBe(1);
    expect(rep.misses[0]).toMatchObject({ how: 'anchor', pos: Math.hypot(9 - plain.x, 6 - plain.y), size: 0, tilt: 0, flip: false });
  });
  it('runs on a pasted Copy from the command line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guess-eval-'));
    try {
      const file = join(dir, 'marks.json'), m = ruled(() => ({ dx: 0, dy: -0.05, s: 0.5, r: 0 }));
      const held = Object.fromEntries(Object.entries(m).map(([id, fs]) => [id, { [WORLD[id].strip]: fs }]));
      writeFileSync(file, JSON.stringify({ head: { ckbirb: { idle: { 0: mark() } } }, held }));
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/guess-eval.mjs', import.meta.url)), file], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain(`${BUDDIES.length} marks on ${BUDDIES.length} buddies`);
      expect(run.stdout).toMatch(/^all\s+168\s+0\.0\d\s+0\.\d%\s+0\.0°\s+0$/m);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------- The placer's copy ----------
const PAGE = new URL('../../../public/tools/accessory-placer.html', import.meta.url);
const BEGIN = 'const G = (() => {', END = '})();\n// ---------- end of guess.ts ----------';
const source = readFileSync(new URL('./guess.ts', import.meta.url), 'utf8');
const exported = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const code = (await transformWithOxc(source, 'guess.ts', { lang: 'ts' })).code.replace(/^export /gm, '').trimEnd();
const block = `${BEGIN}\n${code}\nreturn { ${exported.join(', ')} };\n${END}`;
const packs = CREDIT_ROWS.map((c) => c.what).filter((p) => BUDDIES.some((b) => packOf(b.id) === p));
const app = {
  held: Object.fromEntries(ACCESSORIES.filter((a) => a.sprite).map((a) => [a.id, [accName(a.id), ...HELD[a.id]]])),
  packs,
  buddies: packs.flatMap((p) => BUDDIES.filter((b) => packOf(b.id) === p)).map((b) => ({
    id: b.id, name: defaultName(b.id), pack: packOf(b.id), w: b.art?.w ?? 16, h: b.art?.h ?? 16, ms: b.art ? b.art.ms : POSE_MS, files: b.art ? [b.id] : [...b.poses],
  })),
  world: WORLD,
};
const appLine = `const APP = ${JSON.stringify(app)};`;
if (process.env.UPDATE_PLACER) {
  const page = readFileSync(PAGE, 'utf8'), a = page.indexOf(BEGIN), z = page.indexOf(END);
  if (a < 0 || z < 0) throw new Error('the placer lost its guess.ts markers');
  const lines = (page.slice(0, a) + block + page.slice(z + END.length)).split('\n').map((l) => (l.startsWith('const APP = ') ? appLine : l));
  writeFileSync(PAGE, lines.join('\n'));
}

describe('the placer’s copy', () => {
  const page = readFileSync(PAGE, 'utf8');
  it('has guess.ts as the app runs it, word for word', () => {
    expect(page.slice(page.indexOf(BEGIN), page.indexOf(END) + END.length)).toBe(block);
  });
  it('has every buddy, every held item on its base, and every frame’s shape and head anchor as the app sees them', () => {
    expect(page.split('\n').filter((l) => l.startsWith('const APP = '))).toEqual([appLine]);
    expect(app.buddies.length).toBe(BUDDIES.length);
    expect(new Set(app.buddies.map((b) => b.id)).size).toBe(BUDDIES.length);
    expect(app.buddies.filter((b) => !BUDDIES.find((x) => x.id === b.id)!.art).length).toBe(145);
  });
});
