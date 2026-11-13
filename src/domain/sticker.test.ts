import { describe, expect, it } from 'vitest';
import { fit, MAX_STICKER, pick, posterize, RECENT_MAX, STICKER_GOAL, STICKER_MAX, stickerBytes, stickerOk, trimBox, withRecent } from './sticker';

/** A data URL of `bytes` bytes of image. */
const url = (bytes: number, mime = 'png') => `data:image/${mime};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;

describe('sticker', () => {
  it('takes a WebP or PNG data URL up to the rules’ cap, nothing else', () => {
    expect(stickerOk(url(1000))).toBe(true);
    expect(stickerOk(url(1000, 'webp'))).toBe(true);
    expect(stickerOk(url(STICKER_MAX, 'webp'))).toBe(true);
    expect(url(STICKER_MAX, 'webp').length).toBe(MAX_STICKER);
    expect(stickerOk(url(STICKER_MAX + 3, 'webp'))).toBe(false);
    expect(stickerOk(url(1000, 'jpeg'))).toBe(false);
    expect(stickerOk('data:image/png;base64,<b>')).toBe(false);
    expect(stickerOk('https://example.com/a.png')).toBe(false);
    expect(stickerOk(7)).toBe(false);
  });

  it('counts the bytes in base64, padding included', () => {
    expect(stickerBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(stickerBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(stickerBytes('data:image/png;base64,AA==')).toBe(1);
  });

  it('trims the transparent border, a faint fringe with it; all clear is null', () => {
    const w = 6, h = 5, px = new Uint8ClampedArray(w * h * 4);
    const set = (x: number, y: number, a: number) => { px[(y * w + x) * 4 + 3] = a; };
    expect(trimBox(px, w, h)).toBeNull();
    set(2, 1, 255); set(4, 3, 200); set(0, 4, 3); // the last is under the threshold
    expect(trimBox(px, w, h)).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });

  it('fits the long side and never grows', () => {
    expect(fit(1024, 512, 256)).toEqual({ w: 256, h: 128 });
    expect(fit(300, 900, 256)).toEqual({ w: 85, h: 256 });
    expect(fit(100, 40, 256)).toEqual({ w: 100, h: 40 });
    expect(fit(4000, 1, 256)).toEqual({ w: 256, h: 1 });
  });

  it('takes the first under the goal and stops trying; else the smallest under the most; else none', () => {
    const tried: number[] = [];
    function* sizes(list: number[]) { for (const b of list) { tried.push(b); yield url(b); } }
    expect(stickerBytes(pick(sizes([120_000, 70_000, 50_000, 30_000]))!)).toBeLessThanOrEqual(STICKER_GOAL);
    expect(tried).toEqual([120_000, 70_000, 50_000]);
    expect(stickerBytes(pick(sizes([89_000, 85_000, 88_000]))!)).toBe(85_002); // rounded up to whole base64 groups
    expect(pick(sizes([95_000, 200_000]))).toBeNull();
  });

  it('posterizes colour to 32 levels a channel, leaving alpha', () => {
    const px = [0, 7, 8, 255, 255, 130, 3, 9];
    posterize(px);
    expect(px).toEqual([4, 4, 12, 255, 252, 132, 4, 9]);
  });

  it('keeps the last 12 sent, newest first, each once', () => {
    let r: string[] = [];
    for (let i = 0; i < 14; i++) r = withRecent(r, `s${i}`);
    expect(r).toHaveLength(RECENT_MAX);
    expect(r[0]).toBe('s13');
    expect(r.at(-1)).toBe('s2');
    expect(withRecent(r, 's5').slice(0, 2)).toEqual(['s5', 's13']);
    expect(withRecent(r, 's5').filter((x) => x === 's5')).toHaveLength(1);
  });
});
