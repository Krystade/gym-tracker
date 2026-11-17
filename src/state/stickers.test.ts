import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRecentStickers, getStickerLibrary, putRecentStickers, resetDbForTests } from '../db/db';
import { stickerId } from '../domain/stickerLibrary';
import { forgetStickers, keepFromThread, keepStickers, readStickers, removeSticker, resetStickersForTests, restoreSticker, setFavourite } from './stickers';

const src = (n: number | string) => `data:image/png;base64,${btoa(`sticker-${n}`).replace(/=+$/, '')}`;
/** What a fresh launch reads: memory gone, the phone's copy read again. */
const relaunch = async (uid: string) => { resetStickersForTests(); return readStickers(uid); };

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); resetDbForTests(); resetStickersForTests(); });

describe('your stickers on the phone', () => {
  it('keeps what you send and what a thread has, once each, per account, through a relaunch', async () => {
    await keepStickers('me', [{ src: src(1), at: 10, sent: true }], true);
    await keepFromThread('me', [{ id: 'd1', at: 20, sticker: src(2) }, { id: 'd2', at: 21 }, { id: 'd3', at: 22, sticker: src(1) }]);
    await keepFromThread('other', [{ id: 'd9', at: 5, sticker: src(9) }]);
    const lib = await relaunch('me');
    expect(lib.map((s) => s.src).sort()).toEqual([src(1), src(2)].sort());
    expect(lib.find((s) => s.src === src(1))).toMatchObject({ at: 22, sent: 10 });
    expect((await readStickers('other')).map((s) => s.src)).toEqual([src(9)]);
  });

  it('ignores anything the rules wouldn’t take', async () => {
    await keepStickers('me', [{ src: 'data:image/gif;base64,AAAA', at: 1 }, { src: 'https://example.com/x.png', at: 2 }], true);
    expect(await relaunch('me')).toEqual([]);
  });

  it('keeps a removed one out when a thread has it again, until you send it; Undo puts it back as it was', async () => {
    await setFavourite('me', src(1), true);
    const was = await removeSticker('me', stickerId(src(1)));
    expect(was?.fav).toBeTypeOf('number');
    await keepFromThread('me', [{ id: 'd1', at: 99, sticker: src(1) }]);
    expect(await relaunch('me')).toEqual([]);
    await keepFromThread('me', [{ id: 'd1', at: 99, sticker: src(1) }]); // a new session looks at the thread again
    expect(await relaunch('me')).toEqual([]);
    await restoreSticker('me', was!);
    expect((await relaunch('me'))[0]).toEqual(was);
    await removeSticker('me', stickerId(src(1)));
    await keepStickers('me', [{ src: src(1), at: 200, sent: true }], true);
    expect((await relaunch('me')).map((s) => s.src)).toEqual([src(1)]);
    expect((await getStickerLibrary('me')).removed).toEqual([]);
  });

  it('makes a thread’s sticker a favourite, keeping it if it wasn’t, and takes the favourite away again', async () => {
    await setFavourite('me', src(3), true);
    expect((await relaunch('me'))[0].fav).toBeTypeOf('number');
    await setFavourite('me', src(3), false);
    const [s] = await relaunch('me');
    expect(s.src).toBe(src(3));
    expect(s.fav).toBeUndefined();
  });

  it('moves the recent row from before the library in once, in its order, as sent', async () => {
    await putRecentStickers([src('new'), src('old')]);
    const lib = await relaunch('me');
    const by = Object.fromEntries(lib.map((s) => [s.src, s]));
    expect(by[src('new')].sent).toBeGreaterThan(by[src('old')].sent!);
    expect(await getRecentStickers()).toEqual([]);
  });

  it('keeps nothing of anyone’s once you sign out', async () => {
    await keepStickers('me', [{ src: src(1), at: 1 }], true);
    await removeSticker('me', stickerId(src(1)));
    await keepStickers('me', [{ src: src(2), at: 1 }], true);
    await forgetStickers();
    expect(await getStickerLibrary('me')).toEqual({ lib: [], removed: [] });
  });
});
