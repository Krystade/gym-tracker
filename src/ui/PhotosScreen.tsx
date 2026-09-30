import { useEffect, useState } from 'react';
import { getPhotoBlob } from '../db/db';
import { comparePair, fitSize, photoDate, photoId, POSES, timeline, weightNear, type PhotoMeta, type Pose } from '../domain/photos';
import { localDate } from '../domain/ids';
import { trend } from '../domain/body';
import { fmtDate } from '../domain/format';
import type { PhotosStore } from '../state/usePhotos';
import type { BodyStore } from '../state/useBody';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const alt = (m: { pose: Pose; date: string }) => `${cap(m.pose)}, ${m.date}`;

/** An object URL for a stored image, revoked when the view goes away or the photo changes. */
function useBlobUrl(id: string | null, kind: 'full' | 'thumb', version: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let u: string | null = null, live = true;
    void getPhotoBlob(id, kind).then((b) => { if (live && b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id, kind, version]);
  return url;
}

function Img({ id, kind, version, label }: { id: string | null; kind: 'full' | 'thumb'; version: number; label: string }) {
  const url = useBlobUrl(id, kind, version);
  return url ? <img src={url} alt={label} /> : <span className="photo-ph" aria-hidden="true" />;
}

async function decode(file: File): Promise<HTMLImageElement> {
  const img = new Image();
  const u = URL.createObjectURL(file);
  try { img.src = u; await img.decode(); return img; } finally { URL.revokeObjectURL(u); }
}

function encode(img: HTMLImageElement, max: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, max);
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  cv.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return new Promise((ok, fail) => cv.toBlob((b) => (b ? ok({ blob: b, width, height }) : fail(new Error('Could not encode the photo'))), 'image/jpeg', 0.85));
}

export function PhotosScreen({ photos, body, today, onBack }: { photos: PhotosStore; body: BodyStore; today: string; onBack: () => void }) {
  const [pose, setPose] = useState<Pose>('front');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<PhotoMeta | null>(null);
  const [cmpPose, setCmpPose] = useState<Pose>('front');
  const [pick, setPick] = useState<[string, string] | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => {
    setShareFile(null);
    if (!open) return;
    let live = true;
    void getPhotoBlob(open.id, 'full').then((b) => { if (live && b) setShareFile(new File([b], `progress-${open.date}-${open.pose}.jpg`, { type: 'image/jpeg' })); });
    return () => { live = false; };
  }, [open, photos.version]);
  const points = trend(body.days);
  const weight = (d: string) => { const w = weightNear(d, points); return w == null ? null : `${w.toFixed(1)} lb`; };

  async function onFile(file: File, source: 'camera' | 'library') {
    const when = photoDate(source, date, localDate(new Date()));
    if (!when) { setMsg('That date is in the future — pick today or earlier.'); return; }
    const id = photoId(when, pose);
    if (photos.metas.some((m) => m.id === id) && !confirm(`Replace the ${pose} photo for ${when}?`)) return;
    setBusy(true); setMsg(null);
    try {
      const img = await decode(file);
      const [full, thumb] = [await encode(img, 1600), await encode(img, 320)];
      const ok = await photos.add({ id, date: when, pose, width: full.width, height: full.height, addedAt: new Date().toISOString() }, full.blob, thumb.blob);
      if (ok) setMsg(`Saved ${pose} photo for ${when}.`);
    } catch (e) { setMsg(`Could not read that image: ${String(e)}`); }
    finally { setBusy(false); }
  }

  const dates = [...new Set(photos.metas.filter((m) => m.pose === cmpPose).map((m) => m.date))].sort();
  const pair = pick && dates.includes(pick[0]) && dates.includes(pick[1]) ? pick : comparePair(photos.metas, cmpPose);

  if (open) return (
    <>
      <button onClick={() => setOpen(null)}>‹ Photos</button>
      <h1>{cap(open.pose)} · {fmtDate(open.date)}</h1>
      <p className="muted">{weight(open.date) ? `Trend weight ${weight(open.date)}` : 'No weigh-in within 3 days'}</p>
      <div className="photo-full"><Img id={open.id} kind="full" version={photos.version} label={alt(open)} /></div>
      <div className="form-actions">
        <button disabled={!shareFile} onClick={() => {
          // Called straight from the tap: the share sheet needs the user's gesture, so the file was read in advance.
          if (!shareFile || !navigator.canShare?.({ files: [shareFile] })) { setMsg('Sharing isn’t available here — long-press the photo to save it.'); return; }
          navigator.share({ files: [shareFile] }).catch((e: Error) => { if (e.name !== 'AbortError') setMsg(`Couldn’t open the share sheet (${e.name}) — long-press the photo to save it.`); });
        }}>Save to Photos</button>
        <button className="danger" onClick={async () => { if (confirm(`Delete the ${open.pose} photo for ${open.date}? This can’t be undone.`) && (await photos.remove(open.id))) setOpen(null); }}>Delete photo</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </>
  );

  return (
    <>
      <button onClick={onBack}>‹ Back</button>
      <h1>Progress photos</h1>
      <section className="card">
        <p className="muted small">Kept only on this phone — never uploaded, exported or synced. Same spot, light and time of day each time.</p>
        <div className="chips" role="group" aria-label="Pose">
          {POSES.map((p) => <button key={p} type="button" className="chip" aria-pressed={pose === p} onClick={() => setPose(p)}>{cap(p)}</button>)}
        </div>
        <label className="photo-date">Date for library photos<input type="date" aria-label="Photo date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></label>
        <div className="photo-add">
          <label className={`button primary${busy ? ' disabled' : ''}`}>Take photo
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f, 'camera'); }} />
          </label>
          <label className={`button${busy ? ' disabled' : ''}`}>From library
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f, 'library'); }} />
          </label>
        </div>
        {msg && <p className="muted small" role="status">{msg}</p>}
      </section>

      <section className="card" aria-labelledby="cmp-h">
        <h2 id="cmp-h">Compare</h2>
        <div className="chips" role="group" aria-label="Compare pose">
          {POSES.map((p) => <button key={p} type="button" className="chip" aria-pressed={cmpPose === p} onClick={() => { setCmpPose(p); setPick(null); }}>{cap(p)}</button>)}
        </div>
        {!pair ? <p className="muted">Two dates with a {cmpPose} photo are needed to compare.</p> : (
          <div className="compare">
            {[0, 1].map((k) => (
              <figure key={k}>
                <select aria-label={k === 0 ? 'Before' : 'After'} value={pair[k]} onChange={(e) => setPick(k === 0 ? [e.target.value, pair[1]] : [pair[0], e.target.value])}>
                  {dates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <Img id={photoId(pair[k], cmpPose)} kind="full" version={photos.version} label={alt({ pose: cmpPose, date: pair[k] })} />
                <figcaption>{weight(pair[k]) ? <b>{weight(pair[k])}</b> : <span className="muted small">no weigh-in</span>}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="tl-h">
        <h2 id="tl-h">Timeline</h2>
        {photos.metas.length === 0 && <p className="muted">No photos yet.</p>}
        {timeline(photos.metas).map((g) => (
          <div className="tl-day" key={g.date}>
            <p><b>{fmtDate(g.date)}</b>{weight(g.date) && <span className="muted small"> · {weight(g.date)}</span>}</p>
            <div className="tl-row">
              {g.photos.map((m) => (
                <button key={m.id} className="tl-thumb" aria-label={alt(m)} onClick={() => { setMsg(null); setOpen(m); }}>
                  <Img id={m.id} kind="thumb" version={photos.version} label={alt(m)} />
                  <span className="small">{cap(m.pose)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

export function PhotosCard({ photos, onOpen }: { photos: PhotosStore; onOpen: () => void }) {
  const latest = photos.metas.reduce((a, m) => (m.date > a ? m.date : a), '');
  return (
    <section className="card" aria-labelledby="ph-h">
      <h2 id="ph-h">Progress photos</h2>
      <p className="muted">{photos.metas.length ? `${photos.metas.length} photo${photos.metas.length === 1 ? '' : 's'} · latest ${fmtDate(latest)}` : 'Front, side and back photos, kept only on this phone.'}</p>
      <button className="wide" onClick={onOpen}>Open photos</button>
    </section>
  );
}
