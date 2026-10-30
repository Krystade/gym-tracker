import { expect, test, type Page } from '@playwright/test';
import { goto } from './nav';
import { notched } from './layout';

// Guided capture (ui/PhotoCapture): record, step through the poses, pick a frame per pose, review, save stills only. There's no
// camera here, so getUserMedia gives a drawn one: each moment a figure on a different colour, the seconds written on it, so
// frames picked at different times differ. Chromium records that canvas stream with its own MediaRecorder and plays it back;
// WebKit on this machine has no MediaStream, MediaRecorder or video decoding at all, so there a stand-in recorder hands back a
// "video" whose frames the stand-in <video> draws from the same picture. Synthetic only; no photo or video file is used.

async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const W = 720, H = 1280;
    const w = window as unknown as { cam: { starts: number; stops: number; deny: boolean; dim?: boolean } };
    w.cam = { starts: 0, stops: 0, deny: false };
    const paint = (g: CanvasRenderingContext2D, t: number) => {
      g.fillStyle = `hsl(${Math.round(t * 60) % 360} 45% 35%)`; g.fillRect(0, 0, W, H);
      if (w.cam.dim) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; } // the light gone: a dark room
      g.fillStyle = '#d8d2c8'; // a figure about where the outline is: head near the top of the 3:4 middle, feet near its foot
      g.beginPath(); g.arc(W / 2, 330, 52, 0, 7); g.fill();
      g.fillRect(W / 2 - 95, 400, 190, 380); g.fillRect(W / 2 - 80, 780, 60, 330); g.fillRect(W / 2 + 20, 780, 60, 330);
      g.fillStyle = '#fff'; g.font = 'bold 72px sans-serif'; g.fillText(`${t.toFixed(1)} s`, 40, 260);
    };
    const frame = (t: number) => { const c = document.createElement('canvas'); c.width = W; c.height = H; paint(c.getContext('2d')!, t); return c; };
    const real = 'captureStream' in HTMLCanvasElement.prototype && typeof MediaRecorder !== 'undefined';
    const getUserMedia = async () => {
      w.cam.starts++;
      if (w.cam.deny) throw new DOMException('Permission denied', 'NotAllowedError');
      if (real) {
        const c = frame(0), g = c.getContext('2d')!, t0 = performance.now();
        const s = c.captureStream(30);
        const track = s.getVideoTracks()[0], stop = track.stop.bind(track);
        let on = true;
        const tick = () => { if (!on) return; paint(g, (performance.now() - t0) / 1000); requestAnimationFrame(tick); };
        tick();
        track.stop = () => { on = false; w.cam.stops++; stop(); };
        return s;
      }
      const track = Object.assign(new EventTarget(), { kind: 'video', readyState: 'live', stop() { this.readyState = 'ended'; w.cam.stops++; } });
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    if (real) return;

    // WebKit: a recorder whose "video" is as many bytes as it ran milliseconds (read back by size: notched's route turns away a
    // fetch of a blob: URL), and <video> elements that show and draw the frame at their time.
    const lengths = new Map<string, number>();
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => { const u = createObjectURL(b); if (b instanceof Blob && b.type === 'video/mp4') lengths.set(u, b.size / 1000); return u; };
    class Recorder {
      static isTypeSupported = (t: string) => t === 'video/mp4';
      state = 'inactive'; mimeType = 'video/mp4'; t0 = 0;
      ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: (() => void) | null = null;
      start() { this.state = 'recording'; this.t0 = performance.now(); }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        const data = new Blob([new Uint8Array(Math.round(performance.now() - this.t0))], { type: 'video/mp4' });
        setTimeout(() => { this.ondataavailable?.({ data }); this.onstop?.(); });
      }
    }
    Object.assign(window, { MediaRecorder: Recorder });
    const at = new WeakMap<HTMLMediaElement, { t: number; length: number; seeking: boolean }>();
    const show = (el: HTMLMediaElement) => { (el as HTMLVideoElement).poster = frame(at.get(el)!.t).toDataURL('image/jpeg', 0.8); };
    const media = HTMLMediaElement.prototype, video = HTMLVideoElement.prototype;
    const swap = (proto: object, name: string, get: (s: { t: number; length: number; seeking: boolean }) => unknown, set?: (el: HTMLMediaElement, v: unknown) => void) => {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      Object.defineProperty(proto, name, {
        configurable: true,
        get(this: HTMLMediaElement) { const s = at.get(this); return s ? get(s) : d?.get?.call(this); },
        set(this: HTMLMediaElement, v: unknown) { if (at.has(this) && set) set(this, v); else d?.set?.call(this, v); },
      });
    };
    Object.defineProperty(media, 'srcObject', { configurable: true, get: () => null, set(this: HTMLMediaElement, v: unknown) {
      if (!v) return;
      at.set(this, { t: 0, length: Infinity, seeking: false }); show(this);
    } });
    const src = Object.getOwnPropertyDescriptor(media, 'src')!;
    Object.defineProperty(media, 'src', { configurable: true, get(this: HTMLMediaElement) { return src.get!.call(this); }, set(this: HTMLMediaElement, v: string) {
      const length = lengths.get(v);
      if (length == null) return src.set!.call(this, v);
      at.set(this, { t: 0, length, seeking: false }); show(this);
      setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')));
    } });
    swap(media, 'duration', (s) => s.length);
    swap(media, 'seeking', (s) => s.seeking);
    swap(media, 'readyState', () => 4);
    swap(video, 'videoWidth', () => W);
    swap(video, 'videoHeight', () => H);
    swap(media, 'currentTime', (s) => s.t, (el, v) => {
      const s = at.get(el)!;
      s.t = Math.min(Number(v), s.length); s.seeking = true;
      setTimeout(() => { s.seeking = false; show(el); el.dispatchEvent(new Event('seeked')); }, 20);
    });
    const play = media.play;
    media.play = function (this: HTMLMediaElement) { return at.has(this) ? Promise.resolve() : play.call(this); };
    const drawImage = CanvasRenderingContext2D.prototype.drawImage as (...a: unknown[]) => void;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, el: CanvasImageSource, ...a: number[]) {
      const s = el instanceof HTMLVideoElement && at.get(el);
      return drawImage.call(this, s ? frame(s.t) : el, ...a);
    } as typeof CanvasRenderingContext2D.prototype.drawImage;
  });
}

const dialog = (page: Page) => page.getByRole('dialog');
const shoot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png` });
const useFrame = (page: Page) => dialog(page).getByRole('button', { name: 'Use this frame' });

test.beforeEach(async ({ page }) => {
  await notched(page);
  await fakeCamera(page);
  await page.goto('/');
  await goto(page, 'Photos');
});

test('records the poses in one video, picks a frame for each, and saves only the stills', async ({ page }) => {
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const d = dialog(page);
  await expect(d.getByRole('button', { name: 'Record' })).toBeEnabled();
  await expect(d.getByText('Front', { exact: true })).toBeVisible();
  // Manual: each pose comes up on a tap of Next pose (Auto, the default, is below).
  await expect(d.getByRole('group', { name: 'Next pose' }).getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
  await d.getByRole('button', { name: 'Manual' }).click();
  await expect(d.getByRole('group', { name: 'Seconds a pose' })).toHaveCount(0);
  await shoot(page, '30-capture-live');

  await d.getByRole('button', { name: 'Record' }).click();
  for (let k = 1; k < 6; k++) {
    await page.waitForTimeout(400); // the time each pose is held: the recording has to run for there to be frames apart
    await d.getByRole('button', { name: 'Next pose' }).click();
  }
  await expect(d.getByText('6 of 6')).toBeVisible();
  await expect(d.getByText('Back to the camera, double biceps')).toBeVisible();
  await shoot(page, '31-capture-recording');
  await page.waitForTimeout(400);
  await d.getByRole('button', { name: 'Done' }).click();

  // A scrubber per pose, each starting in the middle of that pose's time: later poses, later frames.
  const starts: number[] = [];
  for (let k = 1; k <= 6; k++) {
    await expect(d.getByRole('heading', { name: `Pick ${k} of 6` })).toBeVisible();
    await expect(useFrame(page)).toBeEnabled();
    starts.push(Number(await d.getByRole('slider', { name: 'Frame' }).inputValue()));
    if (k === 1) await shoot(page, '32-capture-pick');
    await useFrame(page).click();
  }
  for (let k = 1; k < 6; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1] + 0.2);

  await expect(d.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(d.locator('.cap-tile img')).toHaveCount(6);
  await shoot(page, '33-capture-review');

  // Pick another frame for one: the scrubber starts where it was kept, and the start of the video is a different picture.
  await d.getByRole('button', { name: 'Front flexed', exact: true }).click();
  await d.getByRole('button', { name: 'Pick another frame' }).click();
  await expect(useFrame(page)).toBeEnabled();
  expect(Number(await d.getByRole('slider', { name: 'Frame' }).inputValue())).toBeCloseTo(starts[1], 1);
  await d.getByRole('slider', { name: 'Frame' }).fill('0');
  await expect(d.getByText('0:00.0')).toBeVisible();
  await expect(useFrame(page)).toBeEnabled();
  await useFrame(page).click();
  await expect(d.getByRole('heading', { name: 'Review' })).toBeVisible();

  await d.getByRole('button', { name: 'Save 6 photos' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByText(/^Saved 6 photos for today\./)).toBeVisible();
  const today = await page.evaluate(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; });
  const tl = page.getByRole('region', { name: 'Timeline' });
  for (const name of ['Front', 'Front flexed', 'Side', 'Side flexed', 'Back', 'Back flexed']) await expect(tl.getByRole('img', { name: `${name}, ${today}` })).toBeVisible();

  // Stored: 6 photos, each a 3:4 JPEG and its thumb, their colours apart (different moments); no video anywhere. Camera off.
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open('gym-tracker'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const all = <T,>(store: string) => new Promise<T[]>((ok) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => ok(r.result as T[]); });
    const metas = await all<{ id: string; width: number; height: number }>('photos');
    const blobs = await all<{ type: string; data: ArrayBuffer }>('photoBlobs');
    const colour = async (id: string) => {
      const keys = await new Promise<IDBValidKey[]>((ok) => { const r = db.transaction('photoBlobs').objectStore('photoBlobs').getAllKeys(); r.onsuccess = () => ok(r.result); });
      const i = keys.indexOf(`${id}:thumb`);
      const img = await createImageBitmap(new Blob([blobs[i].data], { type: blobs[i].type }));
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(4, img.height - 4, 1, 1).data.slice(0, 3)).join(',');
    };
    return { ids: metas.map((m) => m.id).sort(), aspect: metas.map((m) => m.width / m.height), types: [...new Set(blobs.map((b) => b.type))], count: blobs.length,
      colours: await Promise.all(metas.map((m) => colour(m.id))) };
  });
  expect(stored.ids).toEqual(['back:flexed', 'back:relaxed', 'front:flexed', 'front:relaxed', 'side:flexed', 'side:relaxed'].map((x) => `${today}:${x}`));
  for (const a of stored.aspect) expect(a).toBeCloseTo(3 / 4, 2);
  expect(stored.types).toEqual(['image/jpeg']);
  expect(stored.count).toBe(12);
  expect(new Set(stored.colours).size).toBe(6);
  const cam = await page.evaluate(() => (window as unknown as { cam: { starts: number; stops: number } }).cam);
  expect(cam.stops).toBeGreaterThanOrEqual(cam.starts);
});

test('the app leaving the screen mid-recording keeps what was recorded; the missing poses are retaken from the review', async ({ page }) => {
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: 'Record' }).click();
  for (let k = 1; k < 3; k++) { await page.waitForTimeout(300); await d.getByRole('button', { name: 'Next pose' }).click(); }
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
  await expect(d.getByRole('heading', { name: 'Pick 1 of 3' })).toBeVisible();
  await expect(d.getByRole('status')).toContainText('The camera stopped when the app left the screen');
  for (let k = 1; k <= 3; k++) { await expect(useFrame(page)).toBeEnabled(); await useFrame(page).click(); }
  await expect(d.locator('.cap-tile img')).toHaveCount(3);
  await d.getByRole('button', { name: 'Side flexed, missing' }).click();
  await d.getByRole('button', { name: 'Retake' }).click();
  // The routine goes on from there: the three missing, Side flexed first.
  await expect(d.getByRole('button', { name: 'Record' })).toBeEnabled();
  await expect(d.getByText('1 of 3')).toBeVisible();
  await expect(d.getByText('Side on, side chest')).toBeVisible();
  page.once('dialog', (x) => void x.accept());
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toHaveCount(0);
  const cam = await page.evaluate(() => (window as unknown as { cam: { starts: number; stops: number } }).cam);
  expect(cam).toEqual({ starts: 2, stops: 2, deny: false });
});

test('camera turned down: says how to allow it, and Take photo is still there', async ({ page }) => {
  await page.evaluate(() => { (window as unknown as { cam: { deny: boolean } }).cam.deny = true; });
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const d = dialog(page);
  await expect(d.getByRole('status')).toContainText('Camera access was turned down');
  await shoot(page, '34-capture-denied');
  await d.getByRole('button', { name: 'Use Take photo instead' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByLabel('Take photo')).toBeAttached();
});

test('the second session: last time’s photo over the camera in place of the outline, and a warning when the light is darker', async ({ page }) => {
  // A first session: the six recorded, a frame each, saved.
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const d = dialog(page);
  await expect(d.locator('.cap-outline')).toBeVisible();
  await expect(d.locator('.cap-ghost')).toHaveCount(0);
  await d.getByRole('button', { name: 'Record' }).click();
  for (let k = 1; k < 6; k++) { await page.waitForTimeout(200); await d.getByRole('button', { name: 'Next pose' }).click(); }
  await page.waitForTimeout(200);
  await d.getByRole('button', { name: 'Done' }).click();
  for (let k = 1; k <= 6; k++) { await expect(useFrame(page)).toBeEnabled(); await useFrame(page).click(); }
  await d.getByRole('button', { name: 'Save 6 photos' }).click();
  await expect(d).toHaveCount(0);

  // The next: the ghost, mirrored with the front camera's preview, named by its day; no outline. Same light: nothing said.
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  await expect(d.getByRole('button', { name: 'Record' })).toBeEnabled();
  await expect(d.locator('.cap-ghost')).toBeVisible();
  await expect(d.locator('.cap-ghost')).toHaveClass(/mirror/);
  await expect(d.locator('.cap-outline')).toHaveCount(0);
  await expect(d.getByText(/^Last time · /)).toBeVisible();
  expect(await d.locator('.cap-ghost').evaluate((e) => getComputedStyle(e).opacity)).toBe('0.3');
  await page.waitForTimeout(1200); // the check has had time to read the camera
  await expect(d.getByText(/than last time/)).toHaveCount(0);
  // The room goes dark: said over the frame, and gone again once the light is back.
  await page.evaluate(() => { (window as unknown as { cam: { dim: boolean } }).cam.dim = true; });
  await expect(d.getByRole('status').filter({ hasText: 'Darker than last time' })).toBeVisible();
  await shoot(page, '35-capture-ghost-darker');
  await page.evaluate(() => { (window as unknown as { cam: { dim: boolean } }).cam.dim = false; });
  await expect(d.getByText(/than last time/)).toHaveCount(0);
  await shoot(page, '36-capture-ghost');
});

test('Auto: each pose comes up by itself after the seconds picked, a ring counting down; each picker starts as the pose settled', async ({ page }) => {
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  const d = dialog(page);
  const secs = d.getByRole('group', { name: 'Seconds a pose' });
  await expect(secs.getByRole('button', { name: '4 s' })).toHaveAttribute('aria-pressed', 'true');
  await secs.getByRole('button', { name: '2 s' }).click();
  await shoot(page, '37-capture-auto');
  await d.getByRole('button', { name: 'Record' }).click();
  await expect(d.getByRole('timer', { name: /^Next pose in [12] seconds$/ })).toBeVisible();
  await shoot(page, '38-capture-auto-count');
  await expect(d.getByText('2 of 6')).toBeVisible({ timeout: 4000 }); // no tap
  // Next still goes early.
  await d.getByRole('button', { name: 'Next pose' }).click();
  await expect(d.getByText('3 of 6')).toBeVisible();
  // The rest by itself; after the last, the recording stops and the picking starts.
  await expect(d.getByRole('heading', { name: 'Pick 1 of 6' })).toBeVisible({ timeout: 15000 });
  const starts: number[] = [];
  for (let k = 1; k <= 6; k++) {
    await expect(d.getByRole('heading', { name: `Pick ${k} of 6` })).toBeVisible();
    await expect(useFrame(page)).toBeEnabled();
    starts.push(Number(await d.getByRole('slider', { name: 'Frame' }).inputValue()));
    await useFrame(page).click();
  }
  // Near each pose's end (0.4 s before it), not its middle: pose 1 ran about 2 s.
  expect(starts[0]).toBeGreaterThan(1.3);
  expect(starts[0]).toBeLessThan(2.1);
  for (let k = 1; k < 6; k++) expect(starts[k]).toBeGreaterThan(starts[k - 1]);
  expect(starts[2] - starts[1]).toBeGreaterThan(1.3); // pose 3 ran its full 2 s
  // The choice is kept for next time.
  page.once('dialog', (x) => void x.accept());
  await d.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Record the 6 poses' }).click();
  await expect(d.getByRole('group', { name: 'Seconds a pose' }).getByRole('button', { name: '2 s' })).toHaveAttribute('aria-pressed', 'true');
});
