import { addDays, weekStart } from './analytics';
import { normalizeName } from './ids';
import type { Tier } from './profile';
import { sameExercise } from './stats';
import type { CardioData, SetEntry } from './types';

// Cardio machines: one entry per bout, timed, with the numbers the machine shows. Generic names only.

export type CardioField = 'miles' | 'incline' | 'level' | 'floors';
export interface Machine { name: string; equipment: 'treadmill' | 'stair climber' | 'exercise bike' | 'elliptical'; fields: CardioField[]; /** Incline below 0 means decline (treadmill only). */ decline?: boolean }

/** In the order the builder prefers them when there's no history. */
export const MACHINES: Machine[] = [
  { name: 'Treadmill', equipment: 'treadmill', fields: ['miles', 'incline'], decline: true },
  { name: 'Elliptical', equipment: 'elliptical', fields: ['miles', 'level', 'incline'] },
  { name: 'Exercise Bike', equipment: 'exercise bike', fields: ['miles', 'level'] },
  { name: 'StairMaster', equipment: 'stair climber', fields: ['level', 'floors'] },
];
export const CARDIO_NAMES = MACHINES.map((m) => m.name);

const key = (s: string) => normalizeName(s).toLowerCase();
const BY_KEY = new Map(MACHINES.map((m) => [key(m.name), m]));
export const machine = (name: string): Machine | null => BY_KEY.get(key(name)) ?? null;
export const isCardio = (name: string): boolean => BY_KEY.has(key(name));
// What people write for each machine.
const ALIASES: Record<string, string> = {
  'stair master': 'StairMaster', stairs: 'StairMaster', 'stair climber': 'StairMaster', stepmill: 'StairMaster',
  bike: 'Exercise Bike', 'stationary bike': 'Exercise Bike', 'spin bike': 'Exercise Bike', cycling: 'Exercise Bike', cycle: 'Exercise Bike', 'recumbent bike': 'Exercise Bike',
  'elliptical trainer': 'Elliptical', 'cross trainer': 'Elliptical', tread: 'Treadmill', 'treadmill walk': 'Treadmill', 'treadmill run': 'Treadmill', 'incline walk': 'Treadmill',
};
/** The machine a written name means ("Stair master", "bike"), or null. */
export const machineFor = (name: string): string | null => machine(name)?.name ?? ALIASES[key(name)] ?? null;

/**
 * Cardio numbers from free text: "20 min", "20:00", "1.2 mi", "5%", "-2%", "L8" / "level 8", "52 floors", in any order.
 * Whatever's left is the note. Null without a time.
 */
export function readCardio(text: string): { cardio: CardioData; note?: string } | null {
  let rest = ` ${text} `;
  const take = (re: RegExp): RegExpExecArray | null => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], ' '); return m; };
  let seconds = 0;
  const clock = take(/(?<![\d.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d%])/);
  if (clock) seconds = clock[3] != null ? (+clock[1] * 3600 + +clock[2] * 60 + +clock[3]) : (+clock[1] * 60 + +clock[2]);
  else { const mins = take(/(?<![\w.])(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|m)(?![a-z])/i); if (mins) seconds = Math.round(+mins[1] * 60); }
  if (seconds <= 0) return null;
  const c: CardioData = { seconds };
  const mi = take(/(?<![\w.])(\d+(?:\.\d+)?)\s*(?:mi|miles?)(?![a-z])/i); if (mi) c.miles = +mi[1];
  const inc = take(/(?<![\w.])([-−]?\d+(?:\.\d+)?)\s*%/); if (inc) c.incline = +inc[1].replace('−', '-');
  const lvl = take(/(?<![a-z])(?:l|lvl|level)\s*(\d+)(?![\d.])/i); if (lvl) c.level = +lvl[1];
  const fl = take(/(?<![\w.])(\d+)\s*(?:floors?|flights?)(?![a-z])/i); if (fl) c.floors = +fl[1];
  const note = rest.replace(/\s+/g, ' ').replace(/^[\s,;·@-]+|[\s,;·@-]+$/g, '');
  return { cardio: c, ...(note && { note }) };
}

export const isCardioEntry = (e: SetEntry): boolean => e.flags.includes('cardio') || !!e.cardio;

/** Weekly minutes for each cardio priority. Fixed, unlike the fitted muscle targets. */
export const CARDIO_TARGETS: Record<Tier, [number, number]> = { 1: [60, 90], 2: [40, 60], 3: [20, 40], 4: [0, 20] };
/** No priority set means 4: no cardio is planned until it's raised. */
export const cardioTierOf = (p: { cardioTier?: Tier }): Tier => p.cardioTier ?? 4;

export const fmtClock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const trim = (n: number) => String(Math.round(n * 100) / 100);
/** "20:00 · 1.25 mi · 3%", "15:00 · L8 · 52 floors"; decline reads as a minus. */
export function fmtCardio(c: CardioData): string {
  return [fmtClock(c.seconds),
    c.miles != null && `${trim(c.miles)} mi`,
    c.incline != null && `${c.incline < 0 ? '−' : ''}${trim(Math.abs(c.incline))}%`,
    c.level != null && `L${trim(c.level)}`,
    c.floors != null && `${trim(c.floors)} floors`,
  ].filter(Boolean).join(' · ');
}

/** What a session is measured by: distance, or floors on the StairMaster. */
const amount = (m: Machine, c: CardioData): number | undefined => (m.fields.includes('miles') ? c.miles : c.floors);
const unitOf = (m: Machine) => (m.fields.includes('miles') ? 'mi' : 'floors');

export interface CardioTarget {
  minutes: number;
  /** Distance (mi) or floors to aim for; null with no usable history (an easy start). */
  aim: number | null; unit: 'mi' | 'floors';
  /** Prefill for the form: the last session's settings, or an easy start. */
  incline?: number; level?: number;
  text: string;
}

const EASY = { minutes: 10, incline: 0, level: 4 };
export const BUMP = 1.02;

/**
 * More distance in the same time: the last session with a distance (floors on the StairMaster) gives a pace; the aim is
 * that pace over `minutes`, 2% higher when the last session met its own aim. Incline and level are carried, not pushed.
 */
export function cardioTarget(entries: SetEntry[], name: string, minutes: number | null, date: string): CardioTarget {
  const m = machine(name);
  const unit = m ? unitOf(m) : 'mi';
  const past = entries.filter((e) => e.cardio && e.date < date && sameExercise(e.exercise, name)).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const last = past[0]?.cardio;
  const measured = m ? past.find((e) => e.cardio!.seconds > 0 && amount(m, e.cardio!) != null) : undefined;
  const settings = { ...(last?.incline != null && m?.fields.includes('incline') && { incline: last.incline }), ...(last?.level != null && m?.fields.includes('level') && { level: last.level }) };
  if (!m || !measured) {
    const mins = Math.max(EASY.minutes, minutes ?? 0);
    return { minutes: mins, aim: null, unit, ...(m?.fields.includes('incline') && { incline: EASY.incline }), ...(m?.fields.includes('level') && { level: EASY.level }), ...settings, text: `Easy start · ${mins} min` };
  }
  const c = measured.cardio!;
  const mins = minutes ?? Math.round(c.seconds / 60);
  const pace = amount(m, c)! / (c.seconds / 60);
  const met = c.aim == null || amount(m, c)! >= c.aim;
  const raw = pace * mins * (met ? BUMP : 1);
  const aim = unit === 'mi' ? Math.ceil(raw * 100) / 100 : Math.ceil(raw);
  return { minutes: mins, aim, unit, ...settings, text: `${mins} min · aim ${trim(aim)} ${unit}` };
}

/** Cardio minutes done in the week starting `week`. */
export function weeklyCardioMinutes(entries: SetEntry[], week: string): number {
  const end = addDays(week, 7);
  return Math.round(entries.reduce((a, e) => a + (e.cardio && e.date >= week && e.date < end ? e.cardio.seconds : 0), 0) / 60);
}
export const thisWeekCardio = (entries: SetEntry[], today: string) => weeklyCardioMinutes(entries, weekStart(today));

/** The machine to plan: the one this gym has that was used most in the last 90 days, else the first it has. Null: none here. */
export function pickMachine(entries: SetEntry[], today: string, has: (name: string) => boolean): string | null {
  const since = addDays(today, -90);
  const use = new Map<string, number>();
  for (const e of entries) if (e.cardio && e.date >= since && has(e.exercise)) { const n = machine(e.exercise)?.name; if (n) use.set(n, (use.get(n) ?? 0) + e.cardio.seconds); }
  const used = [...use].sort((a, b) => b[1] - a[1])[0]?.[0];
  return used ?? CARDIO_NAMES.find(has) ?? null;
}

const round5 = (n: number) => Math.round(n / 5) * 5;
/** Weekly minutes split into slots: at most one a day, about 25 minutes each, never under 10. */
export function cardioSlots(goal: number, days: number): number[] {
  if (goal <= 0 || days <= 0) return [];
  const n = Math.min(days, Math.ceil(goal / 25));
  return Array(n).fill(Math.max(10, round5(goal / n)));
}
