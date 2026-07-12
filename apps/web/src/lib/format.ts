export function timeAgo(iso: string): string {
  const target = new Date(iso).getTime();
  if (!iso || Number.isNaN(target)) return "—";
  const diffMs = Date.now() - target;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

// Prisma serializes Postgres numeric/decimal columns (odds, stakeUnits) as
// strings over JSON, not numbers — both accept either and coerce with
// Number() before formatting. Malformed/missing values fall back to "—"
// instead of rendering a literal "NaN" to the user.
export function formatOdds(odds: number | string): string {
  const n = Number(odds);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

export function formatUnits(units: number | string): string {
  const n = Number(units);
  if (!Number.isFinite(n)) return "—";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}u`;
}

const confidenceLabel: Record<"baixa" | "media" | "alta", string> = {
  baixa: "Confiança baixa",
  media: "Confiança média",
  alta: "Confiança alta",
};

export function formatConfidence(confidence: "baixa" | "media" | "alta" | null): string | null {
  return confidence ? confidenceLabel[confidence] : null;
}
