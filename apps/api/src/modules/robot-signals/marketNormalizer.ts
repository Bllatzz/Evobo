/**
 * Turns a raw robotip alert into a clean market label ("Over 0.5 Corners FT")
 * and a groupKey used to merge multiple bots' alerts on the same market/game
 * (see robot-signals/routes.ts).
 *
 * Bot names are marketing labels, not reliable market descriptors — e.g.
 * "Bot vencedor 4º lugar na Copa RobôTip #1: Under 2.5 escanteios" contains a
 * "4º" that looks numeric but isn't the betting line. The real robotip system
 * (~/desenvolvimento/robotip/betting-userbot/src/bots-config.js) doesn't
 * guess this from text at all — it keeps an explicit, hand-maintained table
 * mapping each known bot_name to its real market/direction/offset. This
 * mirrors that table exactly (same bot names, same offsets) instead of
 * regex-guessing from the name.
 *
 * A few bots (the "Gols" ones) have a variable line that moves alert to
 * alert — bots-config.js marks those `offset: null` and reads the real
 * current line from the alert body instead (the same source
 * betting-userbot/parser.js reads: a "Gols over +0.5: 2.04" style line). We
 * do the same: parse that line out of raw_message.
 */

type MarketType = "Corners" | "Goals";
type Direction = "over" | "under";

type BotConfigEntry =
  | { marketType: MarketType; direction: Direction; offset: number | null; period: "FT" | "HT" }
  | { marketType: "Empate" };

/** Mirrors betting-userbot/src/bots-config.js — keep bot names byte-for-byte identical to that file. */
const BOT_CONFIG: Record<string, BotConfigEntry> = {
  "OVER 0.5 ESCANTEIOS FT - V2.0": { marketType: "Corners", direction: "over", offset: 0.5, period: "FT" },
  "OVER 0.5 ESCANTEIOS FT - V6.0": { marketType: "Corners", direction: "over", offset: 0.5, period: "FT" },
  "OVER 0.5 ESCANTEIOS FT - V7.0": { marketType: "Corners", direction: "over", offset: 0.5, period: "FT" },
  "OVER CORNER 0.5 FT ODD MIN: 1.7 - 2.0": { marketType: "Corners", direction: "over", offset: 0.5, period: "FT" },
  "REVALIDAÇÃO OVER 0.5 CORNERS V2.0 (SEM FILTRO DE LIGAS) -- V1.0": {
    marketType: "Corners",
    direction: "over",
    offset: 0.5,
    period: "FT",
  },
  "Menos de 0,5 escanteios (gratuito)": { marketType: "Corners", direction: "under", offset: 0.5, period: "FT" },
  "OVER GOL FT - V1.0 @2.0": { marketType: "Goals", direction: "over", offset: null, period: "FT" },
  "OVER GOL FT - V2.0 @2.0": { marketType: "Goals", direction: "over", offset: null, period: "FT" },
  "Teste Under Gol HT": { marketType: "Goals", direction: "under", offset: 0.5, period: "HT" },
  "Bot vencedor 2º lugar na Copa RobôTip #1: Under 0.5 HT gols": {
    marketType: "Goals",
    direction: "under",
    offset: 0.5,
    period: "HT",
  },
  "Bot vencedor 3º lugar na Copa RobôTip #1: Under 0.5 HT gols": {
    marketType: "Goals",
    direction: "under",
    offset: 0.5,
    period: "HT",
  },
  "Bot vencedor 4º lugar na Copa RobôTip #1: Under 2.5 escanteios": {
    marketType: "Corners",
    direction: "under",
    offset: 2.5,
    period: "FT",
  },
  "Under 3.5 Corners FT": { marketType: "Corners", direction: "under", offset: 3.5, period: "FT" },
  "Bot vencedor 1º lugar na Copa RobôTip #1: Empate": { marketType: "Empate" },
};

/** "Gols over +0.5: 2.04" / "Escanteios under +2.5: 2.56" -> 0.5 / 2.5 — same line parser.js reads for bots with no fixed line. */
function extractOffsetFromMessage(rawMessage: string | null): number | null {
  if (!rawMessage) return null;
  for (const line of rawMessage.split("\n")) {
    if (/attacks|ataques|ap\s*\/\s*min/i.test(line)) continue;
    const m = line.match(/\b(?:over|under)\b\s*\+?(\d+[.,]\d+)\s*:\s*[\d.,]+/i);
    if (m) return Number(m[1]!.replace(",", "."));
  }
  return null;
}

export type NormalizedMarket = { label: string; groupKey: string };

/**
 * Regex-based best-effort fallback for bot names that aren't in BOT_CONFIG
 * (new/unlisted bots, or one-offs like "BOT BIEL COM ODD" with no parseable
 * market at all) — better to show the messy original than a wrong guess.
 */
function guessFromName(botName: string | null): NormalizedMarket {
  const raw = botName ?? "Sinal";
  const lower = raw.toLowerCase();

  let direction: Direction | null = null;
  if (/\bover\b|\bmais\b/.test(lower)) direction = "over";
  else if (/\bunder\b|\bmenos\b/.test(lower)) direction = "under";

  let marketType: string | null = null;
  if (/escanteio|corner/.test(lower)) marketType = "Corners";
  else if (/\bgol\b|\bgols\b|\bgoal/.test(lower)) marketType = "Goals";
  else if (/cart[aã]o|\bcard/.test(lower)) marketType = "Cards";
  else if (/empate|\bdraw\b/.test(lower)) marketType = "Empate";

  if (!direction || !marketType) {
    return { label: raw, groupKey: `raw:${lower}` };
  }
  if (marketType === "Empate") {
    return { label: "Empate", groupKey: "empate" };
  }

  const offsetMatch = lower.match(/(?<![v@])\b(\d+[.,]\d+)\b/);
  const offset = offsetMatch ? offsetMatch[1]!.replace(",", ".") : null;
  const period = /\bht\b|1[ºo]?\s*tempo/.test(lower) ? "HT" : "FT";
  const directionLabel = direction === "over" ? "Over" : "Under";

  return {
    label: `${directionLabel}${offset ? ` ${offset}` : ""} ${marketType} ${period}`,
    groupKey: `${direction}|${marketType}|${offset ?? "?"}|${period}`,
  };
}

export function normalizeMarket(botName: string | null, rawMessage: string | null = null): NormalizedMarket {
  const config = botName ? BOT_CONFIG[botName] : undefined;
  if (!config) return guessFromName(botName);

  if (config.marketType === "Empate") {
    return { label: "Empate", groupKey: "empate" };
  }

  const offset = config.offset ?? extractOffsetFromMessage(rawMessage);
  const directionLabel = config.direction === "over" ? "Over" : "Under";

  return {
    label: `${directionLabel}${offset != null ? ` ${offset}` : ""} ${config.marketType} ${config.period}`,
    groupKey: `${config.direction}|${config.marketType}|${offset ?? "?"}|${config.period}`,
  };
}
