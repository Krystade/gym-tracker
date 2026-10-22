import type { ReactNode } from 'react';
import type { Tier } from '../domain/achievements';

// An achievement's medal (plan §6, mockups/ach.js): a disc in its tier's colours with the family's glyph. Every colour is opaque:
// the inner ring is the rim mixed into the fill in OKLab (35%), not a translucent stroke, so it never averages to mud on a tile.
// Tiers are told apart by lightness as well as hue (bronze L .68, silver .83 but neutral, gold .84, platinum .86 cyan, starter
// .62 grey), and the tier is always said in words beside it. Not reached yet: a dashed grey ring.

export type MedalTier = Tier | 'lock';
export const TIER_COLOUR: Record<MedalTier, { rim: string; fill: string; ink: string; ring: string }> = {
  starter: { rim: '#8a93a3', fill: '#272b33', ink: '#c7ccd6', ring: '#474d58' },
  bronze: { rim: '#d18c55', fill: '#3a2617', ink: '#f2b98a', ring: '#6b472b' },
  silver: { rim: '#c9d0da', fill: '#2c3138', ink: '#eef1f5', ring: '#5e646c' },
  gold: { rim: '#f3cf4b', fill: '#3a300b', ink: '#ffe48f', ring: '#756320' },
  platinum: { rim: '#9fe6ea', fill: '#123338', ink: '#d3f7f9', ring: '#3f6c71' },
  lock: { rim: '#4a4d54', fill: '#1b1c1f', ink: '#6d717a', ring: '#1b1c1f' },
};

/** 24×24 stroke glyphs, one per family. */
const GLYPH: Record<string, ReactNode> = {
  'sessions': <><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5M9 14.5l2 2 4-4" /></>,
  'goal-weeks': <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r=".8" fill="currentColor" /></>,
  'best-run': <path d="M12 3.5c1.2 3 4.8 4.8 4.8 9a4.8 4.8 0 0 1-9.6 0c0-2 1-3.3 2.2-4.3.2 1.6 1 2.6 2 3 0-2.7.2-5 .6-7.7z" />,
  'comeback': <><path d="M5 12a7 7 0 1 0 2.1-5M5 4.5V8h3.5" /><path d="M12 9v3.5l2.3 1.5" /></>,
  'plan-days': <><rect x="5.5" y="4.5" width="13" height="16" rx="2" /><path d="M9 4.5V3h6v1.5M9 12.5l2 2 4-4" /></>,
  'light-week': <path d="M16.5 14.5A6.5 6.5 0 0 1 9.5 4a7 7 0 1 0 7 10.5z" />,
  'prs': <path d="M8 4.5h8v4a4 4 0 0 1-8 0zM8 6H5.5a2.5 2.5 0 0 0 2.8 3M16 6h2.5a2.5 2.5 0 0 1-2.8 3M12 12.5v3.5M9 19.5h6M10 16h4v3.5h-4z" />,
  'stronger': <path d="M4 17l5-5 3.5 3L20 7.5M15 7.5h5v5" />,
  'moved-up': <path d="M7 13l5-5 5 5M7 18l5-5 5 5" />,
  'on-target': <><circle cx="12" cy="12" r="8" /><path d="M12 4v3M12 17v3M4 12h3M17 12h3" /><circle cx="12" cy="12" r="2.2" /></>,
  'every-muscle': <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  'useful-sets': <path d="M6 19V11M10 19V7M14 19V9M18 19V5M4 19h16" />,
  'plates': <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1.3" /></>,
  'bodyweight': <><path d="M3.5 5h17M8 5v3M16 5v3" /><circle cx="12" cy="10" r="2" /><path d="M8 8.5l4 4 4-4M12 12.5v4.5M9.5 21l2.5-4 2.5 4" /></>,
  'new-lifts': <><circle cx="12" cy="12" r="8" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  'patterns': <><path d="M12 3.5l7.4 4.2v8.6L12 20.5l-7.4-4.2V7.7z" /><path d="M12 3.5v17M4.6 7.7l14.8 8.6M19.4 7.7L4.6 16.3" /></>,
  'cardio': <path d="M3.5 12h4l2-4 3 8 2.2-5 1.3 1H20.5" />,
};

/** A medal, `size` px square. No glyph: a plain coin (the sheet's tier counts). Decorative: its tier is said beside it. */
export function Medal({ tier, glyph, size = 44 }: { tier: MedalTier; glyph?: string; size?: number }) {
  const c = TIER_COLOUR[tier], lock = tier === 'lock';
  return (
    <svg className="medal" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-tier={tier}>
      <circle cx="24" cy="24" r="21.5" fill={c.fill} stroke={c.rim} strokeWidth="3" strokeDasharray={lock ? '4 3.2' : undefined} />
      {!lock && <circle cx="24" cy="24" r="17" fill="none" stroke={c.ring} strokeWidth="1.25" />}
      {glyph && GLYPH[glyph] && (
        <g transform="translate(12 12)" fill="none" stroke={c.ink} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" color={c.ink}>{GLYPH[glyph]}</g>
      )}
    </svg>
  );
}
