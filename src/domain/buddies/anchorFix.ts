import { HEAD } from './anchors';

// Hand fixes for the head anchors (plan §16.3: "any frame can be overridden"). The automatic anchor is the top-most pixels,
// which on a creature drawn side-on is a hump or a raised wing, not its head. Each was read by eye on ?check=anchors and is
// kept honest by anchors.test (a real pose, a real move, and an opaque pixel under it). Sprite pixels, as anchors.ts.
export const HEAD_FIX: Readonly<Record<string, readonly [number, number]>> = {
  c053: [11.5, 2], // the pegasus: its head, not the wing behind it
  c105: [11, 2], c106: [11, 2], // the griffins: the eagle's head, right of the wing
  c107: [10.5, 2], c108: [10.5, 2], // the winged lion and the chimera: the lion's mane
  c130: [11.5, 0], // the camel: its head, not between head and hump
  c070: [8, 5], c131: [8, 5], c133: [8.5, 5], c135: [8.5, 5], c137: [8.5, 5], c139: [8, 6], // wings raised: the head between them
};

/** A pose's head anchor: its hand fix, else the one worked out from its sprite. */
export const headOf = (pose: string): readonly [number, number] => HEAD_FIX[pose] ?? HEAD[pose] ?? [8, 0];
