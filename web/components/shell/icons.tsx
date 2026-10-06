// Line icons (24px grid, 1.6 stroke, colour follows the text).
import type { ReactNode } from "react";

const P = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const icons = {
  overview: <P><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5" rx="2" /><rect x="13.5" y="11" width="7.5" height="10" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></P>,
  trials: <P><path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" /><path d="M7 15h10" /></P>,
  drugs: <P><rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="m9.2 7.9 5.6 8.2" /></P>,
  changes: <P><path d="M3 12h4l2-6 4 12 2-6h6" /></P>,
  quality: <P><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.6 7.5 9.5 4.3-.9 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m8.8 12 2.2 2.2 4.4-4.4" /></P>,
  admin: <P><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></P>,
  search: <P><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></P>,
  menu: <P><path d="M4 6h16M4 12h16M4 18h16" /></P>,
  close: <P><path d="M18 6 6 18M6 6l12 12" /></P>,
  chevronLeft: <P><path d="m15 18-6-6 6-6" /></P>,
  chevronRight: <P><path d="m9 18 6-6-6-6" /></P>,
  arrowRight: <P><path d="M5 12h14M13 6l6 6-6 6" /></P>,
  external: <P><path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></P>,
  copy: <P><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></P>,
  link: <P><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></P>,
  filter: <P><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></P>,
  building: <P><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4" /></P>,
  globe: <P><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></P>,
  users: <P><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></P>,
  calendar: <P><rect x="3" y="4.5" width="18" height="17" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></P>,
  rocket: <P><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 10l-4 4M9 15l-2-2 3.5-6.5C12.5 3 17 3 21 3c0 4 0 8.5-3.5 10.5L11 17l-2-2Z" /></P>,
  pulse: <P><path d="M3 12h4l2-6 4 12 2-6h6" /></P>,
  sparkles: <P><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" /></P>,
  grid: <P><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></P>,
  list: <P><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></P>,
  logout: <P><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></P>,
  sort: <P><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" /></P>,
  clock: <P><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></P>,
  plus: <P><path d="M12 5v14M5 12h14" /></P>,
  history: <P><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></P>,
};

export type IconName = keyof typeof icons;
