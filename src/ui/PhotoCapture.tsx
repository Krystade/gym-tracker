import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { coverCrop, photoId, POSES, seeds, shotIndex, shotName, SHOTS, VARIANTS, type Shot } from '../domain/photos';
import { localDate } from '../domain/ids';
import { plural } from '../domain/format';
import type { PhotosStore } from '../state/usePhotos';
import { encode } from './photoImage';
import { HINTS, OUTLINES } from './poseOutlines';
import './capture.css';

// Guided capture (owner 2026-10-29, in place of a countdown and an auto-still): one video recorded on the phone while he walks
// through the routine with each shot's outline over the camera, a tap on Next pose marking roughly where each shot is; then a
// scrubber per shot, starting there, to pick the frame to keep; then a review grid with re-pick and retake, and Save. Only the
// stills are kept: the recording is a blob in memory, let go on Save, Cancel or leaving, never written anywhere. No countdown,
// no voice. The frame is 3:4 and the still is cut to it (domain/photos coverCrop), so what was framed is what's kept.

const MAX_SECONDS = 180; // a recording stops itself here: it sits in memory until Save
const FRAME = 1 / 30; // the ‹ › step: a frame at 30 fps
const CANT = 'This browser can’t record video here. Take each photo with Take photo instead.';
const GONE = 'The camera stopped when the app left the screen.';

type Phase = 'starting' | 'off' | 'live' | 'rec' | 'pick' | 'review';
/** A recording, as an object URL of the blob, and how long it ran by the clock here (a recorder's own duration can be missing). */
interface Take { url: string; length: number }
interface Picked { take: number; at: number; full: Blob; thumb: Blob; width: number; height: number; url: string }

function cameraError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was turned down. Allow the camera for this site (Settings › Apps › Safari › Camera), then try again, or use Take photo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. Use From library instead.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is busy (another app may have it). Close that, then try again.';
  return `The camera didn’t start (${String(e)}). Try again, or use Take photo.`;
}
const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function Outline({ shot }: { shot: Shot }) {
  const ds = OUTLINES[shot.pose][shot.variant];
  return (
    <svg className="cap-outline" viewBox="0 0 75 100" preserveAspectRatio="none" aria-hidden="true">
      {ds.map((d, k) => <path key={`h${k}`} className="halo" d={d} />)}
      {ds.map((d, k) => <path key={k} d={d} />)}
    </svg>
  );
}

/** One shot's scrubber over a recording: starts at `start`, ‹ › a frame each way; Use this frame cuts the still. */
function Scrub({ take, start, onKeep }: { take: Take; start: number; onKeep: (p: Omit<Picked, 'take' | 'url'>) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(start);
  const [end, setEnd] = useState(take.length);
  const [busy, setBusy] = useState(true); // loading or seeking: the frame on screen isn't the one at t yet
  const [err, setErr] = useState<string | null>(null);
  const go = useCallback((x: number, max: number) => {
    const el = v.current;
    if (!el) return;
    const to = Math.max(0, Math.min(max - 0.001, x));
    setT(to); setBusy(true);
    el.currentTime = to;
  }, []);
  useEffect(() => {
    const el = v.current!;
    let live = true, endless = false;
    const ready = (d: number) => { const max = d > 0 ? d : take.length; setEnd(max); go(start, max); };
    const onMeta = async () => {
      // Shown a frame before the first seek: iOS may not draw a paused video it never played (muted, so nothing is heard).
      try { await el.play(); } catch { /* not allowed: the seek shows the frame anyway */ }
      el.pause();
      if (!live) return;
      // A recorder's WebM has no duration until it's read through to the end (Chrome): seek far past it first.
      if (Number.isFinite(el.duration)) ready(el.duration); else { endless = true; el.currentTime = 1e9; }
    };
    const onDuration = () => { if (endless && Number.isFinite(el.duration)) { endless = false; ready(el.duration); } };
    const onSeeked = () => { if (!endless && !el.seeking) setBusy(false); };
    const onError = () => setErr('This recording can’t be read here. Retake it, or use Take photo.');
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onDuration);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onError);
    el.src = take.url;
    return () => {
      live = false;
      el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('durationchange', onDuration);
      el.removeEventListener('seeked', onSeeked); el.removeEventListener('error', onError);
      el.removeAttribute('src'); el.load();
    };
  }, [take.url]);

  async function keep() {
    const el = v.current;
    if (!el || busy || !el.videoWidth) return;
    setBusy(true);
    try {
      const c = coverCrop(el.videoWidth, el.videoHeight, 3 / 4);
      const cv = document.createElement('canvas');
      cv.width = c.width; cv.height = c.height;
      cv.getContext('2d')!.drawImage(el, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
      const [full, thumb] = [await encode(cv, 1600), await encode(cv, 320)];
      onKeep({ at: t, full: full.blob, thumb: thumb.blob, width: full.width, height: full.height });
    } catch (e) { setErr(`Couldn’t take that frame: ${String(e)}`); setBusy(false); }
  }

  return (
    <>
      <div className="cap-stage"><div className="cap-frame"><video ref={v} muted playsInline preload="auto" /></div></div>
      <div className="cap-scrub">
        <input type="range" min={0} max={end} step={FRAME} value={t} aria-label="Frame" aria-valuetext={time(t)} onChange={(e) => go(Number(e.target.value), end)} />
        <div className="cap-scrub-row">
          <button type="button" aria-label="A frame back" onClick={() => go(t - FRAME, end)}>‹</button>
          <span className="cap-time">{time(t)}</span>
          <button type="button" aria-label="A frame on" onClick={() => go(t + FRAME, end)}>›</button>
        </div>
        {err && <p className="warn small" role="alert">{err}</p>}
        <button type="button" className="primary cap-go" disabled={busy || !!err} onClick={() => void keep()}>Use this frame</button>
      </div>
    </>
  );
}

export function PhotoCapture({ photos, onClose }: { photos: PhotosStore; onClose: (saved: number) => void }) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  // The shots this recording walks through: the whole routine, or the one being retaken.
  const [queue, setQueue] = useState<number[]>(() => SHOTS.map((_, i) => i));
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [seed, setSeed] = useState<Record<number, { take: number; at: number }>>({});
  const [picked, setPicked] = useState<Record<number, Picked>>({});
  const [toPick, setToPick] = useState<number[]>([]);
  const [pickAt, setPickAt] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [camRev, setCamRev] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const clock = useRef({ t0: 0, marks: [] as number[], end: 0, queue: [] as number[] });
  const takes = useRef<Take[]>([]);
  const urls = useRef<string[]>([]); // every object URL made here, revoked on the way out
  const gen = useRef(0); // the camera start that counts: a later one, or leaving, makes an earlier one stop its stream
  const alive = useRef(true);
  const shot = SHOTS[queue[step] ?? 0];

  const stopCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void lock.current?.release().catch(() => {});
    lock.current = null;
  };
  // In a tap where it can be: WebKit grants a wake lock only in one, then for the rest of the page's life (ui/RestTimer).
  const wake = () => {
    void navigator.wakeLock?.request('screen').then((l) => {
      if (stream.current && !lock.current) lock.current = l; else void l.release().catch(() => {});
    }, () => { /* not allowed here: recording goes on, and the screen sleeps as iOS decides */ });
  };

  async function startCamera(face = facing) {
    const mine = ++gen.current;
    stopCamera();
    setMsg(null); setPhase('starting');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setMsg(CANT); setPhase('off'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: face, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (mine !== gen.current || !alive.current) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      // The track ends when iOS takes the camera back: the app backgrounded, the screen locked, a call.
      s.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream.current === s) interrupted(); });
      setFacing(face); setCamRev((n) => n + 1); setStep(0); setPhase('live');
      wake();
    } catch (e) {
      if (mine === gen.current && alive.current) { setMsg(cameraError(e)); setPhase('off'); }
    }
  }

  const attach = useCallback((el: HTMLVideoElement | null) => {
    if (!el || !stream.current) return;
    el.srcObject = stream.current;
    void el.play().catch(() => { /* autoplay: muted and inline, so it plays */ });
  }, [camRev]);

  function record() {
    const s = stream.current;
    if (!s) return;
    wake();
    const type = ['video/mp4', 'video/webm'].find((x) => MediaRecorder.isTypeSupported?.(x)); // iOS Safari: MP4 only
    let r: MediaRecorder;
    try { r = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 8_000_000 }); } catch (e) { setMsg(`${CANT} (${String(e)})`); return; }
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => recorded(new Blob(chunks, { type: r.mimeType || type || 'video/mp4' }));
    clock.current = { t0: performance.now(), marks: [0], end: 0, queue };
    r.start(1000); // in pieces, so what was recorded survives the camera being taken away
    rec.current = r;
    setStep(0); setElapsed(0); setMsg(null); setPhase('rec');
  }
  const now = () => (performance.now() - clock.current.t0) / 1000;
  function next() {
    const c = clock.current;
    if (c.marks.length < c.queue.length) { c.marks.push(now()); setStep(c.marks.length - 1); } else stopRec();
  }
  function stopRec(note?: string) {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clock.current.end = now();
    if (note) setMsg(note);
    if (r.state !== 'inactive') r.stop();
    stopCamera();
  }
  /** The recording, whole or cut short: each shot it reached gets its scrubber's start, then the picking. */
  function recorded(blob: Blob) {
    const c = clock.current;
    if (!c.end) c.end = now();
    rec.current = null;
    stopCamera();
    if (!alive.current) return;
    if (!blob.size) { setMsg((m) => `${m ? `${m} ` : ''}Nothing was recorded.`); setPhase('off'); return; }
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    const take = takes.current.push({ url, length: c.end }) - 1;
    const at = seeds(c.marks, c.end);
    const reached = c.queue.slice(0, at.length);
    setSeed((s) => ({ ...s, ...Object.fromEntries(reached.map((i, k) => [i, { take, at: at[k] }])) }));
    setToPick(reached); setPickAt(0); setPhase('pick');
  }
  function interrupted() {
    if (rec.current) stopRec(`${GONE} What was recorded is kept: pick from it, then retake the rest from the review.`);
    else if (stream.current) { stopCamera(); setMsg(GONE); setPhase('off'); }
  }

  useEffect(() => {
    alive.current = true;
    void startCamera('user');
    const root = document.documentElement;
    root.classList.add('cap-open');
    const onVis = () => {
      if (document.visibilityState === 'hidden') interrupted();
      else if (stream.current) wake(); // a hidden page loses its wake lock
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive.current = false; gen.current++;
      document.removeEventListener('visibilitychange', onVis);
      root.classList.remove('cap-open');
      const r = rec.current;
      if (r) { r.ondataavailable = null; r.onstop = null; if (r.state !== 'inactive') r.stop(); rec.current = null; }
      stopCamera();
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = []; takes.current = [];
    };
  }, []);
  useEffect(() => {
    if (phase !== 'rec') return;
    const id = setInterval(() => { const s = now(); setElapsed(s); if (s >= MAX_SECONDS) stopRec(`Stopped at ${MAX_SECONDS / 60} minutes.`); }, 250);
    return () => clearInterval(id);
  }, [phase]);

  function kept(i: number, p: Omit<Picked, 'take' | 'url'>) {
    const url = URL.createObjectURL(p.thumb);
    urls.current.push(url);
    setPicked((x) => ({ ...x, [i]: { ...p, take: seed[i].take, url } }));
    setSeed((s) => ({ ...s, [i]: { ...s[i], at: p.at } })); // a re-pick starts where this one was kept
    if (pickAt + 1 < toPick.length) setPickAt(pickAt + 1); else { setSel(null); setPhase('review'); }
  }
  /** A shot kept: record it again alone. A missing one: record every missing shot from there, as the routine went on. */
  function retake(i: number) {
    setQueue(picked[i] ? [i] : SHOTS.map((_, k) => k).filter((k) => k >= i && !picked[k]));
    setSel(null); void startCamera();
  }
  function repick(i: number) { setToPick([i]); setPickAt(0); setMsg(null); setPhase('pick'); }

  const keptShots = Object.keys(picked).map(Number).sort((a, b) => a - b);
  async function save() {
    const today = localDate(new Date());
    const id = (i: number) => photoId(today, SHOTS[i].pose, SHOTS[i].variant);
    const replacing = keptShots.filter((i) => photos.metas.some((m) => m.id === id(i)));
    if (replacing.length && !confirm(`Replace today’s ${replacing.map((i) => shotName(SHOTS[i])).join(', ')} ${replacing.length === 1 ? 'photo' : 'photos'}?`)) return;
    setSaving(true);
    let n = 0;
    for (const i of keptShots) {
      const p = picked[i], s = SHOTS[i];
      if (!(await photos.add({ id: id(i), date: today, pose: s.pose, variant: s.variant, width: p.width, height: p.height, addedAt: new Date().toISOString() }, p.full, p.thumb))) break;
      n++;
    }
    setSaving(false);
    if (n < keptShots.length) { setMsg(`Saved ${n} of ${keptShots.length}: the rest couldn’t be saved. Is the phone out of space?`); return; }
    onClose(n);
  }
  function cancel() {
    if (keptShots.length && !confirm('Discard the frames picked so far? The recording isn’t kept either.')) return;
    onClose(0);
  }

  const title = phase === 'pick' ? `Pick ${pickAt + 1} of ${toPick.length}` : phase === 'review' ? 'Review' : queue.length > 1 ? 'Record poses' : `Retake ${shotName(shot)}`;
  const picking = phase === 'pick' ? toPick[pickAt] : null;
  const last = step >= queue.length - 1;
  return createPortal(
    <section className="cap" role="dialog" aria-modal="true" aria-label={title}>
      <header className="cap-head">
        <button type="button" className="back" onClick={cancel}>Cancel</button>
        <h2>{title}</h2>
      </header>

      {(phase === 'starting' || phase === 'live' || phase === 'rec') && <>
        <div className="cap-stage">
          <div className="cap-frame">
            {phase !== 'starting' && <video key={camRev} ref={attach} className={facing === 'user' ? 'mirror' : undefined} muted playsInline autoPlay />}
            <Outline shot={shot} />
            {phase === 'starting' && <p className="cap-wait">Starting the camera…</p>}
            {phase === 'rec' && <span className="cap-rec" role="timer" aria-label={`Recording, ${Math.floor(elapsed)} seconds`}><i aria-hidden="true" />{time(elapsed).slice(0, -2)}</span>}
          </div>
        </div>
        <div className="cap-pose" aria-live="polite">
          <p><b>{shotName(shot)}</b>{queue.length > 1 && <span className="muted"> · {step + 1} of {queue.length}</span>}</p>
          <p className="muted small">{HINTS[shot.pose][shot.variant]}</p>
        </div>
        {msg && <p className="cap-msg warn small" role="status">{msg}</p>}
        <div className="cap-bar">
          {phase === 'rec'
            ? <><button type="button" onClick={() => stopRec()}>Stop</button>
              <button type="button" className="primary cap-go" onClick={next}>{last ? 'Done' : 'Next pose'}</button></>
            : <><button type="button" disabled={phase !== 'live'} onClick={() => void startCamera(facing === 'user' ? 'environment' : 'user')}>Flip camera</button>
              <button type="button" className="primary cap-go" disabled={phase !== 'live'} onClick={record}>Record</button></>}
        </div>
      </>}

      {phase === 'off' && (
        <div className="cap-off">
          {msg && <p role="status">{msg}</p>}
          {msg !== CANT && <button type="button" className="primary wide" onClick={() => void startCamera()}>{msg === GONE || !msg ? 'Start the camera' : 'Try again'}</button>}
          {keptShots.length > 0 && <button type="button" className="wide" onClick={() => { setMsg(null); setPhase('review'); }}>Back to review</button>}
          <button type="button" className="wide" onClick={cancel}>Use Take photo instead</button>
        </div>
      )}

      {picking != null && seed[picking] && <>
        {msg && <p className="cap-msg warn small" role="status">{msg}</p>}
        <div className="cap-pose">
          <p><b>{shotName(SHOTS[picking])}</b></p>
          <p className="muted small">Slide to the frame to keep.</p>
        </div>
        <Scrub key={`${picking}:${seed[picking].take}`} take={takes.current[seed[picking].take]} start={seed[picking].at} onKeep={(p) => kept(picking, p)} />
      </>}

      {phase === 'review' && <>
        <div className="cap-review">
          <div className="cap-grid">
            {VARIANTS.flatMap((variant) => POSES.map((pose) => shotIndex({ pose, variant }))).map((i) => {
              const p = picked[i], name = shotName(SHOTS[i]);
              return (
                <button key={i} type="button" className="cap-tile" aria-pressed={sel === i} aria-label={p ? name : `${name}, missing`} onClick={() => setSel(sel === i ? null : i)}>
                  {p ? <img src={p.url} alt="" /> : <span className="cap-missing">Missing</span>}
                  <span className="small">{name}</span>
                </button>
              );
            })}
          </div>
          {sel == null ? <p className="muted small">Tap a photo to pick another frame or retake it. Only these photos are saved; the video isn’t kept.</p> : (
            <div className="cap-acts">
              <b>{shotName(SHOTS[sel])}</b>
              <div className="form-actions">
                {seed[sel] && <button type="button" onClick={() => repick(sel)}>Pick another frame</button>}
                <button type="button" onClick={() => retake(sel)}>Retake</button>
              </div>
            </div>
          )}
          {msg && <p className="warn small" role="status">{msg}</p>}
        </div>
        <div className="cap-bar one">
          <button type="button" className="primary cap-go" disabled={!keptShots.length || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : `Save ${plural(keptShots.length, 'photo')}`}
          </button>
        </div>
      </>}
    </section>,
    document.body,
  );
}
