import { useEffect, useState } from 'react';
import { useDb } from '../state/profileDb';
import { comparePair, photoDate, photoId, POSES, shotName, timeline, VARIANTS, weightNear, type PhotoMeta, type Shot } from '../domain/photos';
import { localDate } from '../domain/ids';
import { trend } from '../domain/body';
import { fmtDate, fmtDay, plural } from '../domain/format';
import type { PhotosStore } from '../state/usePhotos';
import type { BodyStore } from '../state/useBody';
import type { BackupStore } from '../state/useBackup';
import { Input } from './Field';
import { BackupNudge } from './BackupCard';
import { decode, encode } from './photoImage';
import { PhotoCapture } from './PhotoCapture';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const alt = (m: Shot & { date: string }) => `${shotName(m)}, ${m.date}`;

/** Front, Side, Back, and Relaxed or Flexed: which photo, as two rows of chips. */
function ShotChips({ label, shot, onPick }: { label: string; shot: Shot; onPick: (s: Shot) => void }) {
  return <div className="shot-chips">
    <div className="chips" role="group" aria-label={label}>
      {POSES.map((p) => <button key={p} type="button" className="chip" aria-pressed={shot.pose === p} onClick={() => onPick({ ...shot, pose: p })}>{cap(p)}</button>)}
    </div>
    <div className="chips" role="group" aria-label={`${label}: relaxed or flexed`}>
      {VARIANTS.map((v) => <button key={v} type="button" className="chip" aria-pressed={shot.variant === v} onClick={() => onPick({ ...shot, variant: v })}>{cap(v)}</button>)}
    </div>
  </div>;
}

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

function Img({ id, kind, version, label }: { id: string | null; kind: 'full' | 'thumb'; version: number; label: string }) {
  const url = useBlobUrl(id, kind, version);
  return url ? <img src={url} alt={label} /> : <span className="photo-ph" aria-hidden="true" />;
}

export function PhotosScreen({ photos, backup, body, today, backLabel = '‹ Back', onBack }: { photos: PhotosStore; backup: BackupStore; body: BodyStore; today: string; backLabel?: string; onBack: () => void }) {
  const db = useDb();
  const [shot, setShot] = useState<Shot>({ pose: 'front', variant: 'relaxed' });
  const [capturing, setCapturing] = useState(false);
  const [capMsg, setCapMsg] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<PhotoMeta | null>(null);
  const [cmp, setCmp] = useState<Shot>({ pose: 'front', variant: 'relaxed' });
  const [pick, setPick] = useState<[string, string] | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => {
    setShareFile(null);
    if (!open) return;
    let live = true;
    const name = `progress-${open.date}-${open.pose}${open.variant === 'flexed' ? '-flexed' : ''}.jpg`;
    void db.getPhotoBlob(open.id, 'full').then((b) => { if (live && b) setShareFile(new File([b], name, { type: 'image/jpeg' })); });
    return () => { live = false; };
  }, [open, photos.version]);
  const points = trend(body.days);
  const weight = (d: string) => { const w = weightNear(d, points); return w == null ? null : `${w.toFixed(1)} lb`; };

  async function onFile(file: File, source: 'camera' | 'library') {
    const when = photoDate(source, date, localDate(new Date()));
    if (!when) { setMsg('That date is in the future — pick today or earlier.'); return; }
    const { pose, variant } = shot, id = photoId(when, pose, variant), name = shotName(shot).toLowerCase();
    if (photos.metas.some((m) => m.id === id) && !confirm(`Replace the ${name} photo for ${when}?`)) return;
    setBusy(true); setMsg(null);
    try {
      const img = await decode(file);
      const [full, thumb] = [await encode(img, 1600), await encode(img, 320)];
      const ok = await photos.add({ id, date: when, pose, variant, width: full.width, height: full.height, addedAt: new Date().toISOString() }, full.blob, thumb.blob);
      if (ok) setMsg(`Saved ${name} photo for ${fmtDay(when, today)}.`);
    } catch (e) { setMsg(`Could not read that image: ${String(e)}`); }
    finally { setBusy(false); }
  }

  const dates = [...new Set(photos.metas.filter((m) => m.pose === cmp.pose && m.variant === cmp.variant).map((m) => m.date))].sort();
  const pair = pick && dates.includes(pick[0]) && dates.includes(pick[1]) ? pick : comparePair(photos.metas, cmp.pose, cmp.variant);

  if (open) return (
    <>
      <button onClick={() => setOpen(null)}>‹ Photos</button>
      <h1>{shotName(open)} · {fmtDate(open.date)}</h1>
      <p className="muted">{weight(open.date) ? `Trend weight ${weight(open.date)}` : 'No weigh-in within 3 days'}</p>
      <div className="photo-full"><Img id={open.id} kind="full" version={photos.version} label={alt(open)} /></div>
      <div className="form-actions">
        <button disabled={!shareFile} onClick={() => {
          // Called straight from the tap: the share sheet needs the user's gesture, so the file was read in advance.
          if (!shareFile || !navigator.canShare?.({ files: [shareFile] })) { setMsg('Sharing isn’t available here — long-press the photo to save it.'); return; }
          navigator.share({ files: [shareFile] }).catch((e: Error) => { if (e.name !== 'AbortError') setMsg(`Couldn’t open the share sheet (${e.name}) — long-press the photo to save it.`); });
        }}>Save to Photos</button>
        <button className="danger" onClick={async () => { if (confirm(`Delete the ${shotName(open).toLowerCase()} photo for ${open.date}? This can’t be undone.`) && (await photos.remove(open.id))) setOpen(null); }}>Delete photo</button>
      </div>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </>
  );

  return (
    <>
      <button className="back" onClick={onBack}>{backLabel}</button>
      <h1>Progress photos</h1>
      <BackupNudge backup={backup} />
      <section className="card">
        <p className="muted small">Kept only on this phone, never uploaded or synced; the backup file under More › Backup is their one copy. Same spot, light and time of day each time.</p>
        <button type="button" className="primary wide" onClick={() => { setCapMsg(null); setCapturing(true); }}>Record the 6 poses</button>
        <p className="muted small" role="status">{capMsg ?? 'Prop the phone up, step back into the outline and walk through front, side and back, relaxed then flexed. Then pick the best frame of each; the video isn’t kept.'}</p>
      </section>
      {capturing && <PhotoCapture photos={photos} onClose={(n) => { setCapturing(false); if (n) setCapMsg(`Saved ${plural(n, 'photo')} for today.`); }} />}

      <section className="card" aria-labelledby="one-h">
        <h2 id="one-h">One photo</h2>
        <ShotChips label="Pose" shot={shot} onPick={setShot} />
        <label className="photo-date">Date for library photos<Input type="date" aria-label="Photo date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></label>
        <div className="photo-add">
          <label className={`button${busy ? ' disabled' : ''}`}>Take photo
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
        <ShotChips label="Compare pose" shot={cmp} onPick={(s) => { setCmp(s); setPick(null); }} />
        {!pair ? <p className="muted">Two dates with a {shotName(cmp).toLowerCase()} photo are needed to compare.</p> : (
          <div className="compare">
            {[0, 1].map((k) => (
              <figure key={k}>
                <select aria-label={k === 0 ? 'Before' : 'After'} value={pair[k]} onChange={(e) => setPick(k === 0 ? [e.target.value, pair[1]] : [pair[0], e.target.value])}>
                  {dates.map((d) => <option key={d} value={d}>{fmtDay(d, today)}</option>)}
                </select>
                <Img id={photoId(pair[k], cmp.pose, cmp.variant)} kind="full" version={photos.version} label={alt({ ...cmp, date: pair[k] })} />
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
                  <span className="small">{shotName(m)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
