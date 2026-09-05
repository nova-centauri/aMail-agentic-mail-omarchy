import { useId } from 'react';

export function Icon({ name, size = 20, className = '' }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    inbox: <><path d="M4.5 5.5h15v12h-15z" /><path d="M4.5 13h4l1.5 2h4l1.5-2h4" /></>,
    star: <><path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6-4.3-4.2 6-.9z" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.4 2" /></>,
    send: <><path d="m3.8 4.5 16.4 7.1-16.4 7.9 2.4-6.2 6.1-1.7-6.1-1.6z" /></>,
    draft: <><path d="M5.5 4.5h9l4 4v11h-13z" /><path d="M14.5 4.5v4h4M8 13h8M8 16h5" /></>,
    tag: <><path d="M3.5 12V5.5h6.5l8.5 8.5-6 6z" /><circle cx="7.7" cy="8.2" r="1" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    logout: <><path d="M15 8V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h6.6A2.2 2.2 0 0 0 15 17.8V16" /><path d="M10 12h10" /><path d="m16 8 4 4-4 4" /></>,
    help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9a2.6 2.6 0 1 1 4.6 1.7c-1.1 1.2-2.1 1.5-2.1 3.1M12 16.9v.1" /></>,
    apps: <><circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="6" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" /><circle cx="18" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9M3 4.5V9h4.5M4 13a8 8 0 0 0 14.8 4.2L21 15M21 19.5V15h-4.5" /></>,
    more: <><circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none" /></>,
    archive: <><path d="M4 7h16v12H4zM3 4h18v3H3z" /><path d="M9 12h6" /></>,
    trash: <><path d="M5 7h14l-1 13H6zM9 7V4h6v3M3.5 7h17" /><path d="M10 11v5M14 11v5" /></>,
    spam: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 8v5M12 16v.1" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m4 7 8 6 8-6" /></>,
    unread: <><path d="M4 6h16v12H4z" /><path d="m4.5 7 7.5 5.6L19.5 7" /></>,
    back: <><path d="m14.5 5-7 7 7 7M8 12h11" /></>,
    forward: <><path d="m9.5 5 7 7-7 7M16 12H5" /></>,
    reply: <><path d="m9.5 6-6 6 6 6v-4h4.3c2.6 0 4.6 1 6.2 3.3-.3-4.9-3-7.3-7.2-7.3H9.5z" /></>,
    chevronDown: <><path d="m7 9 5 5 5-5" /></>,
    chevronRight: <><path d="m9 6 6 6-6 6" /></>,
    move: <><path d="M4 6h6l2 2h8v10H4z" /><path d="m12 11 3 3-3 3M15 14H8" /></>,
    snooze: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2M9 3h6" /></>,
    link: <><path d="M10.3 13.7a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1M13.7 10.3a4 4 0 0 0-5.7 0l-2 2A4 4 0 0 0 11.7 18l1.1-1.1" /></>,
    attachment: <><path d="m8.5 12.5 5.4-5.4a2.8 2.8 0 0 1 4 4l-7.5 7.5a4.6 4.6 0 0 1-6.5-6.5l7.2-7.2" /></>,
    compose: <><path d="M4 19.5 5.4 15 15.8 4.6a2.1 2.1 0 0 1 3 3L8.4 18zM13.8 6.6l3 3" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /></>,
    minimize: <><path d="M6 12h12" /></>,
    check: <><path d="m5 12 4.2 4.2L19 6.5" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6z" /><path d="m8.7 12 2.2 2.2 4.5-4.5" /></>,
    eyeOff: <><path d="M3 3l18 18M10.6 6.2A10 10 0 0 1 12 6c4.7 0 8.3 3.3 9.5 6- .5 1.1-1.4 2.3-2.7 3.4M6.4 6.5C4.4 7.8 3 9.8 2.5 12c1.2 2.7 4.8 6 9.5 6 1.4 0 2.7-.3 3.8-.8M9.7 9.8A3 3 0 0 0 14.2 14" /></>,
    tune: <><path d="M4 7h10M17 7h3M4 12h3M10 12h10M4 17h11M18 17h2" /><circle cx="15" cy="7" r="2" fill="var(--surface)" /><circle cx="8" cy="12" r="2" fill="var(--surface)" /><circle cx="16" cy="17" r="2" fill="var(--surface)" /></>,
    person: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" /></>,
    branch: <><circle cx="7" cy="5" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="7" cy="19" r="2" /><path d="M7 7v10M9 12h2c3.3 0 6-1.3 6-3" /></>,
    terminal: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
    activity: <><path d="M3 12h4l2.1-6 4.2 12 2.2-6H21" /></>,
    alert: <><path d="M12 4 3 19h18z" /><path d="M12 10v4M12 16.5v.5" /></>,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM6.5 14l.8 2.2 2.2.8-2.2.8L6.5 20l-.8-2.2-2.2-.8 2.2-.8zM18.5 13l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.6-.6 1.6-.6z" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2.5" /></>,
    eye: <><path d="M2.5 12c1.3-2.8 4.8-6 9.5-6s8.2 3.2 9.5 6c-1.3 2.8-4.8 6-9.5 6S3.8 14.8 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
    key: <><circle cx="8" cy="14" r="4.2" /><path d="M12 14h8l-2 2.2 2 1.8M7.8 14.1h.2" /></>,
    image: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.6" /><circle cx="9" cy="10.2" r="1.5" /><path d="m6.8 16.2 3.3-3.5 2.2 2.3 2.4-3 2.8 4.2" /></>,
  };
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.more}
    </svg>
  );
}

export function BrandMark({ size = 32, className = '' }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className={`brand-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-bg`} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#17324f" />
          <stop offset="1" stopColor="#0a1524" />
        </linearGradient>
        <linearGradient id={`${uid}-mail`} x1="7" y1="10" x2="25" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7de3f4" />
          <stop offset="1" stopColor="#2fd4c0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8.5" fill={`url(#${uid}-bg)`} />
      <rect x="6.2" y="10.4" width="17.6" height="12.6" rx="2.4" fill="none" stroke={`url(#${uid}-mail)`} strokeWidth="1.9" />
      <path d="M7.4 11.9 15 17.4l7.6-5.5" fill="none" stroke={`url(#${uid}-mail)`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 4.6l1.05 2.55L28.6 8.2l-2.55 1.05L25 11.8l-1.05-2.55L21.4 8.2l2.55-1.05z" fill="#5eead4" />
    </svg>
  );
}
