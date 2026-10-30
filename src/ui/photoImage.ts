import { fitSize } from '../domain/photos';

// A progress photo's images: a picked file or a frame from the guided recording, re-encoded on the phone (domain/photos).

export async function decode(file: File): Promise<HTMLImageElement> {
  const img = new Image();
  const u = URL.createObjectURL(file);
  try { img.src = u; await img.decode(); return img; } finally { URL.revokeObjectURL(u); }
}

/** A JPEG at 0.85 with the long edge at most `max`: 1600 for the photo, 320 for its thumb. */
export function encode(img: HTMLImageElement | HTMLCanvasElement, max: number): Promise<{ blob: Blob; width: number; height: number }> {
  const [w, h] = img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];
  const { width, height } = fitSize(w, h, max);
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return new Promise((ok, fail) => cv.toBlob((b) => (b ? ok({ blob: b, width, height }) : fail(new Error('Could not encode the photo'))), 'image/jpeg', 0.85));
}
