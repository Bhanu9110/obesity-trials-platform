"use client";

import { useId } from "react";

/** Brand mark: a hexagonal "molecule" with an orbit, in the cyan → violet gradient. */
export function LogoMark({ size = 36 }: { size?: number }) {
  // Each copy needs its own gradient id: a copy inside a hidden sidebar would otherwise blank the others.
  const id = `otg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67E8F9" />
          <stop offset="0.55" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#F472B6" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#0B1226" stroke={`url(#${id})`} strokeOpacity="0.55" />
      <path d="M20 8.5 30 14.25v11.5L20 31.5 10 25.75v-11.5L20 8.5Z" stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" />
      <ellipse cx="20" cy="20" rx="13.5" ry="5.2" transform="rotate(-28 20 20)" stroke={`url(#${id})`} strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="20" cy="20" r="3.2" fill={`url(#${id})`} />
      <circle cx="30" cy="14.25" r="1.7" fill="#67E8F9" />
      <circle cx="10" cy="25.75" r="1.7" fill="#A78BFA" />
    </svg>
  );
}
