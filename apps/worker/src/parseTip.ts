/**
 * Extrai o nome da casa de apostas a partir da URL do bilhete.
 * Ex.: https://www.bet365.bet.br/s/r/ZZnxR -> "bet365"
 *      https://esportiva.bet.br/sports/... -> "esportiva"
 */
export function extractBookmaker(url: string | null): string | null {
  if (!url) return null;
  try {
    // Strips generic prefixes (www., m. for mobile) so "m.betfast.bet.br"
    // and "www.bet365.bet.br" both resolve to the actual brand name instead
    // of the subdomain.
    return new URL(url).hostname.replace(/^(www|m)\./i, "").split(".")[0] ?? null;
  } catch {
    return null;
  }
}

/** A hidden hyperlink on the message (Telegram `MessageEntityTextUrl`) — the
 * visible text ("esportivabet") and the real URL behind it are different. */
export type TextEntity = { url?: string };

const URL_IN_TEXT_RE = /https?:\/\/\S+/i;
const UNIT_ONLY_RE = /^(\d+(?:[.,]\d+)?)\s*u$/i;
const UNIT_COMBO_RE = /^(\d+(?:[.,]\d+)?)\s*u\s+na\s+(.+)$/i;
const UNIT_INLINE_RE = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*u$/i;
const ODD_LINE_RE = /\bodd\b\s*:?\s*(\d+(?:[.,]\d+)?)/i;
const LIMIT_LINE_RE = /\blimite\b(?:\s+de\s+aposta)?\s*:?\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?)\s*\$?/i;
const PERCENTAGE_RE = /(\d+(?:[.,]\d+)?)\s*%/;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(",", "."));
}

/**
 * Formatos de mensagem já observados nos grupos rastreados — serve de
 * documentação viva (o `pattern` gravado em cada TelegramTip é uma dessas
 * chaves, ou `null` quando nada bateu) e de referência pra reconhecer um
 * formato novo quando ele aparecer.
 */
export const KNOWN_PATTERNS: Record<string, { description: string; example: string }> = {
  odd_pct_limit: {
    description: "ODD + Porcentagem + Limite de aposta no texto; mercado e jogo vêm da foto (Lemos).",
    example:
      "⚠️ ODD: 2.80\n🚨 Porcentagem: 2.06%\n💰 Limite de aposta: 70$\n\n⚠️ Link de aposta: esportivabet",
  },
  pct_limit_only: {
    description: "Só Porcentagem + Limite, sem odd no texto; mercado, jogo e odd vêm da foto (ST - Super Odds).",
    example: "0.75%\n\nLimite 20\n\nhttps://ginga.bet.br/apostas-esportivas/destaques?shareCode=...",
  },
  unit_lines: {
    description: "Várias linhas '<n>u' sozinhas — cada uma é uma seleção separada; mercado, jogo e odd vêm da foto.",
    example: "0,75u\n0,25u\n0,25u\n\nhttps://www.betano.bet.br/bookingcode/...",
  },
  combo: {
    description: "Uma linha '<n>u na <Rótulo>' — aposta múltipla; 1 tip só com os mercados concatenados vindos da foto.",
    example: "0,25u na Tripla\nhttps://www.bet365.bet.br/s/r/...",
  },
  inline_market: {
    description: "Mercado descrito por extenso no texto (mesma linha da unidade ou linha separada); odd e jogo vêm da foto.",
    example: "Bernard 2+ Chutes + Bunker Cassierra\n\n1u\n\nhttps://www.bet365.bet.br/s/r/...",
  },
};

export type ParsedSelection = { text: string | null; unit: number | null };

export type ParsedTip = {
  pattern: keyof typeof KNOWN_PATTERNS | null;
  bookmaker: string | null;
  betUrl: string | null;
  fields: { odd?: number; percentage?: number; limit?: number };
  comboLabel?: string;
  /** Confronto ("Time A x Time B"), quando a linha solta do texto é isso em
   * vez de uma descrição de mercado — ver MATCH_LINE_RE. */
  match?: string;
  selections: ParsedSelection[];
};

/** "Bayern x Bodo" — quando a linha solta do texto é o confronto, não o
 * mercado (ambos aparecem como "texto livre + unidade em linha própria",
 * só o conteúdo distingue um do outro). */
const MATCH_LINE_RE = /^(.+?)\s+x\s+(.+)$/i;

function extractLink(
  text: string,
  entities: TextEntity[] | undefined,
): { bookmaker: string | null; betUrl: string | null; plainUrlLine: string | null } {
  const hidden = entities?.find((e) => e.url);
  if (hidden?.url) {
    return { bookmaker: extractBookmaker(hidden.url), betUrl: hidden.url, plainUrlLine: null };
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(URL_IN_TEXT_RE);
    if (match) return { bookmaker: extractBookmaker(match[0]), betUrl: match[0], plainUrlLine: line };
  }

  return { bookmaker: null, betUrl: null, plainUrlLine: null };
}

/**
 * Parseia uma mensagem de tip de grupo de Telegram. Heurística baseada nos
 * formatos observados em KNOWN_PATTERNS. Retorna `null` quando a mensagem
 * não bate em nenhum padrão conhecido — testado contra tráfego real dos
 * grupos, isso é sempre bate-papo (nunca uma tip de verdade), então essas
 * mensagens são ignoradas em vez de virar uma linha "revisar" vazia.
 */
export function parseTip(rawText: string | null | undefined, entities?: TextEntity[]): ParsedTip | null {
  if (!rawText || !rawText.trim()) return null;

  const { bookmaker, betUrl, plainUrlLine } = extractLink(rawText, entities);

  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== plainUrlLine);

  const fields: ParsedTip["fields"] = {};
  const remaining: string[] = [];

  for (const line of lines) {
    const oddMatch = line.match(ODD_LINE_RE);
    if (oddMatch) {
      fields.odd = toNumber(oddMatch[1]!);
      continue;
    }
    const limitMatch = line.match(LIMIT_LINE_RE);
    if (limitMatch) {
      fields.limit = toNumber(limitMatch[1]!);
      continue;
    }
    const pctMatch = line.match(PERCENTAGE_RE);
    if (pctMatch) {
      fields.percentage = toNumber(pctMatch[1]!);
      continue;
    }
    remaining.push(line);
  }

  for (const line of remaining) {
    const combo = line.match(UNIT_COMBO_RE);
    if (combo) {
      return {
        pattern: "combo",
        bookmaker,
        betUrl,
        fields,
        comboLabel: combo[2]!.trim(),
        selections: [{ text: null, unit: toNumber(combo[1]!) }],
      };
    }
  }

  const unitOnlyLines = remaining.filter((l) => UNIT_ONLY_RE.test(l));
  if (unitOnlyLines.length > 1) {
    return {
      pattern: "unit_lines",
      bookmaker,
      betUrl,
      fields,
      selections: unitOnlyLines.map((l) => ({ text: null, unit: toNumber(l.match(UNIT_ONLY_RE)![1]!) })),
    };
  }

  for (const line of remaining) {
    if (UNIT_ONLY_RE.test(line)) continue;
    const inline = line.match(UNIT_INLINE_RE);
    if (inline) {
      const label = inline[1]!.trim();
      const isMatch = MATCH_LINE_RE.test(label);
      return {
        pattern: "inline_market",
        bookmaker,
        betUrl,
        fields,
        ...(isMatch ? { match: label } : {}),
        selections: [{ text: isMatch ? null : label, unit: toNumber(inline[2]!) }],
      };
    }
  }

  if (unitOnlyLines.length === 1) {
    const unit = toNumber(unitOnlyLines[0]!.match(UNIT_ONLY_RE)![1]!);
    const freeLine = remaining.find((l) => l !== unitOnlyLines[0]) ?? null;
    const isMatch = freeLine !== null && MATCH_LINE_RE.test(freeLine);
    return {
      pattern: "inline_market",
      bookmaker,
      betUrl,
      fields,
      ...(isMatch ? { match: freeLine! } : {}),
      selections: [{ text: isMatch ? null : freeLine, unit }],
    };
  }

  if (fields.odd !== undefined || fields.percentage !== undefined || fields.limit !== undefined) {
    return {
      pattern: fields.odd !== undefined ? "odd_pct_limit" : "pct_limit_only",
      bookmaker,
      betUrl,
      fields,
      selections: [{ text: null, unit: fields.percentage ?? null }],
    };
  }

  // Nada reconhecível (nem odd/%/limite, nem linha de unidade, nem combo) —
  // testado contra tráfego real, isso é sempre bate-papo (bom dia/boa noite,
  // link de convite do grupo, comentário sobre o próprio jogo) nunca uma tip
  // de verdade, então não cria linha nenhuma em vez de virar lixo "revisar".
  return null;
}
