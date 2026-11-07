/**
 * A few line icons for navigation (inline SVG: no icon library, nothing to download).
 * Decorative: always next to a text label.
 */
import type { ReactElement } from "react";

const paths: Record<string, ReactElement> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  students: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .8 3.2 2.5 3.6 5.2" />
    </>
  ),
  fees: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M6 9.5v6M18 9.5v6" />
    </>
  ),
  leaveouts: (
    <>
      <path d="M14 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  gate: (
    <>
      <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3" />
      <path d="M7 12h10" />
    </>
  ),
  messages: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
  staff: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7.5 18c.7-2.2 2.4-3.5 4.5-3.5s3.8 1.3 4.5 3.5" />
    </>
  ),
  setup: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  notices: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  schools: (
    <>
      <path d="M3 21h18M5 21V10l7-5 7 5v11" />
      <path d="M10 21v-5h4v5" />
    </>
  ),
  attendance: (
    <>
      <rect x="5" y="3.5" width="14" height="18" rx="2" />
      <path d="M9 3.5h6v3H9z" />
      <path d="M8.5 13l2.5 2.5 4.5-5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8" cy="11" r="2.2" />
      <path d="M4.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14 10h4.5M14 13.5h3" />
    </>
  ),
  stores: (
    <>
      <path d="M3 8.5 12 4l9 4.5v10.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M7.5 20v-6h9v6M7.5 17h9" />
    </>
  ),
  kitchen: (
    <>
      <path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" />
      <path d="M2 11h2M20 11h2M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {paths[name]}
    </svg>
  );
}
