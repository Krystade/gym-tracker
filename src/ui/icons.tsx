import type { ReactNode } from 'react';

// Original line icons on a 24px grid, stroked in currentColor at 1.75. Drawn for this app; no third-party set.
// Decorative: every button that shows one keeps its own label or aria-label.
const P = {
  today: <><rect x="3.75" y="5" width="16.5" height="15.25" rx="3.25" /><path d="M3.75 10h16.5M8 3v4M16 3v4" /><circle cx="12" cy="15.25" r="1.5" fill="currentColor" stroke="none" /></>,
  'today-on': <><path d="M7 5h10a3.25 3.25 0 0 1 3.25 3.25V17A3.25 3.25 0 0 1 17 20.25H7A3.25 3.25 0 0 1 3.75 17V8.25A3.25 3.25 0 0 1 7 5z" fill="currentColor" /><path d="M3.75 10h16.5" style={{ stroke: 'var(--tab-bg)' }} /><path d="M8 3v4M16 3v4" /><circle cx="12" cy="15.25" r="1.6" style={{ fill: 'var(--tab-bg)' }} stroke="none" /></>,
  history: <><path d="M4.2 13.5A8 8 0 1 0 6.1 6.6" /><path d="M5.5 3.5v3.6h3.6" /><path d="M12 8v4.25l2.75 1.75" /></>,
  lifts: <><rect x="4.25" y="7" width="3.5" height="10" rx="1.25" /><rect x="16.25" y="7" width="3.5" height="10" rx="1.25" /><path d="M7.75 12h8.5M2.25 10v4M21.75 10v4" /></>,
  'lifts-on': <><rect x="4.25" y="7" width="3.5" height="10" rx="1.25" fill="currentColor" /><rect x="16.25" y="7" width="3.5" height="10" rx="1.25" fill="currentColor" /><path d="M7.75 12h8.5M2.25 10v4M21.75 10v4" /></>,
  stats: <><path d="M3.5 20h17" /><rect x="5.25" y="11" width="3.25" height="6.25" rx="1" /><rect x="10.4" y="5.75" width="3.25" height="11.5" rx="1" /><rect x="15.5" y="13.25" width="3.25" height="4" rx="1" /></>,
  'stats-on': <><path d="M3.5 20h17" /><rect x="5.25" y="11" width="3.25" height="6.25" rx="1" fill="currentColor" /><rect x="10.4" y="5.75" width="3.25" height="11.5" rx="1" fill="currentColor" /><rect x="15.5" y="13.25" width="3.25" height="4" rx="1" fill="currentColor" /></>,
  friends: <><circle cx="9" cy="8.25" r="3.25" /><path d="M3 19.25c.55-3.4 2.9-5.25 6-5.25s5.45 1.85 6 5.25" /><circle cx="16.75" cy="9.25" r="2.5" /><path d="M16.4 14.1c2.45-.1 4.2 1.55 4.65 4.4" /></>,
  'friends-on': <><circle cx="9" cy="8.25" r="3.4" fill="currentColor" /><path d="M3 19.25c.55-3.4 2.9-5.25 6-5.25s5.45 1.85 6 5.25z" fill="currentColor" /><circle cx="16.75" cy="9.25" r="2.6" fill="currentColor" /><path d="M16.4 14.1c2.45-.1 4.2 1.55 4.65 4.4h-3.6" fill="currentColor" /></>,
  // Buddies: a paw, its toes and pad drawn, then filled.
  buddies: <><ellipse cx="6.4" cy="10.3" rx="1.7" ry="2.2" /><ellipse cx="10" cy="6.3" rx="1.7" ry="2.2" /><ellipse cx="14" cy="6.3" rx="1.7" ry="2.2" /><ellipse cx="17.6" cy="10.3" rx="1.7" ry="2.2" /><path d="M12 12.25c-2.75 0-5.5 3.3-5.5 5.7 0 1.45 1.2 2.05 2.55 2.05 1.1 0 1.95-.55 2.95-.55s1.85.55 2.95.55c1.35 0 2.55-.6 2.55-2.05 0-2.4-2.75-5.7-5.5-5.7z" /></>,
  'buddies-on': <g fill="currentColor" stroke="none"><ellipse cx="6.5" cy="10" rx="2" ry="2.6" /><ellipse cx="10" cy="6.2" rx="2" ry="2.6" /><ellipse cx="14" cy="6.2" rx="2" ry="2.6" /><ellipse cx="17.5" cy="10" rx="2" ry="2.6" /><path d="M12 11.5c-3 0-6 3.6-6 6.2 0 1.6 1.3 2.3 2.8 2.3 1.2 0 2.1-.6 3.2-.6s2 .6 3.2.6c1.5 0 2.8-.7 2.8-2.3 0-2.6-3-6.2-6-6.2z" /></g>,
  more: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  'history-on': <><path d="M4.2 13.5A8 8 0 1 0 6.1 6.6" strokeWidth="2.25" /><path d="M5.5 3.5v3.6h3.6" strokeWidth="2.25" /><path d="M12 8v4.25l2.75 1.75" strokeWidth="2.25" /></>,
  'chev-left': <path d="M14.5 5.5 8 12l6.5 6.5" />,
  'chev-right': <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  'chev-down': <path d="M6 9.5l6 6 6-6" />,
  bell: <><path d="M6.25 16.25V11a5.75 5.75 0 0 1 11.5 0v5.25l1.5 2.25H4.75z" /><path d="M10 20.75a2.25 2.25 0 0 0 4 0" /></>,
  'bell-off': <><path d="M8.2 5.9A5.75 5.75 0 0 1 17.75 11v4.4M6.25 9.9v6.35L4.75 18.5h11.5" /><path d="M10 20.75a2.25 2.25 0 0 0 4 0" /><path d="M4 4l16 16" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  help: <><circle cx="12" cy="12" r="8.25" /><path d="M9.6 9.6a2.45 2.45 0 1 1 3.55 2.2c-.75.38-1.15.9-1.15 1.7v.3" /><circle cx="12" cy="16.6" r="1.05" fill="currentColor" stroke="none" /></>,
  message: <path d="M4.25 7A2.75 2.75 0 0 1 7 4.25h10A2.75 2.75 0 0 1 19.75 7v7A2.75 2.75 0 0 1 17 16.75h-6.25L6.5 20v-3.25A2.75 2.75 0 0 1 4.25 14z" />,
  send: <path d="M12 18.5V6.5M6.75 11.5 12 6.25l5.25 5.25" />,
  'person-plus': <><circle cx="10" cy="8.25" r="3.25" /><path d="M4 19.25c.55-3.4 2.9-5.25 6-5.25 1.4 0 2.65.38 3.65 1.1" /><path d="M18.25 13.25v6.5M15 16.5h6.5" /></>,
  check: <path d="M5.5 12.5l4.25 4.25L18.5 8" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.25" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  pencil: <><path d="M5 19l1.1-4.1L15.6 5.4a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L9.1 17.9z" /><path d="M13.75 7.25l3 3" /></>,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  timer: <><circle cx="12" cy="13.25" r="7.25" /><path d="M12 9.5v3.75l2.5 1.5M9.75 2.75h4.5" /></>,
  switch: <><path d="M4.75 8.75h14.5M15.75 5.25l3.5 3.5-3.5 3.5" /><path d="M19.25 15.25H4.75M8.25 11.75l-3.5 3.5 3.5 3.5" /></>,
  // A week's goal met, a PR: the cup on its stem and foot.
  trophy: <><path d="M7.5 4.25h9v4.5a4.5 4.5 0 0 1-9 0z" /><path d="M7.5 6H4.75v1.25A3 3 0 0 0 7.6 10.2M16.5 6h2.75v1.25a3 3 0 0 1-2.85 2.95" /><path d="M12 13.25v3.5M8.5 20h7l-.75-3.25h-5.5z" /></>,
  // A streak.
  flame: <path d="M12 21c3.6 0 6-2.5 6-5.9 0-3.3-2.2-5.1-3.4-7.6-.5 1.6-1.4 2.6-2.4 3.1C12.6 7.4 11 4.6 8.6 3c.3 2.9-1 4.8-2.2 6.6C5.4 11.1 6 12.9 6 15.1 6 18.5 8.4 21 12 21z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof P;

/** Initials for a round avatar: the first letters of the first two words of a name or username, else its first two letters. */
export function initials(name: string): string {
  const words = name.replace(/^@/, '').split(/[\s_.-]+/).filter(Boolean);
  const s = words.length > 1 ? words.slice(0, 2).map((w) => [...w][0]).join('') : [...(words[0] ?? '')].slice(0, 2).join('');
  return s.toUpperCase() || '?';
}

export function Icon({ name, size = 24, sw = 1.75, className }: { name: IconName; size?: number; sw?: number; className?: string }) {
  return (
    <svg className={className ? `ic ${className}` : 'ic'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{P[name]}</svg>
  );
}
