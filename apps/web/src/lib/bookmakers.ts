const BOOKMAKER_LABELS: Record<string, string> = {
  "4play": "4Play",
  apostamax: "ApostaMax",
  bateu: "Bateu Bet",
  bet365: "Bet365",
  betano: "Betano",
  betfair: "BetFair",
  betfast: "BetFast",
  betmgm: "BetMGM",
  betnacional: "BetNacional",
  betpix365: "BetPix 365",
  bolsadeaposta: "Bolsa de Aposta",
  casadeapostas: "Casa de Apostas",
  esportesdasorte: "Esportes da Sorte",
  esportiva: "Esportiva",
  kto: "KTO",
  lottu: "Lottu",
  novibet: "Novibet",
  onabet: "Onabet",
  pinnacle: "Pinnacle",
  pixbet: "PixBet",
  reidopitaco: "Rei do Pitaco",
  superbet: "Superbet",
  tivo: "Tivo",
  vaidebet: "Vai de Bet",
  vbet: "VBet",
};

/** Colapsa variações de escrita da mesma casa (acento, maiúscula, espaço/
 * pontuação — "Betão", "Betao", "BETÃO" viram todas "betao") no mesmo
 * formato que o slug derivado de URL do parser já usa (label da hostname:
 * minúsculo, sem separador) — nunca criar uma casa duplicada só porque foi
 * digitada diferente dessa vez. Duplicado em
 * apps/worker/src/parseTip.ts — mesma regra, sem pacote compartilhado entre
 * worker e web pra essa função pura. */
export function normalizeBookmakerSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const LOWERCASE_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

function titleCaseFallback(raw: string): string {
  return raw
    .split(" ")
    .filter(Boolean)
    .map((word, i) => (i > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Turns a bookmaker slug (the URL hostname's first label, e.g. "betnacional") into a
 * readable brand name. Unmapped slugs fall back to title-case instead of raw lowercase
 * text, so a house we haven't catalogued yet still reads reasonably. */
export function bookmakerLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const key = raw.trim().toLowerCase();
  return BOOKMAKER_LABELS[key] ?? titleCaseFallback(key);
}
