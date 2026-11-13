import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAMES, HELD } from './anchors';
import { headOf } from './anchorFix';
import { heldStyle, parseWear, turn, wearFromMarks, wearOn, type Wear } from './wear';
import { ACCESSORIES, BUDDIES } from './roster';

// A held item placed by hand (domain/buddies/wear): the placer's marks read as untrusted, its unmarked frames following the head
// anchor, and the maths that puts the sprite on the page, stretched, turned and mirrored about its base.

const mark = (x: Partial<Wear> = {}): Wear => ({ x: 7, y: 1, w: 8, h: 8, r: 0, f: false, ...x });

describe('what a held item wears', () => {
  it('reads a mark; one from before width and height came apart keeps its shape; a bad one is left out', () => {
    expect(parseWear({ x: 5.5, y: 1, w: 7, h: 12, r: 30, f: true })).toEqual({ x: 5.5, y: 1, w: 7, h: 12, r: 30, f: true });
    expect(parseWear({ x: 5.5, y: 1, w: 7, r: 0, f: false })).toEqual({ x: 5.5, y: 1, w: 7, h: 7, r: 0, f: false });
    expect(parseWear({ x: 5.5, y: 1, w: 7 })).toEqual({ x: 5.5, y: 1, w: 7, h: 7, r: 0, f: false });
    for (const bad of [null, 3, {}, { x: 1, y: 1 }, { x: 1, y: 1, w: 0 }, { x: 1, y: 1, w: 4, h: -1 }, { x: 'a', y: 1, w: 4 }, { x: 1, y: 1, w: 4, r: Infinity }])
      expect(parseWear(bad), JSON.stringify(bad)).toBeNull();
    expect(parseWear({ x: 1, y: 1, w: 4, f: 'yes' })?.f).toBe(false);
  });
  it('a tilt is one full turn, either way round', () => {
    expect([0, 90, 180, 200, 359, 360, -90, -180, -200, 540].map(turn)).toEqual([0, 90, 180, -160, -1, 0, -90, 180, 160, 180]);
    expect(parseWear({ x: 1, y: 1, w: 4, r: 200 })?.r).toBe(-160);
  });
  it('takes the placer’s Held marks on the strip the app shows, for the characters it draws from strips', () => {
    const birb = BUDDIES.find((b) => b.id === 'ckbirb')!, truck = BUDDIES.find((b) => b.id === 'truck')!;
    const got = wearFromMarks({
      head: { ckbirb: { idle: { 0: mark() } } }, // a beanie: not the app's
      held: {
        ckbirb: { idle: { 0: mark({ w: 6, h: 10, r: 200, f: true }), 2: { x: 6, y: 2, w: 5 }, [birb.art!.n]: mark(), x: mark() }, run: { 1: mark({ x: 0 }) } },
        truck: { still: { 0: mark({ x: 20 }) } },
        c002: { idle: { 0: mark() } }, // a Tiny buddy: the placer has none
        nobody: { idle: { 0: mark() } },
        ckpig: { idle: { 0: { x: 1 } } }, // nothing that reads
      },
    });
    expect(got).toEqual({ ckbirb: { 0: mark({ w: 6, h: 10, r: -160, f: true }), 2: mark({ x: 6, y: 2, w: 5, h: 5 }) }, truck: { 0: mark({ x: 20 }) } });
    expect(truck.art!.n).toBe(1);
    for (const x of [null, 'x', [], { held: 3 }, { held: { ckbirb: null } }]) expect(wearFromMarks(x)).toEqual({});
  });
  it('an unmarked frame follows the head anchor from the nearest marked one, before it first', () => {
    const head = (f: number) => [[6.5, 0], [7, 0], [6.5, 1], [6, 0]][f] as [number, number];
    const marks = { 1: mark({ x: 8, y: 1, w: 6, h: 10, r: 200, f: true }), 3: mark({ x: 2, y: 3 }) };
    expect(wearOn(marks, 1, head)).toBe(marks[1]);
    expect(wearOn(marks, 2, head)).toEqual({ ...marks[1], x: 7.5, y: 2 }); // from 1: the anchor went left half a pixel and down one
    expect(wearOn(marks, 0, head)).toEqual({ ...marks[1], x: 7.5, y: 1 }); // none before: from 1, after it
    expect(wearOn({}, 0, head)).toBeNull();
    expect(wearOn(undefined, 0, head)).toBeNull();
  });
});

describe('where the held sprite goes', () => {
  it('unplaced, as it always sat: its base on the anchor, square, whole css px, no transform', () => {
    expect(heldStyle([8, 16], [56, 16], 4)).toEqual({ left: 24, top: -48, width: 64, height: 64 });
    expect(heldStyle([5.5, 16], [10.3, 8], 2)).toEqual({ left: -1, top: -24, width: 32, height: 32 });
  });
  it('stretched: its own width and height, its base still on the anchor', () => {
    const st = heldStyle([8, 16], [56, 16], 2, 5);
    expect(st).toEqual({ left: 40, top: -64, width: 32, height: 80 });
    expect([st.left + 8 * 2, st.top + 16 * 5]).toEqual([56, 16]);
  });
  it('mirrored and turned about its base, mirrored first (as the placer draws it)', () => {
    const st = heldStyle([8, 16], [56, 16], 2, 5, 200, true);
    expect(st).toEqual({ left: 40, top: -64, width: 32, height: 80, transformOrigin: '16px 80px', transform: 'rotate(-160deg) scaleX(-1)' });
    expect(heldStyle([8, 16], [56, 16], 4, 4, 0, true).transform).toBe('rotate(0deg) scaleX(-1)');
    expect(heldStyle([8, 16], [56, 16], 4, 4, 360).transform).toBeUndefined();
    // On a rounded box, still about the anchor itself.
    expect(heldStyle([5.5, 16], [10.3, 8], 1.5, 1.5, 45).transformOrigin).toBe(`${10.3 - 2}px ${8 + 16}px`);
  });
  it('mirroring keeps the base where it is and swaps the sprite’s sides about it', () => {
    // A point of the sprite (u, v), its own pixels, on the page: CSS's rotate(r) scaleX(-1) about the origin, as a matrix.
    const onPage = (st: ReturnType<typeof heldStyle>, kx: number, ky: number, u: number, v: number, r: number, f: boolean) => {
      const [ox, oy] = st.transformOrigin ? st.transformOrigin.split(' ').map(parseFloat) : [0, 0];
      const x = u * kx - ox, y = v * ky - oy, a = (r * Math.PI) / 180, mx = f ? -x : x;
      return [st.left + ox + mx * Math.cos(a) - y * Math.sin(a), st.top + oy + mx * Math.sin(a) + y * Math.cos(a)].map((n) => Math.round(n * 1e6) / 1e6);
    };
    const st = heldStyle([8, 16], [56, 16], 2, 5, 0, true);
    expect(onPage(st, 2, 5, 8, 16, 0, true)).toEqual([56, 16]); // the base stays put
    expect(onPage(st, 2, 5, 0, 0, 0, true)).toEqual([72, -64]); // the top left goes to the top right
    const turned = heldStyle([8, 16], [56, 16], 2, 5, 180);
    expect(onPage(turned, 2, 5, 8, 0, 180, false)).toEqual([56, 96]); // upside down: its tip below the anchor
  });
});

describe('the placer’s copy of the app’s anchors', () => {
  const page = readFileSync(new URL('../../../public/tools/accessory-placer.html', import.meta.url), 'utf8');
  const line = page.split('\n').find((l) => l.startsWith('const APP = '));
  const app = JSON.parse(line!.slice('const APP = '.length, -1)) as { held: Record<string, [string, number, number]>; frames: Record<string, { box: number[]; head: number[][] }> };
  it('has every held item, on its base', () => {
    const items = ACCESSORIES.filter((a) => a.slot === 'held').map((a) => a.id);
    expect(Object.keys(app.held).sort()).toEqual([...items].sort());
    for (const id of items) expect([id, ...app.held[id].slice(1)]).toEqual([id, ...HELD[id]]);
  });
  it('has every older character’s box and the head anchor the app uses on each frame', () => {
    const old = BUDDIES.filter((b) => b.art);
    expect(Object.keys(app.frames).sort()).toEqual(old.map((b) => b.id).sort());
    for (const { id, art } of old) {
      expect([id, ...app.frames[id].box]).toEqual([id, ...FRAMES[id].box]);
      expect(app.frames[id].head).toEqual(Array.from({ length: art!.n }, (_, f) => [...headOf(id, f)]));
    }
  });
});
