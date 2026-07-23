// Inline SVG icons extracted from the design handoff
// (handoff_prototype/BANCA App.dc.html). These replace emoji placeholders
// (🔍💬✓▲↗) that depend on a system color-emoji font being installed —
// on a fresh Linux desktop that font is often missing, so the emoji just
// don't render at all. SVGs always render regardless of installed fonts.

export type IconProps = { size?: number; className?: string };

export function IconSearch({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}

export function IconBell({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function IconHome({ size = 23, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function IconLive({ size = 23, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}

export function IconPlus({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconRanking({ size = 23, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M6 21V11M12 21V4M18 21v-7" />
    </svg>
  );
}

/** Robô de Apostas screen header icon — slightly different proportions from the tab icon (design uses two distinct robot glyphs). */
export function IconRobotMonitor({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 8V4M9 13h.01M15 13h.01M9 4h6" />
    </svg>
  );
}

/** Robô de Apostas tab icon — a small robot face (antenna, eyes, side nubs). */
export function IconRobot({ size = 23, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="8.5" width="14" height="10.5" rx="3" />
      <path d="M12 8.5V5.5" />
      <circle cx="12" cy="4.2" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9.6 13.3v1.3M14.4 13.3v1.3" />
      <path d="M5 13.4H3.4M19 13.4h1.6" />
    </svg>
  );
}

export function IconProfile({ size = 23, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

/** Filled up-arrow — "takes"/upvote count on a tip card. */
export function IconArrowUp({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 4l8 9h-5v7H9v-7H4z" />
    </svg>
  );
}

export function IconComment({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M21 12a8 8 0 0 1-11 7l-5 1 1-4a8 8 0 1 1 15-4z" />
    </svg>
  );
}

export function IconShare({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8 11l8-5M8 13l8 5" />
    </svg>
  );
}

export function IconExternalLink({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function IconCheck({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function IconX({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconLock({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function IconShield({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </svg>
  );
}

export function IconSparkle({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4z" />
    </svg>
  );
}

export function IconTrendingUp({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function IconCalendar({ size = 21, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconDotsVertical({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconChevronLeft({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

/** Sortable-column affordance — Robô/EV+ tables. */
export function IconChevronDown({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconCamera({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

export function IconCrown({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3 8l4 3 5-6 5 6 4-3-1.5 10h-15z" />
    </svg>
  );
}

/** Market-name trophy icon — Robô de Apostas card header. */
export function IconTrophy({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6 4h12v3a6 6 0 0 1-12 0zM9 14h6v3H9zM7 19h10v2H7z" />
    </svg>
  );
}

/** Competition/date row pennant — Robô de Apostas. */
export function IconPennant({ size = 11, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4 4h16v10H8l-4 4z" />
    </svg>
  );
}

/** Corner flag — Robô de Apostas stats grid. */
export function IconCornerFlag({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M7 3v18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path d="M7 4l10 3L7 10z" fill="currentColor" />
    </svg>
  );
}

/** Dangerous-attacks flame — Robô de Apostas stats grid. */
export function IconFire({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2c1.6 3.4 4.5 4.6 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 8 9 7 9.5 5.5c.4 1.8 1.4 2.3 1.4 2.3C10.9 6 10 4.3 12 2z" />
    </svg>
  );
}

/** "Chutes fora" — Robô de Apostas stats grid (matches the design exactly). */
export function IconClockStat({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

/** "Chutes no alvo" — Robô de Apostas stats grid. */
export function IconTarget({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Possession — Robô de Apostas stats grid. */
export function IconPossession({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M3 12a9 9 0 0 1 18 0M3 12a9 9 0 0 0 18 0" />
    </svg>
  );
}

/** "Stake sugerido" bubble icon — Robô de Apostas. */
export function IconGauge({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="8" cy="9" r="5" />
      <path d="M13 5.4a5 5 0 0 1 0 9.2" />
    </svg>
  );
}

export function IconSun({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8" />
    </svg>
  );
}

export function IconMoon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.5 14.5a8.5 8.5 0 1 1-9-11 7 7 0 0 0 9 11z" />
    </svg>
  );
}

export function IconLogout({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function IconPencil({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** Show-password toggle — open eye. */
export function IconEye({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Hide-password toggle — eye with a slash through it. */
export function IconEyeOff({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.9 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a15.5 15.5 0 0 1-3.1 4.1M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.1-.9" />
      <path d="M9.5 9.7A3 3 0 0 0 12 15a3 3 0 0 0 2.3-1.1" />
      <path d="M2 2l20 20" />
    </svg>
  );
}

/** Google "G" mark — used on the "Continuar com Google" OAuth button. */
export function IconGoogle({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <path
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3a7.4 7.4 0 0 1-4.07 1.16c-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.27a12 12 0 0 0 0 10.8z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.75c1.76 0 3.35.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4 3.11C6.22 6.86 8.87 4.75 12 4.75z"
        fill="#EA4335"
      />
    </svg>
  );
}

/** Análise IA — Admin · Telas & permissões row icon. */
export function IconTune({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v3M12 18v3M5 12H2M22 12h-3" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
