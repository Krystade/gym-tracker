import { fit, pick, posterize, QUALITIES, SIZES, trimBox } from '../domain/sticker';

// An image (pasted, or from the photo picker) made into a sticker: decoded through an <img> (so Safari reads HEIC as it reads
// anything else), its transparent border trimmed, shrunk, and written as WebP with its transparency where the browser can, else
// PNG (domain/sticker has the sizes and the limit). Errors carry `plain`, the line the thread shows.

/** Read at no more than this on its long side before trimming: a 12-megapixel photo never sits whole in a canvas. */
const WORK_PX = 1024;
const plain = (message: string) => Object.assign(new Error(message), { plain: true });

function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  return new Promise<HTMLImageElement>((ok, no) => {
    img.onload = () => ok(img);
    img.onerror = () => no(plain('Couldn’t read that image.'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw plain('Couldn’t read that image.');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  return { c, g };
};

/** The image first in a paste's clipboard, if there is one. */
export function pastedImage(d: DataTransfer | null): File | null {
  if (!d) return null;
  for (const f of Array.from(d.files ?? [])) if (f.type.startsWith('image/')) return f;
  for (const i of Array.from(d.items ?? [])) if (i.kind === 'file' && i.type.startsWith('image/')) { const f = i.getAsFile(); if (f) return f; }
  return null;
}

/** The sticker's data URL, or an error with the reason (unreadable, nothing in it, too big however small it's drawn). */
export async function makeSticker(file: Blob): Promise<string> {
  const img = await decode(file);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) throw plain('Couldn’t read that image.');
  const work = fit(iw, ih, WORK_PX);
  const a = canvas(work.w, work.h);
  a.g.drawImage(img, 0, 0, work.w, work.h);
  const box = trimBox(a.g.getImageData(0, 0, work.w, work.h).data, work.w, work.h);
  if (!box) throw plain('That image is empty.');
  function* tries() {
    for (const px of SIZES) {
      const out = fit(box!.w, box!.h, px);
      const b = canvas(out.w, out.h);
      b.g.drawImage(a.c, box!.x, box!.y, box!.w, box!.h, 0, 0, out.w, out.h);
      const webp = b.c.toDataURL('image/webp', QUALITIES[0]);
      yield webp;
      // Safari's canvas writes PNG for a type it can't (that's what came back): then the same size with fewer colours.
      if (!webp.startsWith('data:image/webp')) {
        const d = b.g.getImageData(0, 0, out.w, out.h);
        posterize(d.data);
        b.g.putImageData(d, 0, 0);
        yield b.c.toDataURL('image/png');
        continue;
      }
      for (const q of QUALITIES.slice(1)) yield b.c.toDataURL('image/webp', q);
    }
  }
  const s = pick(tries());
  if (!s) throw plain('That sticker is too big to send.');
  return s;
}
