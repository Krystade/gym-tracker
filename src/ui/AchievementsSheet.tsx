import { amount, DEF, DEFS, GROUPS, closest, highest, isPrivate, plateLoad, tierWord, TIERS, unlockedOn, unlockText, type Achievements, type Def, type Tier, type Track, type Unlock } from '../domain/achievements';
import { useEffect, useRef } from 'react';
import { UNPAID } from '../domain/buddies/rewards';
import { weekRings, withList, type TogetherId } from '../domain/together';
import type { SetEntry } from '../domain/types';
import { useTogetherNames, useTogetherSeen } from '../state/useAchievements';
import { Icon, initials } from './icons';
import { Medal, TIER_COLOUR } from './Medal';
import './ach.css';

// Achievements on Stats (plan §6): the sheet the wide tile opens, and a family's detail. Lifetime, from the day this profile
// started counting: the range control doesn't apply. Each row opens its family's detail; nothing here writes anything.

/** Where the Achievements page opens: at a family (one lift of a per-lift one), or at its top. */
export interface AchAt { id?: string; lift?: string }

/**
 * Opens at `at`: its row scrolled to the middle and lit for a moment (an unlock tapped on Today, the finish card, a friend's
 * chip). Once per `at`; the light goes on its own, whatever renders meanwhile.
 */
function useAchFocus(at?: AchAt | null) {
  const box = useRef<HTMLDivElement>(null);
  const key = at?.id ? `${at.id}:${at.lift ?? ''}` : null;
  useEffect(() => {
    if (!at?.id || !box.current) return;
    const rows = [...box.current.querySelectorAll<HTMLElement>('[data-ach]')].filter((e) => e.dataset.ach === at.id);
    const el = rows.find((e) => (e.dataset.lift ?? '') === (at.lift ?? '')) ?? rows[0];
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('ach-hit');
    setTimeout(() => el.classList.remove('ach-hit'), 2400);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return box;
}

/** "Today", "Mar 20", or "Mar 20, 2025" in another year. */
export const achDay = (d: string, today: string) => (d === today ? 'Today'
  : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, d.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }));

const tierAt = (t: Track): Tier | 'lock' => (t.level >= 0 ? DEF.get(t.id)!.levels[t.level].tier : 'lock');
const nextTier = (t: Track): Tier | null => DEF.get(t.id)!.levels[t.level + 1]?.tier ?? null;
const titleOf = (t: Pick<Track, 'id' | 'lift'>) => `${DEF.get(t.id)!.title}${t.lift ? ` · ${t.lift}` : ''}`;

/** What's left to the next level, said: "1 week to go", "Bench Press: 225 lb", "25% on three lifts". */
export function toGo(t: Track): string {
  const n = t.next!;
  if (t.id === 'plates') return `${t.lift}: ${plateLoad(n)} lb`;
  if (t.id === 'bodyweight') return `${t.lift}: ${n} in a set`;
  if (t.id === 'stronger') return `${n}% on three lifts`;
  return `${amount(t.id, n - t.value)} to go`;
}
/** How far along to the next level: "11 of 12 weeks", "6 of 10 in a set", "135 lb · 225 lb next". */
function ofNext(t: Track): string {
  const n = t.next!, v = t.value;
  if (t.id === 'plates') return `${v ? `${plateLoad(v)} lb` : 'Not yet'} · ${plateLoad(n)} lb next`;
  if (t.id === 'bodyweight') return `${v} of ${n} in a set`;
  if (t.id === 'stronger') return `${v}% of ${n}% on three lifts`;
  return `${v.toLocaleString('en-US')} of ${amount(t.id, n)}`;
}
/** The tile's line: the closest next level. */
export function nextLine(a: Achievements): string | null {
  const t = closest(a, 1)[0];
  return t ? `Next: ${DEF.get(t.id)!.title} ${nextTier(t)} · ${toGo(t)}` : null;
}

/** The tile's medals: each family's highest, the family most lately earned first; none yet, the next ones, locked. */
export function AchShelf({ a, w }: { a: Achievements; w: number }) {
  const n = Math.max(1, Math.min(6, Math.floor((w + 8) / 48)));
  const best = new Map<string, Unlock>(), last = new Map<string, string>();
  for (const u of a.unlocks) {
    const b = best.get(u.id);
    if (!b || TIERS.indexOf(u.tier) > TIERS.indexOf(b.tier)) best.set(u.id, u);
    if ((last.get(u.id) ?? '') < u.date) last.set(u.id, u.date);
  }
  const got = [...best.values()].sort((x, y) => last.get(y.id)!.localeCompare(last.get(x.id)!) || TIERS.indexOf(y.tier) - TIERS.indexOf(x.tier));
  const shown: { id: string; tier: Tier | 'lock' }[] = got.length ? got.map((u) => ({ id: u.id, tier: u.tier })) : closest(a, n).map((t) => ({ id: t.id, tier: 'lock' as const }));
  return <span className="ach-shelf">{shown.slice(0, n).map((m) => <Medal key={m.id} tier={m.tier} glyph={m.id} size={40} />)}</span>;
}

/**
 * What a set just saved unlocked (plan §6): a line each under the lift card's PR line, the highest level of each. Tapping one
 * opens Stats at its levels. The box is always there, so a screen reader hears lines as they come (aria-live), and it isn't a
 * status: the PR line is that.
 */
export function AchLines({ us, onOpen }: { us: readonly Unlock[] | null; onOpen?: (id: string, lift?: string) => void }) {
  const names = useTogetherNames();
  return (
    <div className="ach-lines" aria-live="polite">
      {us?.map((u) => (
        <button key={`${u.id}:${u.level}:${u.lift ?? ''}`} type="button" className="ach-line" onClick={() => onOpen?.(u.id, u.lift)}>
          <Medal tier={u.tier} glyph={u.id} size={36} />
          <span className="ach-line-txt">
            <span><span className={`ach-tier t-${u.tier}`}>{tierWord(u.tier)}</span> · <b>{DEF.get(u.id)!.title}</b></span>
            <span className="ach-line-sub">{unlockText(u, names?.name)}</span>
          </span>
          {onOpen && <Icon name="chev-right" size={18} sw={2} className="ach-line-go" />}
        </button>
      ))}
    </div>
  );
}

/** The closest next level, as the finish card shows it. */
export function NextRow({ t, onOpen }: { t: Track; onOpen?: (id: string, lift?: string) => void }) {
  const nt = nextTier(t)!;
  return (
    <button type="button" className="ach-row" onClick={() => onOpen?.(t.id, t.lift)}>
      <Medal tier="lock" glyph={t.id} size={44} />
      <span className="ach-row-txt">
        <b>{titleOf(t)} · {tierWord(nt)}</b>
        <span>{ofNext(t)}</span>
        {t.value > 0 && <Bar frac={t.value / t.next!} tier={nt} />}
      </span>
    </button>
  );
}

/** Part of the way to the next level, in that level's colour. */
const Bar = ({ frac, tier }: { frac: number; tier: Tier }) => (
  <span className="ach-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, Math.min(100, 100 * frac))}%`, background: TIER_COLOUR[tier].rim }} /></span>
);

/** One family (one lift of a per-lift one): its medal, where it stands, and the bar to its next level. */
function FamilyRow({ t, onOpen }: { t: Track; onOpen: (id: string) => void }) {
  const d = DEF.get(t.id)!, tier = tierAt(t), nt = nextTier(t);
  const line = d.repeat ? (t.value ? `${t.value.toLocaleString('en-US')} ${t.value === 1 ? 'time' : 'times'}` : `Not yet · ${d.how[0].toLowerCase()}${d.how.slice(1)}`)
    : nt ? `${t.value ? amount(t.id, t.value) : 'Not yet'} · ${nt} at ${amount(t.id, t.next!)}`
      : `${amount(t.id, t.value)} · every level`;
  return (
    <button type="button" className={`ach-row${tier === 'lock' ? ' locked' : ''}`} data-ach={t.id} data-lift={t.lift} onClick={() => onOpen(t.id)}>
      <Medal tier={tier} glyph={t.id} size={44} />
      <span className="ach-row-txt">
        <b>{titleOf(t)}</b>
        {tier !== 'lock' && <span className="sr-only">{tierWord(tier)}. </span>}
        <span>{line}</span>
        {nt && !d.repeat && t.value > 0 && <Bar frac={t.value / t.next!} tier={nt} />}
      </span>
    </button>
  );
}

/** An unlock: its medal, tier and what it means. */
export function UnlockRow({ u, today, onOpen }: { u: Unlock; today?: string; onOpen?: (id: string, lift?: string) => void }) {
  const names = useTogetherNames();
  return (
    <button type="button" className="ach-row" onClick={() => onOpen?.(u.id, u.lift)}>
      <Medal tier={u.tier} glyph={u.id} size={44} />
      <span className="ach-row-txt">
        <b>{DEF.get(u.id)!.title}</b>
        <span className={`ach-tier t-${u.tier}`}>{tierWord(u.tier)}</span>
        <span>{unlockText(u, names?.name)}</span>
      </span>
      {today && <span className="ach-when">{achDay(u.date, today)}</span>}
    </button>
  );
}

/** Where every family's tracks stand: one per family, one per lift for plates and bodyweight (a locked row before any). */
const tracksOf = (a: Achievements, d: Def): Track[] => {
  const ts = a.tracks.filter((t) => t.id === d.id);
  return ts.length ? ts : [{ id: d.id, value: 0, level: -1, next: d.levels[0].at }];
};

/** Together's foot: counted from the later of the two starts, from sets logged as they happened (owner 2026-10-22). */
function TogetherFoot() {
  return (
    <p className="ach-foot">
      Counting from the later of your start and each friend's. A set entered afterwards doesn't count, and nothing is taken away
      if a friend later deletes theirs. Worked out on your phone from both logs; only you see these.
    </p>
  );
}

/** Your body's foot: what it reads, that it stays here, and whether it pays buddy points (owner 2026-10-29: the habit only). */
function BodyFoot({ id, since, today }: { id: string; since: string; today: string }) {
  return (
    <p className="ach-foot">
      Counting from {since === today ? 'today' : achDay(since, today)}: weigh-ins and photos from then on. Worked out on your phone
      from your weigh-ins and photo dates; only you see these. {UNPAID.has(id) ? 'No buddy points: only Weigh-ins and Photo days pay them.' : 'Each level pays buddy points like any other.'}
    </p>
  );
}

/** Counting from the start: said once at the foot of the sheet and of each detail. */
function Foot({ since, today }: { since: string; today: string }) {
  return (
    <p className="ach-foot">
      Counting from {since === today ? 'today' : achDay(since, today)}: only sets logged from then on count, so everyone starts at 0
      (a PR still has to beat everything before). Worked out from your log as it is: edit or delete a set and these follow.
    </p>
  );
}

export function AchievementsSheet({ a, today, since, onOpen, at }: { a: Achievements; today: string; since: string; onOpen: (id: string) => void; /** Opened at a family. */ at?: AchAt | null }) {
  const box = useAchFocus(at);
  // Today's, the highest level of each (a first set at 315 is three plates, not one, two and three).
  const fresh = highest(unlockedOn(a, today));
  const next = closest(a, 3);
  // The private groups shown (Together, Your body): said once at the foot.
  const mine = GROUPS.filter((g) => isPrivate(g.id) && DEFS.some((d) => d.group === g.id && !a.hidden.includes(d.id))).map((g) => g.title);
  return (
    <div className="ach" ref={box}>
      <ul className="ach-tiers" aria-label="Earned by tier">
        {TIERS.map((t) => {
          const n = a.unlocks.filter((u) => u.tier === t).length;
          return <li key={t}><Medal tier={n ? t : 'lock'} size={36} /><b>{n}</b><span>{tierWord(t)}</span></li>;
        })}
      </ul>
      {fresh.length > 0 && (
        <section className="ach-sec" aria-label="New today">
          <h3>New<span>today</span></h3>
          {fresh.map((u) => <UnlockRow key={`${u.id}:${u.level}:${u.lift ?? ''}`} u={u} today={today} onOpen={onOpen} />)}
        </section>
      )}
      {next.length > 0 && (
        <section className="ach-sec" aria-label="Next up">
          <h3>Next up<span>closest first</span></h3>
          {next.map((t) => <NextRow key={`${t.id}:${t.lift ?? ''}`} t={t} onOpen={onOpen} />)}
        </section>
      )}
      {GROUPS.map((g) => {
        const defs = DEFS.filter((d) => d.group === g.id && !a.hidden.includes(d.id));
        if (!defs.length) return null;
        return (
          <section key={g.id} className="ach-sec" aria-label={g.title}>
            <h3>{g.title}{g.note && <span>{g.note}</span>}</h3>
            {defs.flatMap((d) => tracksOf(a, d)).map((t) => <FamilyRow key={`${t.id}:${t.lift ?? ''}`} t={t} onOpen={onOpen} />)}
          </section>
        );
      })}
      <Foot since={since} today={today} />
      {mine.length > 0 && <p className="ach-foot">{mine.join(' and ')}: only you see these, never shared with anyone, whatever the switches say.</p>}
    </div>
  );
}

/** Shown to friends: a switch for the family's group (owner Q3: per group, kept in the profile, so every phone of yours agrees). */
function ShareRow({ group, shown, onShare }: { group: string; shown: boolean; onShare: (group: string, on: boolean) => void }) {
  const g = GROUPS.find((x) => x.id === group)!;
  const names = DEFS.filter((d) => d.group === group).map((d) => d.title.toLowerCase()).join(', ');
  return (
    <section className="ach-sec" aria-label="Friends">
      <h3>Friends</h3>
      <div className="ach-share">
        <span className="ach-row-txt"><b>Shown to friends</b><span>{g.title}: {names}</span></span>
        <button type="button" role="switch" className="switch" aria-checked={shown} aria-label={`Show ${g.title} to friends`} onClick={() => onShare(group, !shown)} />
      </div>
      <p className="ach-foot">On their page and, silver and up, beside your session in their feed: the level and the day, never your numbers. Changes reach them within 15 minutes.</p>
    </section>
  );
}

/** A friend's achievement, said as on yours, not a button: their levels aren't yours to open. */
function ShownRow({ u, today }: { u: Unlock; today: string }) {
  return (
    <div className="ach-row" data-ach={u.id} data-lift={u.lift}>
      <Medal tier={u.tier} glyph={u.id} size={44} />
      <span className="ach-row-txt">
        <b>{DEF.get(u.id)!.title}</b>
        <span className={`ach-tier t-${u.tier}`}>{tierWord(u.tier)}</span>
        <span>{unlockText(u)}</span>
      </span>
      <span className="ach-when">{achDay(u.date, today)}</span>
    </div>
  );
}

/** A friend's achievements (their Compare summary): the highest of each, by group, the groups they show. */
export function FriendAchSheet({ us, today, who, at }: { us: readonly Unlock[]; today: string; who: string; /** Opened at a family (a chip tapped). */ at?: AchAt | null }) {
  const n = (t: Tier) => us.filter((u) => u.tier === t).length;
  const box = useAchFocus(at);
  return (
    <div className="ach" ref={box}>
      <ul className="ach-tiers" aria-label="Highest by tier">
        {TIERS.map((t) => <li key={t}><Medal tier={n(t) ? t : 'lock'} size={36} /><b>{n(t)}</b><span>{tierWord(t)}</span></li>)}
      </ul>
      {GROUPS.map((g) => {
        const mine = us.filter((u) => DEF.get(u.id)!.group === g.id);
        if (!mine.length) return null;
        return (
          <section key={g.id} className="ach-sec" aria-label={g.title}>
            <h3>{g.title}{g.note && <span>{g.note.replace('your', 'their')}</span>}</h3>
            {mine.map((u) => <ShownRow key={`${u.id}:${u.lift ?? ''}`} u={u} today={today} />)}
          </section>
        );
      })}
      <p className="ach-foot">The highest level of each, from the groups @{who} shows, counted from their own start. Their numbers stay on their phone.</p>
    </div>
  );
}

/** One achievement as a chip (a friend's feed card, their page): its medal and what it is; a tap opens it on their Achievements. */
export function AchChip({ u, onOpen }: { u: Unlock; onOpen?: (at: AchAt) => void }) {
  const chip = <span className="ach-chip"><Medal tier={u.tier} glyph={u.id} size={26} />{tierWord(u.tier)} · {DEF.get(u.id)!.title}{u.lift ? ` · ${u.lift}` : ''}</span>;
  return onOpen ? <button type="button" className="ach-chip-btn" onClick={() => onOpen({ id: u.id, lift: u.lift })}>{chip}</button> : chip;
}

/** A family's levels: the day each was reached, and how far to the next. */
function Levels({ d, t, unlocks, today }: { d: Def; t: Track; unlocks: Unlock[]; today: string }) {
  return (
    <ol className="ach-levels">
      {d.levels.map((lv, i) => {
        const u = unlocks.find((x) => x.level === i);
        return (
          <li key={lv.tier} className={u ? undefined : 'locked'}>
            <Medal tier={u ? lv.tier : 'lock'} glyph={d.id} size={36} />
            <span className="ach-row-txt">
              <b>{d.repeat ? (u ? `${t.value.toLocaleString('en-US')} ${t.value === 1 ? 'time' : 'times'}` : 'Not yet') : amount(d.id, lv.at)}</b>
              <span>{tierWord(lv.tier)}{!u && i === t.level + 1 && t.value > 0 && !d.repeat ? ` · ${amount(d.id, t.value)} so far` : ''}{d.repeat && u ? ` · first ${achDay(u.date, today)}` : ''}</span>
            </span>
            <span className="ach-when">{u ? achDay(u.date, today) : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** "With": each friend a Together family counted you with, most first (only on your phone). */
function WithList({ id, entries, today }: { id: TogetherId; entries: readonly SetEntry[]; today: string }) {
  const t = useTogetherSeen(entries, today);
  if (!t) return null;
  const rows = withList(t.seen, id);
  if (!rows.length) return null;
  const unit = id === 'same-week' || id === 'crew-streak' || id === 'full-house' ? ['week', 'weeks'] : id === 'crew-day' ? ['day', 'days'] : ['session', 'sessions'];
  return (
    <section className="ach-sec" aria-label="With">
      <h3>With<span>only you see this</span></h3>
      {rows.map((r) => {
        const name = t.together.names.name(r.uid);
        return (
          <div key={r.uid} className="ach-with">
            <span className="avatar" aria-hidden="true">{name.startsWith('@') ? initials(t.together.names.handle(r.uid)) : '?'}</span>
            <span className="ach-row-txt">
              <b>{name}</b>
              <span>{r.n} {unit[r.n === 1 ? 0 : 1]} · last {achDay(r.last, today).replace(/^T/, 't')}{r.gym ? `, ${r.gym}` : ''}</span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** Full house's week so far: you and each friend, a ring against each one's own goal, green once met. */
function HouseRings({ entries, today }: { entries: readonly SetEntry[]; today: string }) {
  const t = useTogetherSeen(entries, today);
  if (!t) return null;
  const rings = weekRings(entries, t.since, t.goal, t.together.ctx.friends, today);
  const met = rings.slice(1).filter((r) => r.met).length;
  return (
    <section className="ach-sec" aria-label="This week">
      <h3>This week<span>{rings[0].met ? `${met} ${met === 1 ? 'friend' : 'friends'} so far` : 'your goal first'}</span></h3>
      <ul className="ach-rings">
        {rings.map((r) => {
          const who = r.uid ? t.together.names.name(r.uid) : 'You';
          const f = Math.min(1, r.sessions / r.goal), c = 2 * Math.PI * 19;
          return (
            <li key={r.uid ?? ''} className={r.met ? 'met' : undefined}>
              <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="19" fill="none" stroke="var(--fill-2)" strokeWidth="4" />
                {f > 0 && <circle cx="24" cy="24" r="19" fill="none" stroke={r.met ? 'var(--ok)' : 'var(--text-2)'} strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 24 24)" />}
                <text x="24" y="28.5" textAnchor="middle">{r.uid ? (who.startsWith('@') ? initials(t.together.names.handle(r.uid)) : '?') : 'You'}</text>
              </svg>
              <span className="ach-ring-n">{r.sessions}/{r.goal}</span>
              <span className="sr-only">{who}: {r.sessions} of {r.goal}{r.met ? ', goal met' : ''}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AchievementDetail({ a, id, today, since, shown, onShare, entries }: {
  a: Achievements; id: string; today: string; since: string;
  /** Your log (Together's With list and rings; none: they're left out). */ entries?: readonly SetEntry[];
  /** Whether friends see this family's group, and how to change it (your own Stats only). */ shown?: boolean; onShare?: (group: string, on: boolean) => void;
}) {
  const d = DEF.get(id);
  if (!d) return null;
  const ts = tracksOf(a, d);
  const top = ts.reduce((m, t) => (t.level > m.level ? t : m), ts[0]);
  return (
    <div className="ach">
      <div className="ach-dh">
        <Medal tier={tierAt(top)} glyph={id} size={64} />
        <p>{d.how}.</p>
      </div>
      {d.perLift && ts[0].lift
        ? ts.map((t) => (
          <section key={t.lift} className="ach-sec" aria-label={t.lift}>
            <h3>{t.lift}</h3>
            <Levels d={d} t={t} unlocks={a.unlocks.filter((u) => u.id === id && u.lift === t.lift)} today={today} />
          </section>
        ))
        : (
          <section className="ach-sec" aria-label="Levels">
            <h3>Levels</h3>
            <Levels d={d} t={ts[0]} unlocks={a.unlocks.filter((u) => u.id === id)} today={today} />
          </section>
        )}
      {d.group === 'together' && entries && id === 'full-house' && <HouseRings entries={entries} today={today} />}
      {d.group === 'together' && entries && <WithList id={id as TogetherId} entries={entries} today={today} />}
      {onShare && !isPrivate(d.group) && <ShareRow group={d.group} shown={shown !== false} onShare={onShare} />}
      {d.group === 'together' ? <TogetherFoot /> : d.group === 'body' ? <BodyFoot id={id} since={since} today={today} /> : <Foot since={since} today={today} />}
    </div>
  );
}
