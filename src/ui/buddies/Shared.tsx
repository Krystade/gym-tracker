import { useMemo, useState, type CSSProperties } from 'react';
import { ledgerOf } from '../../domain/buddies/gacha';
import { BUDDY, RARITIES, SLOTS, STATS, defaultName, type BuddyDef, type Stat } from '../../domain/buddies/roster';
import { bestShared, leadOf, type SharedBud, type SharedBuddy } from '../../domain/buddies/share';
import { statsOf, TRAIT_TENTHS, trainingOf } from '../../domain/buddies/stats';
import type { Profile } from '../../domain/profile';
import type { SetEntry } from '../../domain/types';
import type { BuddiesStore } from '../../state/useBuddies';
import { BuddySprite } from './BuddySprite';
import { accName, SLOT_NAME, wornClass } from './Worn';

// Friends' buddies (Gym Buddies plan §16.8, stage 6), all from the `bud` of their Compare summary (domain/buddies/share), which
// their page and Crew already read: no read of its own. Their lead on Crew; on their page a roster strip with their lifetime
// points, a tap opening a buddy's card read-only; and Side by side, your lead and theirs, the four stats as mirrored bars and
// each one's best stat named. No winner is named and nothing is stored (owner Q3).

const STAT: Record<Stat, string> = { power: 'Power', size: 'Size', grit: 'Grit', stamina: 'Stamina' };
const RARITY = RARITIES.map((r) => r[0].toUpperCase() + r.slice(1));
const n = (x: number) => x.toLocaleString('en-US');
const traitText = (b: BuddyDef) => `${STAT[b.trait]} ×${(TRAIT_TENTHS[b.rarity] / 10).toFixed(1)}`;

/** Their lead beside their name on Crew: the sprite at 32 px (a whole-number scale; no held item, which would stand out of the pill) and its Lv. */
export function BudChip({ bud }: { bud: SharedBud }) {
  const { buddy, def } = leadOf(bud);
  return (
    <span className="bud-chip" role="img" aria-label={`Lead buddy ${defaultName(def.id)}, Lv ${n(buddy.l)}`}>
      <BuddySprite poses={def.poses.slice(0, 1)} scale={2} />
      <span aria-hidden="true">Lv {n(buddy.l)}</span>
    </span>
  );
}

/** Your lead as Side by side sets it beside theirs: the same numbers its card shows. None before your first pick. */
export interface MyLead { def: BuddyDef; name: string; buddy: SharedBuddy }
export function useMyLead(buddies: BuddiesStore | undefined, entries: readonly SetEntry[], today: string, profile: Profile | undefined): MyLead | null {
  const kept = buddies?.kept, lead = buddies?.lead;
  return useMemo(() => {
    if (!kept || !lead || !profile) return null;
    const owned = ledgerOf(kept.spends).owned, day = owned.get(lead.id);
    if (!day) return null;
    const st = statsOf(lead, day, trainingOf(entries, { start: kept.start, today, profile }));
    const eq = kept.prefs[lead.id]?.equip ?? {};
    return { def: lead, name: kept.prefs[lead.id]?.name ?? defaultName(lead.id), buddy: { i: lead.id, l: st.lv, s: STATS.map((s) => st.level[s]), e: SLOTS.map((s) => { const x = eq[s]; return x && owned.has(x) ? x : null; }) } };
  }, [kept, lead, entries, today, profile]);
}

/** Their buddies on their page: the roster strip and their points, then Side by side. Nothing when they have none to share. */
export function FriendBuddies({ name, bud, mine }: { name: string; bud: SharedBud | undefined; mine: MyLead | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!bud) return null;
  const shown = bud.r.find((b) => b.i === open);
  return (
    <>
      <section className="card fb-buddies" aria-labelledby="fb-h">
        <h2 id="fb-h">@{name}’s buddies <span className="fb-pts"><i className="bu-coin" aria-hidden="true" />{n(bud.pts)} points earned</span></h2>
        <ul className="fb-strip" aria-label={`@${name}’s buddies`}>
          {bud.r.map((b) => {
            const def = BUDDY.get(b.i)!;
            return (
              <li key={b.i}>
                <button className={`bu-tile r${def.rarity}`} onClick={() => setOpen(b.i)} aria-label={`${defaultName(b.i)}, Lv ${b.l}${b.i === bud.lead ? ', lead' : ''}`}>
                  <BuddySprite poses={def.poses.slice(0, 1)} scale={3} held={b.e[0]} />
                  <b>{defaultName(b.i)}</b>
                  <span>{b.i === bud.lead ? 'Lead · ' : ''}Lv {n(b.l)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <SideBySide name={name} theirs={leadOf(bud)} mine={mine} />
      {shown && <CardSheet name={name} b={shown} lead={shown.i === bud.lead} onClose={() => setOpen(null)} />}
    </>
  );
}

/** A friend's buddy, read only: what its card shows of it, without the bars to the next point (only the numbers are shared). */
function CardSheet({ name, b, lead, onClose }: { name: string; b: SharedBuddy; lead: boolean; onClose: () => void }) {
  const def = BUDDY.get(b.i)!;
  const [held, aura, plinth, backdrop] = b.e;
  const title = defaultName(b.i);
  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="sheet bu-sheet" role="dialog" aria-modal="true" aria-label={`@${name}’s ${title}`}>
        <div className="sheet-head">
          <h2>@{name}’s buddy</h2>
          <button className="mini" onClick={onClose}>Done</button>
        </div>
        <div className={`bu-sheet-body bu-card r${def.rarity}`}>
          <div className={`bu-hero fb-hero ${wornClass(backdrop ?? undefined)}${held ? ' has-held' : ''}`}>
            <span className="bu-tag">Lv {n(b.l)}</span>
            {lead && <span className="bu-tag lead">Lead</span>}
            <BuddySprite poses={def.poses} scale={7} className={`bu-hero-sprite ${wornClass(aura ?? undefined)}`} held={held} />
            <i className={plinth ? `bu-plinth ${wornClass(plinth)}` : 'bu-floor'} aria-hidden="true" />
          </div>
          <div className="bu-name fb-name">
            <h3>{title}</h3>
            <span className="bu-meta"><b className="bu-rarity">{RARITY[def.rarity]}</b> · {traitText(def)}</span>
          </div>
          <ul className="bu-stats" aria-label="Stats">
            {STATS.map((s, k) => (
              <li key={s} className={`bu-stat s-${s}${s === def.trait ? ' trait' : ''}`} aria-label={`${STAT[s]} ${b.s[k]}${s === def.trait ? ', its trait' : ''}`}>
                <b>{n(b.s[k])}</b><span>{STAT[s]}</span>
              </li>
            ))}
          </ul>
          <p className="bu-from">Wearing: {SLOTS.map((s, k) => (b.e[k] ? `${accName(b.e[k]!)} (${SLOT_NAME[s].toLowerCase()})` : null)).filter(Boolean).join(', ') || 'nothing yet'}.</p>
        </div>
      </section>
    </>
  );
}

/** Your lead and theirs, stat by stat from the middle out, each named by what it's best at. Never who's ahead. */
function SideBySide({ name, theirs, mine }: { name: string; theirs: { buddy: SharedBuddy; def: BuddyDef }; mine: MyLead | null }) {
  const max = Math.max(1, ...theirs.buddy.s, ...(mine?.buddy.s ?? []));
  const w = (v: number) => ({ '--w': `${(v / max) * 100}%` } as CSSProperties);
  const side = (who: string, nm: string, def: BuddyDef, b: SharedBuddy, cls: string) => (
    <div className={`sbs-who ${cls}`}>
      <BuddySprite poses={def.poses.slice(0, 1)} scale={3} held={b.e[0]} />
      <span className="sbs-name"><span className="sbs-whose">{who}</span><b>{nm}</b><span>Lv {n(b.l)} · best at {STAT[bestShared(b.s, def.trait)]}</span></span>
    </div>
  );
  return (
    <section className="card sbs" aria-labelledby="sbs-h">
      <h2 id="sbs-h">Side by side <span>each from the day it joined</span></h2>
      <div className="sbs-head">
        {mine ? side('Yours', mine.name, mine.def, mine.buddy, 'me') : <p className="sbs-none small muted">Pick a buddy on the Buddies tab to set yours here.</p>}
        {side(`@${name}’s`, defaultName(theirs.def.id), theirs.def, theirs.buddy, 'them')}
      </div>
      <ul className="sbs-rows" aria-label="Stats, yours and theirs">
        {STATS.map((s, k) => (
          <li key={s} className={`sbs-row s-${s}`} aria-label={`${STAT[s]}: ${mine ? `yours ${mine.buddy.s[k]}, ` : ''}@${name}’s ${theirs.buddy.s[k]}`}>
            <span className="sbs-bar me" aria-hidden="true">{mine && <><span>{n(mine.buddy.s[k])}</span><i><b style={w(mine.buddy.s[k])} /></i></>}</span>
            <span className="sbs-stat" aria-hidden="true">{STAT[s]}</span>
            <span className="sbs-bar them" aria-hidden="true"><i><b style={w(theirs.buddy.s[k])} /></i><span>{n(theirs.buddy.s[k])}</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
