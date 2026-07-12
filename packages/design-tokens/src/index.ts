/**
 * Single source of truth for design values pulled from the Claude Design
 * handoff (BANCA App.dc.html). Mirrors apps/web/src/index.css's @theme block —
 * keep both in sync. Used anywhere CSS variables aren't reachable (inline SVG,
 * chart libraries, native clients later).
 */
export const colors = {
  bg: "#08090A",
  surface: "#111315",
  surfaceAlt: "#16181B",
  surfaceInput: "#121417",
  surfaceChip: "#0E1013",

  text: "#F2F4F3",
  textSecondary: "#8A9097",
  textTertiary: "#6A7077",
  textQuaternary: "#5A6068",
  textMuted: "#C7CCD1",

  border: "rgba(255,255,255,0.07)",
  borderSubtle: "rgba(255,255,255,0.05)",
  borderStrong: "rgba(255,255,255,0.14)",

  accent: "#2BE08A",
  accentStrong: "#16B978",
  accentSoft: "rgba(43,224,138,0.1)",
  accentBorder: "rgba(43,224,138,0.3)",

  live: "#FF4D5E",
  liveSoft: "rgba(255,77,94,0.1)",

  vip: "#F6C453",
  vipStrong: "#B8860B",
  vipSoft: "rgba(246,196,83,0.1)",
  vipBorder: "rgba(246,196,83,0.4)",

  verified: "#3D9DF6",
  verifiedStrong: "#1D4ED8",
  verifiedSoft: "rgba(61,157,246,0.08)",
} as const;

export const radius = {
  phone: 38,
  card: 20,
  control: 14,
  chip: 11,
  badge: 7,
} as const;

export const fonts = {
  sans: "'Nunito', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  /** "Evobo" brand wordmark only (weight 900) — matches public/evobo.png's lettering. */
  brand: "'Sora', system-ui, sans-serif",
} as const;

export type TipStatus = "pending" | "green" | "red" | "void";

export const tipStatusColor: Record<TipStatus, string> = {
  pending: colors.textSecondary,
  green: colors.accent,
  red: colors.live,
  void: colors.textTertiary,
};
