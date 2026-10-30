import { coverCrop, FRAME_SECONDS } from '../domain/photos';

// Save as image and the progress video (plan S5): drawn on the phone from the stored stills, handed to the share sheet and
// never stored. Each photo is drawn as the screens show it, its 3:4 middle (domain/photos coverCrop).

const FONT = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
/** A stored photo, decoded for drawing; closed once drawn, so the video holds two at most (the one shown and the next). */
const bitmap = (b: Blob | null): Promise<ImageBitmap | null> => (b ? createImageBitmap(b).catch(() => null) : Promise.resolve(null));
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')!];
}
const jpeg = (cv: HTMLCanvasElement): Promise<Blob> =>
  new Promise((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error('Could not draw the image'))), 'image/jpeg', 0.9));

/** The photo's 3:4 middle into x, y, w × h, from `top` (a share of its height) down: the crop below the chin. */
function cover(g: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number, top = 0) {
  const c = coverCrop(img.width, img.height, 3 / 4), cut = Math.round(c.height * top);
  g.drawImage(img, c.x, c.y + cut, c.width, c.height - cut, x, y, w, h);
}

/** One side of a before and after: the photo, and its date and trend weight as said under it. */
export interface Side { blob: Blob | null; date: string; weight: string | null }

/**
 * Save as image: before and after side by side, each with its date and trend weight under it, and how far apart under both.
 * `crop`: the share of each photo cut off the top (0, or domain/photos CHIN for below the chin).
 */
export async function composite(sides: readonly [Side, Side], apart: string, crop: number): Promise<Blob> {
  const PW = 720, PH = Math.round(960 * (1 - crop)), GAP = 8, FOOT = 172, W = PW * 2 + GAP;
  const [cv, g] = canvas(W, PH + FOOT);
  g.fillStyle = '#121212'; g.fillRect(0, 0, W, PH + FOOT);
  g.textAlign = 'center';
  for (const [i, s] of sides.entries()) {
    const x = i * (PW + GAP), img = await bitmap(s.blob);
    if (img) { cover(g, img, x, 0, PW, PH, crop); img.close(); }
    g.fillStyle = '#fff'; g.font = `600 40px ${FONT}`; g.fillText(s.date, x + PW / 2, PH + 60);
    g.fillStyle = '#c4c4c4'; g.font = `400 34px ${FONT}`; g.fillText(s.weight ?? 'no weigh-in', x + PW / 2, PH + 106);
  }
  g.fillStyle = '#8f8f8f'; g.font = `400 28px ${FONT}`; g.fillText(apart, W / 2, PH + 152);
  return jpeg(cv);
}

/** One date of the progress video: its photo's id, and the date and trend weight burned into it. */
export interface Frame { id: string; date: string; weight: string | null }
const VW = 1080, VH = 1440;

/** A frame of the video: the photo, a dark band along the foot, the date on the left and the trend weight on the right. */
function drawFrame(g: CanvasRenderingContext2D, img: ImageBitmap | null, f: Frame, w: number, h: number) {
  const k = w / VW;
  g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
  if (img) cover(g, img, 0, 0, w, h);
  const band = g.createLinearGradient(0, h - 300 * k, 0, h);
  band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = band; g.fillRect(0, h - 300 * k, w, 300 * k);
  g.fillStyle = '#fff'; g.font = `600 ${Math.round(64 * k)}px ${FONT}`;
  g.textAlign = 'left'; g.fillText(f.date, 56 * k, h - 72 * k);
  if (f.weight) { g.textAlign = 'right'; g.fillText(f.weight, w - 56 * k, h - 72 * k); }
}

/**
 * The progress video: each date's photo held FRAME_SECONDS (the last three times as long), recorded from a canvas as `type`
 * (domain/photos videoType). The next photo is read while one shows; the canvas is drawn again each 33 ms, as a recorder only
 * takes a frame when the canvas changes. `onFrame`: how far it's got, for the screen.
 */
export async function recordVideo(frames: readonly Frame[], load: (id: string) => Promise<Blob | null>, type: string, onFrame?: (i: number) => void): Promise<Blob> {
  const [cv, g] = canvas(VW, VH);
  const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((ok, fail) => { rec.onstop = () => ok(); rec.onerror = () => fail(new Error('The recording failed')); });
  let next = bitmap(await load(frames[0].id));
  try {
    for (const [i, f] of frames.entries()) {
      const img = await next;
      next = i + 1 < frames.length ? load(frames[i + 1].id).then(bitmap) : Promise.resolve(null);
      drawFrame(g, img, f, VW, VH);
      if (i === 0) rec.start(); // on the first photo, not on black
      onFrame?.(i);
      const hold = FRAME_SECONDS * 1000 * (i === frames.length - 1 ? 3 : 1), t0 = performance.now();
      while (performance.now() - t0 < hold) { await wait(33); drawFrame(g, img, f, VW, VH); }
      img?.close();
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    void next.then((b) => b?.close());
  }
  await done;
  return new Blob(chunks, { type: type.split(';')[0] });
}

/** The flipbook, where the phone can't record: the same frames as JPEGs at 720 × 960, one photo decoded at a time. */
export async function flipFrames(frames: readonly Frame[], load: (id: string) => Promise<Blob | null>): Promise<Blob[]> {
  const [cv, g] = canvas(720, 960), out: Blob[] = [];
  for (const f of frames) {
    const img = await bitmap(await load(f.id));
    drawFrame(g, img, f, 720, 960);
    img?.close();
    out.push(await jpeg(cv));
  }
  return out;
}
