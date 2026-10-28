import type { SVGProps } from 'react';

const PATHS: Record<string, React.ReactNode> = {
  external: <><path d="M14 4h6v6M20 4l-9 9M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>,
  github: <><path d="M9 19c-4 1.2-4-2-5-2m10 4v-3.2c0-1 .1-1.5-.5-2 3-.3 6-1.5 6-5.5a4.3 4.3 0 0 0-1.2-3c.1-.7.5-2-.2-3.3 0 0-1-.3-3.2 1.2a11 11 0 0 0-5.8 0C6.9 3.7 5.9 4 5.9 4c-.7 1.3-.3 2.6-.2 3.3a4.3 4.3 0 0 0-1.2 3c0 4 3 5.2 6 5.5-.5.4-.5 1.1-.5 2V21" /></>,
  usage: <><path d="M4 20h16M6 16v-4M12 16V5M18 16V9" /></>,
  plug: <><path d="m8 3 3 3M16 3l-3 3M8 6h8v5a4 4 0 0 1-8 0V6ZM12 15v3a3 3 0 0 1-3 3H6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" /></>,
  back: <path d="m11 5-7 7 7 7M4 12h16" />,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1.4" /><rect x="14" y="4" width="6" height="6" rx="1.4" /><rect x="4" y="14" width="6" height="6" rx="1.4" /><path d="M17 14v6M14 17h6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9 4.5v15" /></>,
  pin: <><path d="m15 3 6 6-3 1-4 4-1 4-7-7 4-1 4-4 1-3ZM4 20l5-5" /></>,
  unread: <><path d="M18 12v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h7M7 19l-3 3" /><circle cx="19" cy="5" r="3" /></>,
  hide: <><path d="m3 3 18 18M10.5 5.2 12 5c5.5 0 9 7 9 7a18 18 0 0 1-3.3 4.3M6.3 6.3A19 19 0 0 0 3 12s3.5 7 9 7a9 9 0 0 0 4.2-1.2M10 10a3 3 0 0 0 4 4" /></>,
  sliders: <><path d="M5 7h14M5 17h14" /><circle cx="9" cy="7" r="2" fill="var(--surface)" /><circle cx="15" cy="17" r="2" fill="var(--surface)" /></>,
  edit: <><path d="m15 4 5 5-10.5 10.5-6 1 1-6L15 4Z" /><path d="m12 7 5 5" /></>,
  chat: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.1c-.5.4-.8.1-.8-.4V6.5Z" />
      <path d="M8.5 9h7M8.5 12h4.5" />
    </>
  ),
  bots: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="4" />
      <path d="M12 4v3M9.5 13h.01M14.5 13h.01M9 17h6" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.7 4.2 4.2 0 0 0 7 18Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l2.8 1.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.3a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M5 12 20 4l-4.5 16-3.6-6.2L5 12Z" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.8 17.5 4.4-4.4a2 2 0 0 1 2.8 0L20 20.5" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2.6" />,
  power: <path d="M12 4v7M7.5 7a7 7 0 1 0 9 0" />,
  moon: <path d="M20 14.5A8.3 8.3 0 0 1 9.5 4 8.3 8.3 0 1 0 20 14.5Z" />,
  spark: (
    <>
      <path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16l-1.7-4.5L5.7 9.8l4.6-1.7L12 3.5Z" />
      <path d="M18.5 15.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.9.8-2.1Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9" />
      <path d="M20 4.5V9h-4.5" />
      <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15" />
      <path d="M4 19.5V15h4.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6 7l.9 12.1A1.9 1.9 0 0 0 8.8 21h6.4a1.9 1.9 0 0 0 1.9-1.9L18 7" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="m7 10 2.6 2L7 14M12.5 14h4" />
    </>
  ),
  memory: (
    <>
      <path d="M9 5.5a3 3 0 0 1 6 0V7h1.5A2.5 2.5 0 0 1 19 9.5V11a3 3 0 0 1 0 6v1.5a2.5 2.5 0 0 1-2.5 2.5H15v-1.5a3 3 0 0 0-6 0V21H7.5A2.5 2.5 0 0 1 5 18.5V17a3 3 0 0 1 0-6V9.5A2.5 2.5 0 0 1 7.5 7H9V5.5Z" />
    </>
  ),
  shield: <path d="M12 3.5 19 6v6c0 4.2-3 7-7 8.5C8 19 5 16.2 5 12V6l7-2.5Z" />,
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H21M17.5 12v3M14.5 12v2" />
    </>
  ),
  folder: <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h3l2 2.5h6.5A2.5 2.5 0 0 1 20 11v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17v-8.5Z" />,
  alert: (
    <>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="2" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  reply: <path d="m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7v1" />,
  copy: (
    <>
      <rect x="9" y="9" width="10" height="10" rx="2.4" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8M12 3.6c2.4 2.4 3.6 5.3 3.6 8.4S14.4 18 12 20.4C9.6 18 8.4 15.1 8.4 12S9.6 6 12 3.6Z" />
    </>
  ),
  play: <path d="M9 6.5 18 12l-9 5.5v-11Z" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
