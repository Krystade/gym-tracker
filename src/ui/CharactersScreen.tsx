import { useEffect, useRef, useState } from 'react';

// A preview of every character, grouped by the pack it came from. The art and its credits live in public/characters/.
type Anim = { src: string; n: number };
type Char = { id: string; name: string; group: string; rarity: Rarity; w: number; h: number }
  & ({ kind: 'sprite'; core: number; anims: Record<string, Anim> } | { kind: 'img'; pixel: boolean; src: string });
type Source = { group: string; by: string; url: string; licence: string };
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
const RARITY: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const BASE = `${import.meta.env.BASE_URL}characters/`;

export function CharactersScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<{ sources: Source[]; chars: Char[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`${BASE}index.json`).then((r) => r.json()).then((d) => { if (live) setData(d); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, []);
  return (
    <>
      <button className="back" onClick={onBack}>‹ Back</button>
      <h1>Characters</h1>
      <p className="muted small">A preview of every character so far, by the pack it came from.</p>
      {error ? <p role="alert" className="card">Couldn’t load the characters.</p>
        : !data ? <p className="muted">Loading…</p>
        : <>
          {data.sources.map((s) => {
            const cs = data.chars.filter((c) => c.group === s.group);
            if (!cs.length) return null;
            return (
              <section key={s.group} className="char-group" aria-label={s.group}>
                <h2>{s.group} <span className="muted small">{s.by} · {cs.length}</span></h2>
                <ul className="char-grid">
                  {cs.map((c) => (
                    <li key={c.id} className={`char r-${c.rarity}`}>
                      <div className="char-art"><CharArt c={c} box={64} /></div>
                      <b>{c.name}</b>
                      <span className="char-rarity">{RARITY[c.rarity]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <section className="card">
            <h2>Credits</h2>
            <ul className="credits small">
              {data.sources.map((s) => <li key={s.group}>{s.group}: <a href={s.url} target="_blank" rel="noreferrer">{s.by}</a> · {s.licence}</li>)}
            </ul>
          </section>
        </>}
    </>
  );
}

/** Pixel art at a whole-number scale, flat art smoothly; sprites cycle their first animation. */
function CharArt({ c, box }: { c: Char; box: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const src = c.kind === 'sprite' ? Object.values(c.anims)[0] : { src: c.src, n: 1 };
  const s = c.kind === 'sprite'
    ? Math.max(1, Math.min(Math.round(box / c.core), Math.floor((box * 1.25) / Math.max(c.w, c.h))))
    : c.pixel ? Math.max(1, Math.floor(box / Math.max(c.w, c.h))) : box / Math.max(c.w, c.h);
  const w = Math.round(c.w * s), h = Math.round(c.h * s);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const img = new Image();
    let f = 0, timer = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = c.kind === 'img' && !c.pixel;
      if (c.kind === 'sprite') ctx.drawImage(img, f * c.w, 0, c.w, c.h, 0, 0, w, h);
      else ctx.drawImage(img, 0, 0, w, h);
    };
    img.onload = () => {
      draw();
      if (src.n > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = window.setInterval(() => { f = (f + 1) % src.n; draw(); }, 140);
    };
    img.src = BASE + src.src;
    return () => { img.onload = null; clearInterval(timer); };
  }, [c, src.src, src.n, w, h]);
  return <canvas ref={ref} width={w} height={h} aria-hidden="true" />;
}
