// Gradient pairs lifted straight from the design (author avatars, badges, ranking podium).
const GRADIENTS = [
  ["#2BE08A", "#15803d"],
  ["#F6C453", "#b8860b"],
  ["#3D9DF6", "#1d4ed8"],
  ["#FF4D5E", "#991b1b"],
  ["#8B5CF6", "#5B21B6"],
] as const;

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarGradient(seed: string): string {
  const [from, to] = GRADIENTS[hash(seed) % GRADIENTS.length]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

// Code-point-aware first character — `str[0]` slices by UTF-16 unit and can
// cut a surrogate pair (e.g. a name starting with an emoji) in half.
function firstChar(str: string): string {
  return [...str][0] ?? "?";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const chars =
    parts.length > 1 ? [firstChar(parts[0]!), firstChar(parts[parts.length - 1]!)] : [firstChar(parts[0] ?? "")];
  return chars.join("").toUpperCase();
}
