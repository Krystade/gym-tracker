import { useEffect, useMemo, useRef, useState } from 'react';
import { useDb } from '../state/profileDb';
import { activeProfileDb } from '../db/db';
import { getPref, setPref } from '../state/prefs';
import { saveFile } from '../state/useBackup';
import { apartLine, CHIN, FRAME_SECONDS, photoId, shotDates, shotName, videoType, type Shot } from '../domain/photos';
import { prsBetween } from '../domain/feed';
import { fmtDay } from '../domain/format';
import type { SetEntry } from '../domain/types';
import type { PhotosStore } from '../state/usePhotos';
import { composite, flipFrames, recordVideo, type Frame } from './photoMedia';

// Compare on Photos (plan S5): before and after under one divider dragged across them, Save as image (side by side, optionally
// cut below the chin), and the progress video of every date between. All of it drawn on the phone; nothing made here is stored.

/** An object URL for a stored image, revoked when the view goes away or the photo changes. */
function useBlobUrl(id: string | null, kind: 'full' | 'thumb', version: number): string | null {
  const db = useDb();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let u: string | null = null, live = true;
    void db.getPhotoBlob(id, kind).then((b) => { if (live && b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, kind, version]);
  return url;
}

export function Img({ id, kind, version, label }: { id: string | null; kind: 'full' | 'thumb'; version: number; label: string }) {
  const url = useBlobUrl(id, kind, version);
  return url ? <img src={url} alt={label} /> : <span className="photo-ph" aria-hidden="true" />;
}

/** A date as the saved image and the video say it, with its year: they leave the app. */
const longDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const slug = (s: Shot) => `${s.pose}${s.variant === 'flexed' ? '-flexed' : ''}`;
/** Save as image cut below the chin, remembered per phone and profile: it's a choice about who sees his face. */
const CROP = 'photos:crop';

/**
 * Before and after, `pair` (two dates of `shot`), under a divider: before on the left of it, after on the right. Dragging (or
 * a tap) anywhere on the photo moves it; a slider under it does the same for VoiceOver and the keyboard.
 */
function Wipe({ shot, pair, weight, version, today, crop }: { shot: Shot; pair: [string, string]; weight: (d: string) => string | null; version: number; today: string; crop: boolean }) {
  const [at, setAt] = useState(50);
  const move = (el: HTMLElement, x: number) => { const r = el.getBoundingClientRect(); setAt(Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100)); };
  const tag = (d: string) => <><b>{fmtDay(d, today)}</b>{weight(d) ?? 'no weigh-in'}</>;
  return (
    <>
      <div className="wipe" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e.currentTarget, e.clientX); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e.currentTarget, e.clientX); }}>
        <Img id={photoId(pair[0], shot.pose, shot.variant)} kind="full" version={version} label={`${shotName(shot)}, ${pair[0]}`} />
        <div className="wipe-after" style={{ clipPath: `inset(0 0 0 ${at}%)` }}>
          <Img id={photoId(pair[1], shot.pose, shot.variant)} kind="full" version={version} label={`${shotName(shot)}, ${pair[1]}`} />
        </div>
        {crop && <span className="wipe-crop" style={{ height: `${CHIN * 100}%` }} aria-hidden="true" />}
        <span className="wipe-bar" style={{ left: `${at}%` }} aria-hidden="true"><i /></span>
        <span className="wipe-tag before">{tag(pair[0])}</span>
        <span className="wipe-tag after">{tag(pair[1])}</span>
      </div>
      <input type="range" className="sr-only" aria-label="Divider between before and after" min={0} max={100} value={at} onChange={(e) => setAt(Number(e.target.value))} />
    </>
  );
}

type Video = { at: number; of: number } | { file: File; url: string } | { flip: string[]; files: File[] } | { error: string };

/**
 * The progress video of `dates` (oldest first): recorded on the phone where it can (MP4 on iOS), else a flipbook of the same
 * frames. Kept in memory until Done or leaving Compare; Save hands it to the share sheet from a tap of its own.
 */
function ProgressVideo({ shot, dates, weight }: { shot: Shot; dates: string[]; weight: (d: string) => string | null }) {
  const db = useDb();
  const [video, setVideo] = useState<Video | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const live = useRef(true);
  // Whatever was made goes when it's done with: its object URLs are revoked, and a build still running is let go.
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => () => {
    if (video && 'url' in video) URL.revokeObjectURL(video.url);
    if (video && 'flip' in video) video.flip.forEach((u) => URL.revokeObjectURL(u));
  }, [video]);
  const flip = video && 'flip' in video ? video.flip : null;
  useEffect(() => {
    if (!flip) return;
    const t = setInterval(() => setPage((p) => (p + 1) % flip.length), FRAME_SECONDS * 1000);
    return () => clearInterval(t);
  }, [flip]);

  async function make() {
    setMsg(null); setPage(0);
    const frames: Frame[] = dates.map((d) => ({ id: photoId(d, shot.pose, shot.variant), date: longDay(d), weight: weight(d) }));
    const load = (id: string) => db.getPhotoBlob(id, 'full').then((b) => b ?? null);
    const name = `progress-${slug(shot)}-${dates[0]}-${dates.at(-1)}`;
    const type = typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype ? videoType((t) => MediaRecorder.isTypeSupported(t)) : null;
    setVideo({ at: 0, of: frames.length });
    try {
      if (type) {
        const blob = await recordVideo(frames, load, type, (i) => { if (live.current) setVideo({ at: i + 1, of: frames.length }); });
        if (!blob.size) throw new Error('The recording came out empty');
        const file = new File([blob], `${name}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: blob.type });
        if (live.current) setVideo({ file, url: URL.createObjectURL(file) });
      } else {
        const blobs = await flipFrames(frames, load);
        if (live.current) setVideo({ flip: blobs.map((b) => URL.createObjectURL(b)), files: blobs.map((b, i) => new File([b], `${name}-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })) });
      }
    } catch (e) { if (live.current) setVideo({ error: `Couldn’t make the video: ${String(e)}` }); }
  }

  async function save(files: File[]) {
    setMsg(null);
    if (files.length === 1) {
      const r = await saveFile(files[0]);
      setMsg(r === 'tap' ? 'Tap Save video again to open the share sheet.' : null);
      return;
    }
    if (!navigator.canShare?.({ files })) { setMsg('Sharing several images isn’t available here — long-press the picture to save it.'); return; }
    await navigator.share({ files }).catch((e: Error) => { if (e.name !== 'AbortError') setMsg(`Couldn’t open the share sheet (${e.name}).`); });
  }

  const secs = Math.round(FRAME_SECONDS * (dates.length + 2) * 10) / 10;
  if (!video || 'error' in video) return (
    <div className="pv">
      <button type="button" onClick={() => void make()}>Progress video</button>
      <p className="muted small" role="status">{video?.error ?? `${dates.length} dates, ${secs} s, made on this phone and not kept.`}</p>
    </div>
  );
  if ('at' in video) return <div className="pv"><p className="muted small" role="status">Making the video… {video.at} of {video.of}</p></div>;
  return (
    <div className="pv" role="group" aria-label="Progress video">
      {'url' in video ? <video src={video.url} controls playsInline muted aria-label="Progress video preview" />
        : <img src={video.flip[page]} alt={`Progress video, frame ${page + 1} of ${video.flip.length}`} />}
      {'flip' in video && <p className="muted small">This phone can’t record video, so here it is as a flipbook.</p>}
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => void save('file' in video ? [video.file] : video.files)}>{'file' in video ? 'Save video' : 'Save frames'}</button>
        <button type="button" onClick={() => { setVideo(null); setMsg(null); }}>Done</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </div>
  );
}

/**
 * Before and after of `shot` at `pair`, with how far apart and the PRs between; Save as image (made ahead, so the share sheet
 * opens straight from the tap) and the progress video of every date from before to after.
 */
export function PhotoCompare({ photos, shot, pair, weight, entries, today }: { photos: PhotosStore; shot: Shot; pair: [string, string]; weight: (d: string) => string | null; entries: SetEntry[]; today: string }) {
  const db = useDb();
  const [owner] = useState(activeProfileDb);
  const [crop, setCropNow] = useState(() => getPref<boolean>(owner, CROP) === true);
  const setCrop = (on: boolean) => { setCropNow(on); setPref(owner, CROP, on || undefined); };
  const [lo, hi] = pair[0] <= pair[1] ? pair : [pair[1], pair[0]];
  const prs = useMemo(() => prsBetween(entries, lo, hi).length, [entries, lo, hi]);
  const apart = apartLine(pair[0], pair[1], prs);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [w0, w1] = [weight(pair[0]), weight(pair[1])];
  useEffect(() => {
    setFile(null); setMsg(null);
    let live = true;
    const blob = (d: string) => db.getPhotoBlob(photoId(d, shot.pose, shot.variant), 'full').then((b) => b ?? null);
    void Promise.all([blob(pair[0]), blob(pair[1])])
      .then(([a, b]) => composite([{ blob: a, date: longDay(pair[0]), weight: w0 }, { blob: b, date: longDay(pair[1]), weight: w1 }], apart, crop ? CHIN : 0))
      .then((b) => { if (live) setFile(new File([b], `progress-${slug(shot)}-${pair[0]}-${pair[1]}.jpg`, { type: 'image/jpeg' })); })
      .catch((e) => { if (live) setMsg(`Couldn’t make the image: ${String(e)}`); });
    return () => { live = false; };
  }, [shot.pose, shot.variant, pair[0], pair[1], crop, photos.version, apart, w0, w1]);
  const dates = shotDates(photos.metas, shot, lo, hi);

  return (
    <div className="photo-cmp">
      <Wipe shot={shot} pair={pair} weight={weight} version={photos.version} today={today} crop={crop} />
      <p className="muted small wipe-apart">{apart}</p>
      <label className="check"><input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />Crop below the chin</label>
      <div className="form-actions">
        <button type="button" className="primary" disabled={!file} onClick={() => {
          if (!file) return;
          setMsg(null);
          void saveFile(file).then((r) => setMsg(r === 'tap' ? 'Tap Save as image again to open the share sheet.' : null));
        }}>Save as image</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
      <ProgressVideo key={`${slug(shot)}:${pair.join(':')}`} shot={shot} dates={dates} weight={weight} />
    </div>
  );
}
